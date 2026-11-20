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
  approverName: string;
  cancelledByName: string;
  reply: DoorsReply | null;
  lie: boolean;
  /** AI GMの正直な回答 (嘘で反転する前)。AIへ渡す履歴に使う */
  honestReply: QuestionReply | null;
  /** AI GMの解答の判定理由。答えを示唆しうるので結果画面まで伏せる */
  reason: string;
}

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
 * | reply / reject | GM | asking / final |
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
  outcome: DoorsOutcome | null = null;
  abortReason = '';
  extendRequestSeq = 0;
  extendRequestBy = '';
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

  /** 承認できる回答者 (接続中・GM以外・提案者以外) の数 */
  private approverCount(p: Proposal, seats: readonly Seat[]): number {
    return seats.filter((s) => s.connected && s.id !== this.gmId && s.id !== p.authorId).length;
  }

  // ---- GMの答え ----

  setAnswer(playerId: string, answer: string): void {
    this.requireGm(playerId);
    if (this.phase !== 'doors-setup') throw new GameError('答えはもう確定しています');
    if (!answer) throw new GameError('答えを入力してください');
    this.answer = answer;
    this.phase = 'doors-asking';
    this.settle();
  }

  // ---- 回答者の操作 ----

  propose(playerId: string, seats: readonly Seat[], kind: unknown, text: string): void {
    this.requirePlaying();
    const seat = this.requireRespondent(playerId, seats);
    if (!text) throw new GameError('内容を入力してください');
    if (this.proposals.length >= LIMITS.doorsLog) throw new GameError('ログが上限に達しました');
    const isFinal = this.phase === 'doors-final';
    if (isFinal) {
      if (this.proposals.some((p) => isActive(p) && p.isFinal)) throw new GameError('最終解答は1件ずつ出せます');
    } else {
      if (kind !== 'question' && kind !== 'guess') throw new GameError('質問か解答を選んでください');
      if (this.activeCount() >= this.limit - this.used) throw new GameError('残り回数を超えて提案できません');
      const mine = this.proposals.filter((p) => p.authorId === playerId && p.status === 'proposed').length;
      if (mine >= LIMITS.doorsPendingPerPlayer) {
        throw new GameError(`承認待ちは1人${LIMITS.doorsPendingPerPlayer}件までです`);
      }
    }
    this.proposals.push({
      id: randomUUID(),
      seq: this.proposals.length + 1,
      authorId: playerId,
      authorName: seat.name,
      kind: isFinal ? 'guess' : (kind as ProposalKind),
      isFinal,
      text,
      status: 'proposed',
      approverName: '',
      cancelledByName: '',
      reply: null,
      lie: false,
      honestReply: null,
      reason: '',
    });
    this.refresh(seats);
  }

  approve(playerId: string, seats: readonly Seat[], id: unknown): void {
    this.requirePlaying();
    const seat = this.requireRespondent(playerId, seats);
    const p = this.find(id);
    if (p.status !== 'proposed') throw new GameError('この提案は承認待ちではありません');
    if (p.authorId === playerId) throw new GameError('自分の提案は承認できません');
    p.status = 'sent';
    p.approverName = seat.name;
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

  /** 回答を記録して回数を進める。解答の正解で勝ち、最終解答のそれ以外で負け */
  private record(p: Proposal, reply: DoorsReply, isLie: boolean): void {
    p.status = 'answered';
    p.reply = reply;
    p.lie = isLie;
    if (isLie) this.liesUsed += 1;
    if (!p.isFinal) this.used += 1;
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
    this.settle();
  }

  // ---- 延長 ----

  extend(canExtend: boolean, delta: unknown): void {
    if (!canExtend) throw new GameError('延長はホストかGMだけが操作できます');
    this.requirePlaying();
    if (delta === 1) {
      if (this.limit >= LIMITS.doorsMaxTotal) throw new GameError(`質問回数は${LIMITS.doorsMaxTotal}回までです`);
      this.limit += 1;
      if (this.phase === 'doors-final') {
        // 出ている最終解答は、質問フェーズの解答として扱い直す (回数の枠に収まる)
        for (const p of this.proposals) if (isActive(p)) p.isFinal = false;
        this.phase = 'doors-asking';
      }
      return;
    }
    if (delta === -1) {
      const floor = Math.max(1, this.used + this.activeCount());
      if (this.limit - 1 < floor) throw new GameError('使用済みと処理中の回数より減らせません');
      this.limit -= 1;
      this.settle();
      return;
    }
    throw new GameError('延長の値が正しくありません');
  }

  // ---- 進行 ----

  /** 回数を使い切り、処理中の提案が無くなったら最終解答へ進む */
  private settle(): void {
    if (this.phase === 'doors-asking' && this.used >= this.limit && this.activeCount() === 0) {
      this.phase = 'doors-final';
    }
  }

  /**
   * 人の出入りのたびに呼ぶ。承認できる人がいない承認待ちをGMへ送り、
   * 回答者が全員退室していたらラウンドを中止する
   */
  refresh(seats: readonly Seat[]): void {
    if (!this.isRunning) return;
    if (!seats.some((s) => s.id !== this.gmId)) return this.abort('回答者が全員退室しました');
    for (const p of this.proposals) {
      if (p.status === 'proposed' && this.approverCount(p, seats) === 0) p.status = 'sent';
    }
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
  }

  // ---- 表示 ----

  /**
   * 答え・嘘印・嘘の使用数は、GM本人と結果画面にだけ送る。
   * AI GMの判定理由は結果画面でだけ送り、事実メモはどの画面にも送らない
   */
  viewFor(viewerId: string): DoorsView {
    const canSeeSecret = viewerId === this.gmId || this.phase === 'doors-result';
    const isResult = this.phase === 'doors-result';
    return {
      gmId: this.gmId,
      isAiGm: this.isAiGm,
      aiBusy: this.aiBusy,
      aiBusyId: this.aiBusyId,
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
        approverName: p.approverName,
        cancelledByName: p.cancelledByName,
        reply: p.reply,
        lie: canSeeSecret ? p.lie : null,
        reason: isResult && p.reason ? p.reason : null,
      })),
      outcome: this.outcome,
      abortReason: this.abortReason,
      extendRequestSeq: this.extendRequestSeq,
      extendRequestBy: this.extendRequestBy,
    };
  }
}
