import { randomUUID } from 'node:crypto';
import {
  GUESS_REPLIES,
  LIMITS,
  QUESTION_REPLIES,
  type DoorsOutcome,
  type DoorsPhase,
  type DoorsReply,
  type DoorsView,
  type GuessReply,
  type ProposalKind,
  type ProposalStatus,
  type QuestionReply,
} from '../shared/types';
import { GameError } from './errors';
import { isAskConfigured } from './ai';
import { randomDoorsTheme } from './topics';
import type { GameEngine, Player, Room } from './game';

/** 席の情報のうち、10の扉の進行に要るもの */
export interface Seat {
  id: string;
  name: string;
  connected: boolean;
}

interface Proposal {
  id: string;
  seq: number;
  authorId: string;
  authorName: string;
  kind: ProposalKind;
  isFinal: boolean;
  text: string;
  status: ProposalStatus;
  /** OKした回答者のIDと名前。名前は退室後も残す */
  approverIds: string[];
  approverNames: string[];
  cancelledByName: string;
  reply: DoorsReply | null;
  lie: boolean;
  /** 訂正前の最初の判定。訂正していなければ null */
  correctedFrom: DoorsReply | null;
  /** AI GMの正直な回答 (嘘で反転する前)。AIへ渡す履歴に使う */
  honestReply: QuestionReply | null;
  /** AI GMの解答の判定理由。答えを示唆しうるので結果画面まで伏せる */
  reason: string;
}

/** 時間の1分。画面確認で縮めるため環境変数で変えられる */
export const DOORS_MINUTE_MS = Number(process.env.DOORS_MINUTE_MS) > 0 ? Number(process.env.DOORS_MINUTE_MS) : 60_000;

/** 手番の制限時間の10秒。画面確認で縮めるため環境変数で変えられる */
export const DOORS_TURN_UNIT_MS = Number(process.env.DOORS_TURN_UNIT_MS) > 0 ? Number(process.env.DOORS_TURN_UNIT_MS) : 10_000;

/** AIがGMのときの gmId。プレイヤーのIDは UUID なので重ならない */
export const AI_GM_ID = 'ai';

/** AI GMの嘘。分からないは反転しない */
const FLIP: Partial<Record<QuestionReply, QuestionReply>> = {
  yes: 'no',
  no: 'yes',
  'maybe-yes': 'maybe-no',
  'maybe-no': 'maybe-yes',
};

const ACTIVE: readonly ProposalStatus[] = ['proposed', 'sent'];

function isActive(p: Proposal): boolean {
  return ACTIVE.includes(p.status);
}

/**
 * 10の扉の1ラウンド分の状態。
 * 各操作は受け付ける条件 (フェーズ・立場) を確かめてから状態を変え、満たさなければ GameError を投げる。
 *
 * | 操作 | 立場 | フェーズ |
 * | setAnswer | GM | setup |
 * | propose / approve / cancel / requestExtend | 回答者 (GM以外の席) | asking / final |
 * | reply / reject / correct | GM | asking / final |
 * | extend | ホストかGM | asking / final |
 * | abort | (サーバ内部) | setup / asking / final |
 *
 * AIがGMのとき (gmId が AI_GM_ID) は、GMの操作をサーバが setAiAnswer / applyAi* で行う。
 * AIへの問い合わせ自体はこのクラスの外 (server/index.ts) で行い、結果だけを渡す
 */
export class DoorsRound {
  phase: DoorsPhase = 'doors-setup';
  answer = '';
  used = 0;
  liesUsed = 0;
  proposals: Proposal[] = [];
  /** 提案の通し番号。ログの古い記録を消しても番号が重ならないよう、配列の長さとは別に数える */
  private nextSeq = 1;
  outcome: DoorsOutcome | null = null;
  abortReason = '';
  extendRequestSeq = 0;
  extendRequestBy = '';
  /** 訂正のたびに増える。GM以外の通知に使う */
  correctSeq = 0;
  /** 最後に訂正した提案の通し番号 */
  correctSeqBy = 0;
  /** 合計の締切 (epoch ms)。数えている間だけ入る。止まっている・数えない間・制限時間なしは 0 */
  deadlineAt = 0;
  /** 合計の残り (ミリ秒)。止まっている間の残りを取っておく。null は制限時間なし */
  private totalLeftMs: number | null = null;
  /** 回答者の負けの理由 (時間切れなど)。空なら通常の負け */
  loseReason = '';
  /** 時間切れで質問の段階を打ち切っている間 true。延長で下ろす */
  isTimeUp = false;
  /** 一度でも時間切れになったか */
  wasTimeUp = false;
  /** 手番の締切 (epoch ms)。数えている間だけ入る。止まっている・数えない間は 0 */
  turnDeadlineAt = 0;
  /** 手番の残り (ミリ秒)。止まっている間の残りを取っておく。null は数えていない (確定前・最終解答・時間切れ中) */
  private turnLeftMs: number | null = null;
  /** 手番の時間切れで質問回数を使った回数 */
  turnTimeoutCount = 0;
  /** AI GMの事実メモ。サーバだけが持ち、どのクライアントにも送らない */
  memo = '';
  /** AI GMが答えを決めている、または提案に答えている最中か。お題生成の aiBusy とは別に持つ */
  aiBusy = false;
  /** AI GMが処理中の提案。取り消せない */
  aiBusyId = '';
  /** AI GMの呼出に失敗した提案と理由。ホストが再試行するまで次の提案へ進まない */
  aiFailedId = '';
  aiError = '';
  /** 失敗するたびに増える。画面の揺れの演出に使う */
  aiErrorSeq = 0;
  /** ロビーで決めた質問回数。嘘の確率に使い、延長では変えない */
  readonly baseLimit: number;

  constructor(
    readonly gmId: string,
    public limit: number,
    readonly maxLies: number,
    /** 制限時間 (ミリ秒)。0 はなし */
    readonly timeLimitMs = 0,
    /** 1手番の制限時間 (ミリ秒)。0 はなし */
    readonly turnLimitMs = 0,
  ) {
    this.baseLimit = limit;
  }

  get isRunning(): boolean {
    return this.phase !== 'doors-result';
  }

  get isAiGm(): boolean {
    return this.gmId === AI_GM_ID;
  }

  // ---- 条件 ----

  private requireGm(playerId: string): void {
    if (playerId !== this.gmId) throw new GameError('GMだけが操作できます');
  }

  private requireRespondent(playerId: string, seats: readonly Seat[]): Seat {
    if (playerId === this.gmId) throw new GameError('GMは操作できません');
    const seat = seats.find((s) => s.id === playerId);
    if (!seat) throw new GameError('席が見つかりません');
    return seat;
  }

  private requirePlaying(): void {
    if (this.phase !== 'doors-asking' && this.phase !== 'doors-final') {
      throw new GameError('いまは操作できません');
    }
  }

  private find(id: unknown): Proposal {
    const p = this.proposals.find((x) => x.id === id);
    if (!p) throw new GameError('提案が見つかりません');
    return p;
  }

  private activeCount(): number {
    return this.proposals.filter((p) => isActive(p) && !p.isFinal).length;
  }

  /** 承認が必要な回答者 (接続中・GM以外・提案者以外)。判定のたびに今の席から数える */
  private approvers(p: Proposal, seats: readonly Seat[]): Seat[] {
    return seats.filter((s) => s.connected && s.id !== this.gmId && s.id !== p.authorId);
  }

  /** 承認が必要な人が全員OK済み (または0人) なら、GMへ送る */
  private promote(p: Proposal, seats: readonly Seat[]): void {
    if (p.status !== 'proposed') return;
    if (this.approvers(p, seats).every((s) => p.approverIds.includes(s.id))) p.status = 'sent';
  }

  /** 答えが決まって質問の段階に入った時点から数える */
  private startClock(): void {
    this.deadlineAt = 0;
    this.totalLeftMs = this.timeLimitMs > 0 ? this.timeLimitMs : null;
    this.resetTurn();
  }

  // ---- 合計の時計 ----

  /** 合計の残り (ミリ秒)。制限時間なしは 0 を返すので、呼ぶ前に timeLimitMs を見る */
  private totalLeft(): number {
    return this.deadlineAt > 0 ? Math.max(0, this.deadlineAt - Date.now()) : (this.totalLeftMs ?? 0);
  }

  /** 質問の段階・最終解答の段階のどちらかで、合計の時計が数えるべき状態か。GMへ届いた提案がある間は止める */
  private get isTotalCounting(): boolean {
    if (this.timeLimitMs <= 0) return false;
    if (this.phase === 'doors-asking') return !this.isTimeUp && !this.proposals.some((p) => p.status === 'sent' && !p.isFinal);
    if (this.phase === 'doors-final') return !this.proposals.some((p) => p.status === 'sent');
    return false;
  }

  /** 合計の時計の進行・停止を今の状態から決める。止める時は動いていた分を残りとして取っておく */
  private syncTotal(): void {
    if (this.timeLimitMs <= 0) return;
    const now = Date.now();
    if (this.isTotalCounting) {
      if (this.deadlineAt === 0) this.deadlineAt = now + (this.totalLeftMs ?? 0);
    } else if (this.deadlineAt > 0) {
      this.totalLeftMs = Math.max(0, this.deadlineAt - now);
      this.deadlineAt = 0;
    }
  }

  // ---- 手番の時計 ----

  /** 手番を満タンから数え直す。実際に動き出すかは syncTurn が決める */
  private resetTurn(): void {
    this.turnDeadlineAt = 0;
    this.turnLeftMs = this.turnLimitMs > 0 ? this.turnLimitMs : null;
  }

  /**
   * 手番の時計の進行・停止を今の状態から決める。
   * 質問の段階で、時間切れでなく、GMへ届いている質問の段階の提案が無い間だけ進む。届いている間は残りを取っておく
   */
  syncTurn(): void {
    this.syncTotal();
    if (this.turnLimitMs <= 0) return;
    const now = Date.now();
    const isCounting =
      this.phase === 'doors-asking' && !this.isTimeUp && !this.proposals.some((p) => p.status === 'sent' && !p.isFinal);
    if (this.phase !== 'doors-asking' || this.isTimeUp) {
      // 数えない段階。動いていた分は残りとして取っておく (延長・戻しで満タンにするのは呼び出し側)
      if (this.turnDeadlineAt > 0) this.turnLeftMs = Math.max(0, this.turnDeadlineAt - now);
      this.turnDeadlineAt = 0;
      return;
    }
    if (isCounting) {
      if (this.turnDeadlineAt === 0) this.turnDeadlineAt = now + (this.turnLeftMs ?? this.turnLimitMs);
    } else if (this.turnDeadlineAt > 0) {
      this.turnLeftMs = Math.max(0, this.turnDeadlineAt - now);
      this.turnDeadlineAt = 0;
    }
  }

  /** 手番を数えている段階か (表示用)。確定前・最終解答・時間切れ中・制限なしは false */
  private get isTurnShown(): boolean {
    return this.turnLimitMs > 0 && this.phase === 'doors-asking' && !this.isTimeUp;
  }

  /** 部屋のタイマーが待つ次の締切 (epoch ms)。無ければ 0。ラウンド全体の締切と手番の締切の早い方 */
  nextDeadline(): number {
    if (this.phase === 'doors-final') return this.deadlineAt;
    if (this.phase !== 'doors-asking' || this.isTimeUp) return 0;
    const ds = [this.deadlineAt, this.turnDeadlineAt].filter((d) => d > 0);
    return ds.length > 0 ? Math.min(...ds) : 0;
  }

  /**
   * 締切が過ぎていれば処理する。質問の段階で両方過ぎていればラウンド全体の時間切れだけを処理する。最終解答の段階の時間切れは負けで終わる。
   * 処理したら true
   */
  fireDeadline(): boolean {
    const now = Date.now();
    if (this.phase === 'doors-final') {
      if (this.deadlineAt === 0 || now < this.deadlineAt) return false;
      this.expireFinal();
      return true;
    }
    if (this.phase !== 'doors-asking' || this.isTimeUp) return false;
    if (this.deadlineAt > 0 && now >= this.deadlineAt) {
      this.expire();
      return true;
    }
    if (this.turnDeadlineAt > 0 && now >= this.turnDeadlineAt) {
      this.expireTurn();
      return true;
    }
    return false;
  }

  /** 手番の時間切れ。質問回数を1つ使う。ストック中の提案は残し、回数を使い切ったら settle が捨てる */
  private expireTurn(): void {
    this.used += 1;
    this.turnTimeoutCount += 1;
    this.resetTurn();
    this.settle();
  }

  // ---- GMの答え ----

  setAnswer(playerId: string, answer: string): void {
    this.requireGm(playerId);
    if (this.phase !== 'doors-setup') throw new GameError('答えはもう確定しています');
    if (!answer) throw new GameError('答えを入力してください');
    this.answer = answer;
    this.phase = 'doors-asking';
    this.startClock();
    this.settle();
  }

  // ---- 回答者の操作 ----

  propose(playerId: string, seats: readonly Seat[], kind: unknown, text: string): void {
    this.requirePlaying();
    const seat = this.requireRespondent(playerId, seats);
    if (this.isTimeUp && this.phase === 'doors-asking') throw new GameError('時間切れです');
    if (!text) throw new GameError('内容を入力してください');
    const isFinal = this.phase === 'doors-final';
    // 質問の段階のストックでログを埋めても、最終解答の分は残す
    const logCap = isFinal ? LIMITS.doorsLog : LIMITS.doorsLog - LIMITS.doorsFinalReserve;
    // 上限に届いたら、取り消し済みの一番古い記録を消して空きを作る。消せるものが無いときだけ断る。
    // 消すのは他の検証を通った後 (断った提案で記録を失わない) なので、ここでは位置だけ控える
    const evictIdx = this.proposals.length >= logCap ? this.proposals.findIndex((p) => p.status === 'cancelled') : -1;
    if (this.proposals.length >= logCap && evictIdx < 0) {
      throw new GameError(isFinal ? 'ログが上限に達しました' : 'ログが上限に達しました。残りは最終解答の分です');
    }
    if (isFinal) {
      if (this.proposals.some((p) => isActive(p) && p.isFinal)) throw new GameError('最終解答は1件ずつ出せます');
    } else {
      // 残り回数を超えてストックできる (回数を使い切った時点で残りは settle が捨てる)。1人あたりは LIMITS.doorsStockPerPlayer (20) 件まで
      if (this.proposals.filter((p) => p.authorId === playerId && isActive(p) && !p.isFinal).length >= LIMITS.doorsStockPerPlayer) {
        throw new GameError(`ためておける提案は1人${LIMITS.doorsStockPerPlayer}件までです`);
      }
      if (kind !== 'question' && kind !== 'guess') throw new GameError('質問か解答を選んでください');
    }
    if (evictIdx >= 0) this.proposals.splice(evictIdx, 1);
    this.proposals.push({
      id: randomUUID(),
      seq: this.nextSeq++,
      authorId: playerId,
      authorName: seat.name,
      kind: isFinal ? 'guess' : (kind as ProposalKind),
      isFinal,
      text,
      status: 'proposed',
      approverIds: [],
      approverNames: [],
      cancelledByName: '',
      reply: null,
      lie: false,
      correctedFrom: null,
      honestReply: null,
      reason: '',
    });
    this.refresh(seats);
    this.syncTurn();
  }

  approve(playerId: string, seats: readonly Seat[], id: unknown): void {
    this.requirePlaying();
    const seat = this.requireRespondent(playerId, seats);
    if (this.isTimeUp && this.phase === 'doors-asking') throw new GameError('時間切れです');
    // 手番の締切が過ぎたのにタイマーが未発火の間の承認で、時間切れを逃れさせない。
    // 時間切れを処理したら、この承認は捨てる (状態は変わっているので、エラーにせず呼び出し側に同期・配信させる)
    const nowMs = Date.now();
    const isOverdue = (this.turnDeadlineAt > 0 && nowMs >= this.turnDeadlineAt) || (this.deadlineAt > 0 && nowMs >= this.deadlineAt);
    if (isOverdue && this.fireDeadline()) return;
    const p = this.find(id);
    if (p.status !== 'proposed') throw new GameError('この提案は承認待ちではありません');
    if (p.authorId === playerId) throw new GameError('自分の提案は承認できません');
    if (p.approverIds.includes(playerId)) throw new GameError('もうOKしています');
    p.approverIds.push(playerId);
    p.approverNames.push(seat.name);
    this.promote(p, seats);
    this.syncTurn();
  }

  cancel(playerId: string, seats: readonly Seat[], id: unknown): void {
    this.requirePlaying();
    const seat = this.requireRespondent(playerId, seats);
    const p = this.find(id);
    // GMの回答と競合したときは先に届いた方を採る。後から来た取り消しはここで断る
    if (!isActive(p)) throw new GameError('この提案はもう取り消せません');
    if (p.id === this.aiBusyId) throw new GameError('AIが回答中の提案は取り消せません');
    p.status = 'cancelled';
    p.cancelledByName = seat.name;
    // 失敗した提案を取り消したら、失敗の表示も消す (次のAI処理を待たずに)
    if (p.id === this.aiFailedId) this.clearAiError();
    this.settle();
  }

  requestExtend(playerId: string, seats: readonly Seat[]): void {
    this.requirePlaying();
    const seat = this.requireRespondent(playerId, seats);
    this.extendRequestSeq += 1;
    this.extendRequestBy = seat.name;
  }

  // ---- GMの回答 ----

  reply(playerId: string, id: unknown, reply: unknown, lie: unknown): void {
    this.requireGm(playerId);
    this.requirePlaying();
    const p = this.find(id);
    if (p.status === 'proposed') throw new GameError('承認される前の提案には答えられません');
    if (p.status !== 'sent') throw new GameError('この提案はもう処理されています');
    const isLie = lie === true;
    if (p.kind === 'question') {
      if (!QUESTION_REPLIES.includes(reply as never)) throw new GameError('回答を選んでください');
      if (isLie && this.liesUsed >= this.maxLies) throw new GameError('嘘の回数が残っていません');
    } else {
      if (!GUESS_REPLIES.includes(reply as never)) throw new GameError('判定を選んでください');
      if (isLie) throw new GameError('解答には嘘を付けられません');
    }
    this.record(p, reply as DoorsReply, isLie);
  }

  /** GMが回答済みの判定を訂正する。回数は変えない。解答を正解に直したら回答者の勝ち */
  correct(playerId: string, id: unknown, reply: unknown, lie: unknown): void {
    this.requireGm(playerId);
    this.requirePlaying();
    const p = this.find(id);
    if (p.status !== 'answered' || p.reply === null) throw new GameError('回答済みの提案だけ訂正できます');
    const isLie = lie === true;
    if (p.kind === 'question') {
      if (!QUESTION_REPLIES.includes(reply as never)) throw new GameError('回答を選んでください');
      if (isLie && this.liesUsed - (p.lie ? 1 : 0) >= this.maxLies) throw new GameError('嘘の回数が残っていません');
    } else {
      if (!GUESS_REPLIES.includes(reply as never)) throw new GameError('判定を選んでください');
      if (isLie) throw new GameError('解答には嘘を付けられません');
    }
    if (reply === p.reply && isLie === p.lie) throw new GameError('いまと同じ判定です');
    this.liesUsed += (isLie ? 1 : 0) - (p.lie ? 1 : 0);
    const isReplyChanged = reply !== p.reply;
    if (isReplyChanged) p.correctedFrom ??= p.reply;
    p.reply = reply as DoorsReply;
    p.lie = isLie;
    // 最初の判定へ戻したら訂正の表示を消す (「Yes → Yes」を出さない)
    if (p.correctedFrom === p.reply) p.correctedFrom = null;
    // 嘘の付け外しだけの訂正は、回答者から見える判定が変わらないので通知しない (嘘が推測されるため)
    if (isReplyChanged) {
      this.correctSeq += 1;
      this.correctSeqBy = p.seq;
    }
    if (p.kind === 'guess' && reply === 'correct') this.finish('win');
  }

  /** 回答を記録して回数を進める。解答の正解で勝ち、最終解答のそれ以外で負け */
  private record(p: Proposal, reply: DoorsReply, isLie: boolean): void {
    p.status = 'answered';
    p.reply = reply;
    p.lie = isLie;
    if (isLie) this.liesUsed += 1;
    if (!p.isFinal) {
      this.used += 1;
      this.resetTurn();
    }
    if (p.kind === 'guess' && reply === 'correct') return this.finish('win');
    if (p.isFinal) return this.finish('lose');
    this.settle();
  }

  // ---- AI GM ----

  setAiAnswer(answer: string, memo: string): void {
    if (!this.isAiGm || this.phase !== 'doors-setup') throw new GameError('答えはもう確定しています');
    this.answer = answer;
    this.memo = memo;
    this.aiBusy = false;
    this.phase = 'doors-asking';
    this.startClock();
    this.settle();
  }

  /**
   * AIが次に答える提案。送信済みのものを通し番号順に1件ずつ返す。
   * 処理中・失敗して再試行待ちのとき、ラウンド中でないときは null
   */
  nextForAi(): Proposal | null {
    if (!this.isAiGm || this.aiBusy) return null;
    if (this.phase !== 'doors-asking' && this.phase !== 'doors-final') return null;
    // 失敗した提案が取り消されたら、再試行を待たずに次へ進む
    if (this.aiFailedId && this.proposals.find((p) => p.id === this.aiFailedId)?.status !== 'sent') this.clearAiError();
    if (this.aiError) return null;
    return this.proposals.find((p) => p.status === 'sent') ?? null;
  }

  /** AIへ問い合わせる直前に呼ぶ。この提案は答えが届くまで取り消せない */
  beginAi(p: Proposal): void {
    this.aiBusy = true;
    this.aiBusyId = p.id;
  }

  /** 問い合わせ中の提案がまだ答えを待っているか。遅れて届いた結果で状態を書き換えないために使う */
  isAwaitingAi(id: string): boolean {
    const p = this.proposals.find((x) => x.id === id);
    return this.isRunning && this.aiBusyId === id && p?.status === 'sent';
  }

  /** 正直な回答を受け取り、嘘の上限の範囲で反転させてから記録する */
  applyAiQuestion(id: string, honest: QuestionReply, random = Math.random()): void {
    const p = this.endAi(id);
    p.honestReply = honest;
    const flipped = FLIP[honest];
    const canLie = flipped !== undefined && this.liesUsed < this.maxLies && random < this.maxLies / this.baseLimit;
    this.record(p, canLie ? flipped : honest, canLie);
  }

  applyAiGuess(id: string, verdict: GuessReply, reason: string): void {
    const p = this.endAi(id);
    p.reason = reason;
    this.record(p, verdict, false);
  }

  /** 呼出の失敗。提案は回答待ちのまま残し、回数は消費しない */
  failAi(id: string, error: string): void {
    this.aiBusy = false;
    this.aiBusyId = '';
    this.aiFailedId = id;
    this.aiError = error;
    this.aiErrorSeq += 1;
  }

  /** 問い合わせが終わった後に呼ぶ。結果を記録・失敗扱いにしていれば何もしない */
  releaseAi(id: string): void {
    if (this.aiBusyId !== id) return;
    this.aiBusy = false;
    this.aiBusyId = '';
  }

  /** 答えを決める呼出の後始末。結果を捨てるときにも呼ぶ */
  endAiAnswer(): void {
    this.aiBusy = false;
  }

  retryAi(isHost: boolean): void {
    if (!isHost) throw new GameError('ホストだけが再試行できます');
    if (!this.isAiGm || !this.aiError) throw new GameError('再試行するものはありません');
    this.clearAiError();
  }

  private clearAiError(): void {
    this.aiFailedId = '';
    this.aiError = '';
  }

  private endAi(id: string): Proposal {
    const p = this.find(id);
    this.aiBusy = false;
    this.aiBusyId = '';
    return p;
  }

  reject(playerId: string, id: unknown): void {
    this.requireGm(playerId);
    this.requirePlaying();
    const p = this.find(id);
    if (p.status === 'proposed') throw new GameError('承認される前の提案には答えられません');
    if (p.status !== 'sent') throw new GameError('この提案はもう処理されています');
    p.status = 'rejected';
    if (!p.isFinal) this.resetTurn();
    this.settle();
  }

  // ---- 延長 ----

  extend(canExtend: boolean, delta: unknown): void {
    if (!canExtend) throw new GameError('延長はホストかGMだけが操作できます');
    this.requirePlaying();
    if (delta === 1) {
      // 締切を過ぎたのにタイマーが未発火の間の延長で、最終解答の時間切れを逃れさせない (承認と同じ。状態は変わっているので呼び出し側に配信させる)
      if (this.deadlineAt > 0 && Date.now() >= this.deadlineAt && this.fireDeadline()) return;
      if (this.limit >= LIMITS.doorsMaxTotal) throw new GameError(`質問回数は${LIMITS.doorsMaxTotal}回までです`);
      this.limit += 1;
      // 時間切れの間は回数だけ増やす。質問へ戻るには時間の延長も要る
      if (this.phase === 'doors-final' && !this.isTimeUp) this.backToAsking();
      this.syncTurn();
      return;
    }
    if (delta === -1) {
      // ストック中の提案は回数を使い切れば捨てるので数えない。AIが答えている最中の1件だけは枠を残す
      const floor = Math.max(1, this.used + (this.aiBusyId ? 1 : 0));
      if (this.limit - 1 < floor) throw new GameError('使用済みとAIが回答中の回数より減らせません');
      this.limit -= 1;
      this.settle();
      return;
    }
    throw new GameError('延長の値が正しくありません');
  }

  /** 最終解答の段階から質問の段階へ戻す。出ている最終解答は、質問の段階の解答として扱い直す (回数の枠に収まる) */
  private backToAsking(): void {
    for (const p of this.proposals) if (isActive(p)) p.isFinal = false;
    this.phase = 'doors-asking';
    this.resetTurn();
    // 戻した時点で締切を過ぎていれば、その場で時間切れにする
    this.syncTotal();
    if (this.timeLimitMs > 0 && this.totalLeft() <= 0) this.expire();
  }

  /** 時間を1分延ばす。時間切れのあとなら時間切れを解き、回数が残っていれば質問の段階へ戻す */
  extendTime(canExtend: boolean): void {
    if (!canExtend) throw new GameError('延長はホストかGMだけが操作できます');
    this.requirePlaying();
    if (this.timeLimitMs <= 0) throw new GameError('制限時間がありません');
    // 最終解答の締切を過ぎたのにタイマーが未発火の間の延長で、時間切れの負けを逃れさせない (extend(+1)と同じ)
    if (this.phase === 'doors-final' && this.deadlineAt > 0 && Date.now() >= this.deadlineAt && this.fireDeadline()) return;
    const next = this.totalLeft() + DOORS_MINUTE_MS;
    if (next > LIMITS.doorsMaxTimeLeftMin * DOORS_MINUTE_MS) {
      throw new GameError(`残り時間は${LIMITS.doorsMaxTimeLeftMin}分までです`);
    }
    // 数えている間は締切を、止まっている間は取っておいた残りを延ばす
    if (this.deadlineAt > 0) this.deadlineAt += DOORS_MINUTE_MS;
    else this.totalLeftMs = next;
    if (this.isTimeUp) {
      this.isTimeUp = false;
      this.resetTurn();
      if (this.phase === 'doors-final' && this.used < this.limit) this.backToAsking();
    }
    this.syncTurn();
  }

  /** 時間切れ。質問の段階のときだけ処理する。承認待ちを取り消し、届いている提案が片付けば最終解答の段階へ進む */
  expire(): void {
    if (this.phase !== 'doors-asking' || this.isTimeUp) return;
    this.isTimeUp = true;
    this.wasTimeUp = true;
    this.deadlineAt = 0;
    this.totalLeftMs = 0;
    this.cancelProposed();
    this.settle();
  }

  /** 最終解答の段階の時間切れ。承認待ちを取り消し、回答者の負けで終わる */
  private expireFinal(): void {
    this.wasTimeUp = true;
    this.cancelProposed();
    this.loseReason = '時間切れ';
    this.finish('lose');
  }

  private cancelProposed(): void {
    for (const p of this.proposals) {
      if (p.status !== 'proposed') continue;
      p.status = 'cancelled';
      p.cancelledByName = '(時間切れ)';
    }
  }

  // ---- 進行 ----

  /**
   * 回数を使い切ったら、残っているストック (承認待ち・送信済み) を捨てて最終解答へ進む。
   * 時間切れのときは、送信済みの提案が片付いてから進む
   */
  private settle(): void {
    if (this.phase === 'doors-asking' && this.used >= this.limit) {
      for (const p of this.proposals) if (isActive(p) && !p.isFinal) p.status = 'discarded';
    }
    if (this.phase === 'doors-asking' && (this.used >= this.limit || this.isTimeUp) && this.activeCount() === 0) {
      // 最終解答を考える時間として、残りが60秒に満たなければ60秒にする
      this.syncTotal();
      this.phase = 'doors-final';
      if (this.timeLimitMs > 0) this.totalLeftMs = Math.max(this.totalLeft(), DOORS_MINUTE_MS);
      this.deadlineAt = 0;
    }
    this.syncTurn();
  }

  /**
   * 人の出入りのたびに呼ぶ。承認できる人がいない承認待ちをGMへ送り、
   * 回答者が全員退室していたらラウンドを中止する
   */
  refresh(seats: readonly Seat[]): void {
    if (!this.isRunning) return;
    if (!seats.some((s) => s.id !== this.gmId)) return this.abort('回答者が全員退室しました');
    for (const p of this.proposals) {
      this.promote(p, seats);
    }
    this.syncTurn();
  }

  /** 退室した提案者の承認待ちを取り消す。切断しているだけなら残す */
  dropAuthor(playerId: string): void {
    for (const p of this.proposals) {
      if (p.authorId === playerId && p.status === 'proposed') {
        p.status = 'cancelled';
        p.cancelledByName = '(退室)';
      }
    }
    this.settle();
  }

  abort(reason: string): void {
    if (!this.isRunning) return;
    this.abortReason = reason;
    this.finish('aborted');
  }

  private finish(outcome: DoorsOutcome): void {
    for (const p of this.proposals) if (isActive(p)) p.status = 'discarded';
    // 問い合わせ中のAIの結果は isAwaitingAi で捨てる
    this.aiBusy = false;
    this.aiBusyId = '';
    this.aiFailedId = '';
    this.aiError = '';
    this.outcome = outcome;
    this.phase = 'doors-result';
    this.turnDeadlineAt = 0;
    this.deadlineAt = 0;
  }

  // ---- 表示 ----

  /**
   * 答え・嘘印・嘘の使用数は、GM本人と結果画面にだけ送る。
   * AI GMの判定理由は結果画面でだけ送り、事実メモはどの画面にも送らない
   */
  viewFor(viewerId: string, seats: readonly Seat[]): DoorsView {
    const canSeeSecret = viewerId === this.gmId || this.phase === 'doors-result';
    const isResult = this.phase === 'doors-result';
    return {
      gmId: this.gmId,
      isAiGm: this.isAiGm,
      aiBusy: this.aiBusy,
      aiBusyId: this.aiBusyId,
      aiFailedId: this.aiFailedId,
      aiError: this.aiError,
      aiErrorSeq: this.aiErrorSeq,
      answer: canSeeSecret ? this.answer : null,
      limit: this.limit,
      used: this.used,
      maxLies: this.maxLies,
      liesUsed: canSeeSecret ? this.liesUsed : null,
      proposals: this.proposals.map((p) => ({
        id: p.id,
        seq: p.seq,
        authorId: p.authorId,
        authorName: p.authorName,
        kind: p.kind,
        isFinal: p.isFinal,
        text: p.text,
        status: p.status,
        approverNames: p.approverNames,
        isApprovedByYou: p.approverIds.includes(viewerId),
        ...this.approvalCounts(p, seats),
        cancelledByName: p.cancelledByName,
        reply: p.reply,
        correctedFrom: p.correctedFrom,
        lie: canSeeSecret ? p.lie : null,
        reason: isResult && p.reason ? p.reason : null,
      })),
      outcome: this.outcome,
      abortReason: this.abortReason,
      extendRequestSeq: this.extendRequestSeq,
      extendRequestBy: this.extendRequestBy,
      correctSeq: this.correctSeq,
      correctSeqBy: this.correctSeqBy,
      timeLimitMin: Math.round(this.timeLimitMs / DOORS_MINUTE_MS),
      timeLeftMs: this.isTotalShown ? this.totalLeft() : null,
      isTimePaused: this.isTotalShown && this.deadlineAt === 0,
      loseReason: this.loseReason,
      isTimeUp: this.isTimeUp,
      wasTimeUp: this.wasTimeUp,
      turnLimitSec: Math.round(this.turnLimitMs / DOORS_TURN_UNIT_MS) * 10,
      turnLeftMs: this.isTurnShown ? this.turnLeft() : null,
      isTurnPaused: this.isTurnShown && this.turnDeadlineAt === 0,
      turnTimeoutCount: this.turnTimeoutCount,
    };
  }

  /** 合計の残りを見せる段階か。質問の段階 (時間切れ中を除く) と最終解答の段階。制限なしは false */
  private get isTotalShown(): boolean {
    return this.timeLimitMs > 0 && (this.phase === 'doors-final' || (this.phase === 'doors-asking' && !this.isTimeUp));
  }

  private turnLeft(): number {
    return this.turnDeadlineAt > 0 ? Math.max(0, this.turnDeadlineAt - Date.now()) : (this.turnLeftMs ?? this.turnLimitMs);
  }

  /** 承認待ちの札に出す人数。切断した人のOKは数えない */
  private approvalCounts(p: Proposal, seats: readonly Seat[]): { approvalsNeeded: number; approvalsDone: number } {
    if (p.status !== 'proposed') return { approvalsNeeded: 0, approvalsDone: 0 };
    const needed = this.approvers(p, seats);
    return {
      approvalsNeeded: needed.length,
      approvalsDone: needed.filter((s) => p.approverIds.includes(s.id)).length,
    };
  }
}

/**
 * 10の扉のエンジン。ラウンド (DoorsRound) と制限時間のタイマーを持つ。
 * 設定・GMの抽選の記録・お題などルーム全体の状態は Room に置き、ここから読み書きする
 */
export class DoorsEngine implements GameEngine {
  readonly mode = 'doors' as const;
  /** 進行中のラウンド。ロビーでは null。itoのカード・列とは別に持つ */
  round: DoorsRound | null = null;
  /** 制限時間の締切。発火時に同じラウンドの質問の段階かを確かめるので、終了・中止の経路では止めない */
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly room: Room) {}

  randomTopic(prev?: string): string {
    return randomDoorsTheme(prev);
  }

  /** AIがGMなら、参加者全員が回答者になるので1人でも遊べる */
  minPlayers(): number {
    return this.room.doorsSettings.gmPick === 'ai' ? 1 : 2;
  }

  drawsGmInLobby(): boolean {
    return this.room.doorsSettings.gmPick === 'random';
  }

  start(seated: readonly Player[]): void {
    const room = this.room;
    const { questions, maxLies } = room.doorsSettings;
    if (room.doorsSettings.gmPick === 'ai') {
      if (!isAskConfigured()) throw new GameError('ASK APIの設定が無いため、AIはGMを務められません');
      // 答えは server/index.ts が AI に決めさせる。決まるまでは doors-setup のまま
      this.round = new DoorsRound(AI_GM_ID, questions, maxLies, this.timeLimitMs(), this.turnLimitMs());
      room.round += 1;
      room.notice = 'AIがGMです';
      room.phase = this.round.phase;
      return;
    }
    const gm = this.pickGm(seated);
    this.round = new DoorsRound(gm.id, questions, maxLies, this.timeLimitMs(), this.turnLimitMs());
    room.lastGmId = gm.id;
    room.nextGmId = '';
    room.round += 1;
    room.notice = `${gm.name} さんがGMです`;
    room.phase = this.round.phase;
  }

  /** GMを決める。決められなければ GameError */
  private pickGm(seated: readonly Player[]): Player {
    const { gmPick, gmId } = this.room.doorsSettings;
    if (gmPick === 'named') {
      const gm = seated.find((p) => p.id === gmId);
      if (!gm) throw new GameError('指名したGMが接続していません。GMを指名し直してください');
      return gm;
    }
    this.room.refreshNextGm();
    const gm = seated.find((p) => p.id === this.room.nextGmId);
    if (!gm) throw new GameError('GMを抽選できませんでした');
    return gm;
  }

  private timeLimitMs(): number {
    return this.room.doorsSettings.timeLimitMin * DOORS_MINUTE_MS;
  }

  private turnLimitMs(): number {
    return (this.room.doorsSettings.turnLimitSec / 10) * DOORS_TURN_UNIT_MS;
  }

  /** 質問・最終解答の段階の締切に合わせてタイマーを付け直す。前のタイマーは必ず消す */
  syncTimer(): void {
    this.stopTimers();
    const round = this.round;
    if (!round) return;
    const deadline = round.nextDeadline();
    if (deadline <= 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      // 別のラウンドに替わっていたり、質問・最終解答の段階でなくなっていたりしたら何もしない
      if (this.round !== round || (round.phase !== 'doors-asking' && round.phase !== 'doors-final')) return;
      if (!round.fireDeadline()) return this.syncTimer();
      this.room.phase = round.phase;
      this.syncTimer();
      try {
        this.room.onDoorsTimeUp?.();
      } catch (e) {
        console.error('doors time-up broadcast failed', e);
      }
    }, Math.max(1, deadline - Date.now()));
  }

  stopTimers(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  reset(): void {
    this.stopTimers();
    this.round = null;
  }

  open(): void {
    throw new GameError('いまはオープンできません');
  }

  dispose(): void {
    this.stopTimers();
  }
}
