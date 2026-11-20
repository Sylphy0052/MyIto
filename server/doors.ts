import { randomUUID } from 'node:crypto';
import {
  GUESS_REPLIES,
  LIMITS,
  QUESTION_REPLIES,
  type DoorsOutcome,
  type DoorsPhase,
  type DoorsReply,
  type DoorsView,
  type ProposalKind,
  type ProposalStatus,
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
}


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

  constructor(
    readonly gmId: string,
    public limit: number,
    readonly maxLies: number,
  ) {}

  get isRunning(): boolean {
    return this.phase !== 'doors-result';
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
    p.status = 'answered';
    p.reply = reply as DoorsReply;
    p.lie = isLie;
    if (isLie) this.liesUsed += 1;
    if (!p.isFinal) this.used += 1;
    if (p.kind === 'guess' && reply === 'correct') return this.finish('win');
    if (p.isFinal) return this.finish('lose');
    this.settle();
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
    this.outcome = outcome;
    this.phase = 'doors-result';
  }

  // ---- 表示 ----

  /** 答え・嘘印・嘘の使用数は、GM本人と結果画面にだけ送る */
  viewFor(viewerId: string): DoorsView {
    const canSeeSecret = viewerId === this.gmId || this.phase === 'doors-result';
    return {
      gmId: this.gmId,
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
      })),
      outcome: this.outcome,
      abortReason: this.abortReason,
      extendRequestSeq: this.extendRequestSeq,
      extendRequestBy: this.extendRequestBy,
    };
  }
}
