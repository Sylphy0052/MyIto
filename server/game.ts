import { randomUUID } from 'node:crypto';
import {
  DOORS_AI_MODELS,
  DOORS_DEFAULT_QUESTIONS,
  DOORS_TIME_LIMITS,
  DOORS_TURN_LIMITS,
  LIMITS,
  isReadyToOpen,
  type CardState,
  type DoorsSettings,
  type GameMode,
  type Phase,
  type RoomView,
  type TopicSource,
  type TopicSuggestionView,
} from '../shared/types';
import { randomTopic } from './topics';
import { DoorsEngine, type DoorsRound, type Seat } from './doors';
import { GameError } from './errors';
import { DOORS_MODEL, isAskConfigured } from './ai';

/** AI GMが同じルームで使った答えを覚えておく数。次の答えを決めるときに避けさせる */
const AI_ANSWER_MEMORY = 30;

export { GameError };

const MAX_VALUE = 100;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** お題の案を同じ人が続けて送れる最短の間隔 */
export const SUGGEST_INTERVAL_MS = 5_000;

const HOST_GRACE_MS = 30_000;
export const GM_GRACE_MS = 30_000;

export interface Player {
  /** 全員に配信する公開ID */
  id: string;
  /** 再入室用の秘密。本人にだけ返し、配信しない */
  token: string;
  name: string;
  connected: boolean;
  awaySince: number | null;
}

interface Card {
  id: string;
  ownerId: string;
  value: number;
  hint: string;
  state: CardState;
}

export function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

/** 0 以上 max 以下の整数か。Number() を通さず、null や true を位置として受け付けない */
function isIndex(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
}

function shuffle<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * ゲーム種別ごとの処理。Room は種別で場合分けせず、この共通メソッドだけを呼ぶ。
 * 種別だけの操作 (itoのオープン、10の扉の各操作) は、それぞれのエンジンが持つ
 */
export interface GameEngine {
  readonly mode: GameMode;
  /** 内蔵リストのお題 (10の扉ではテーマ)。prev と同じものは避ける */
  randomTopic(prev?: string): string;
  /** 開始に要る接続中の人数 */
  minPlayers(): number;
  /** ロビーで次のGMを先に引いておく設定か */
  drawsGmInLobby(): boolean;
  /** ラウンドを始める。始められなければ GameError */
  start(seated: readonly Player[]): void;
  /** 片付け。動いているタイマーを全て止める */
  dispose(): void;
}

/** itoのエンジン。カード・列は配信でも使うので Room に置き、めくりのタイマーだけを持つ */
class ItoEngine implements GameEngine {
  readonly mode = 'ito' as const;
  private revealTimer: NodeJS.Timeout | null = null;

  constructor(private readonly room: Room) {}

  randomTopic(prev?: string): string {
    return randomTopic(prev);
  }

  minPlayers(): number {
    return 2;
  }

  drawsGmInLobby(): boolean {
    return false;
  }

  start(seated: readonly Player[]): void {
    const room = this.room;
    const total = seated.length * room.cardsPerPlayer;
    if (total > MAX_VALUE) throw new GameError('枚数が多すぎます');

    const values = shuffle(Array.from({ length: MAX_VALUE }, (_, i) => i + 1)).slice(0, total);
    // 配列の並びから同じ持ち主のカードの大小が分からないよう、全体を混ぜてから持つ
    room.cards = shuffle(
      seated.flatMap((p, pi) =>
        values
          .slice(pi * room.cardsPerPlayer, (pi + 1) * room.cardsPerPlayer)
          .map((value) => ({ id: randomUUID(), ownerId: p.id, value, hint: '', state: 'hand' as const })),
      ),
    );
    room.order = [];
    room.revealed = 0;
    room.round += 1;
    room.notice = '';
    room.phase = 'playing';
  }

  /** 左から1枚ずつめくる。onStep は1枚めくるたびに呼ぶ */
  reveal(intervalMs: number, onStep: () => void): void {
    const room = this.room;
    room.phase = 'revealing';
    room.revealed = 0;
    this.revealTimer = setInterval(() => {
      room.revealed += 1;
      if (room.revealed >= room.order.length) {
        this.stopReveal();
        room.phase = 'result';
      }
      try {
        onStep();
      } catch (e) {
        console.error('reveal broadcast failed', e);
      }
    }, intervalMs);
  }

  stopReveal(): void {
    if (this.revealTimer) clearInterval(this.revealTimer);
    this.revealTimer = null;
  }

  dispose(): void {
    this.stopReveal();
  }
}

export class Room {
  readonly code: string;
  hostId = '';
  phase: Phase = 'lobby';
  private readonly ito = new ItoEngine(this);
  private readonly doorsEngine = new DoorsEngine(this);
  private readonly engines: Readonly<Record<GameMode, GameEngine>> = { ito: this.ito, doors: this.doorsEngine };
  /** 今のゲーム種別のエンジン。切り替えるのはロビーでだけ */
  private engine: GameEngine = this.ito;
  doorsSettings: DoorsSettings = { gmPick: 'random', gmId: '', questions: DOORS_DEFAULT_QUESTIONS, maxLies: 0, timeLimitMin: 0, turnLimitSec: 0, aiModel: DOORS_MODEL };
  /** 直前のラウンドのGM。ランダムで続けて当たらないようにする */
  lastGmId = '';
  /** GMがランダムのとき、ロビーで先に引いておいた次のGM。開始時はこの人がGMになる */
  nextGmId = '';
  /** AI GMがこのルームで使った答え (古い順) */
  aiAnswers: string[] = [];
  cardsPerPlayer = 1;
  topic = randomTopic();
  topicSource: TopicSource = 'random';
  topicCandidates: string[] = [];
  /** ホスト以外が送ったお題の案 */
  topicSuggestions: (TopicSuggestionView)[] = [];
  /** 案を最後に送った時刻 (playerId ごと) */
  private lastSuggestAt = new Map<string, number>();
  aiBusy = false;
  notice = '';
  round = 0;
  players: Player[] = [];
  cards: Card[] = [];
  order: string[] = [];
  revealed = 0;
  lastActiveAt = Date.now();
  /** 時間切れの処理が済んだあとの配信 (server/index.ts が入れる) */
  onDoorsTimeUp: (() => void) | null = null;

  constructor(code: string) {
    this.code = code;
  }

  get mode(): GameMode {
    return this.engine.mode;
  }

  /** 10の扉のラウンド。ロビーでは null */
  get doors(): DoorsRound | null {
    return this.doorsEngine.round;
  }

  /** ルームを捨てる前の片付け。動いているタイマーを全て止める */
  dispose(): void {
    this.engine.dispose();
  }

  // ---- 参加 ----

  join(name: string, token?: string): Player {
    const existing = token ? this.players.find((p) => p.token === token) : undefined;
    if (existing) {
      existing.connected = true;
      existing.awaySince = null;
      if (name) existing.name = name;
      if (!this.hostId) this.hostId = existing.id;
      this.refreshDoors();
      return existing;
    }
    // 席が外れた古い token で新しい席を作らない。クライアントはセッションを捨てて入り直す
    if (token) throw new GameError('席が見つかりません。もう一度入室してください');
    if (!name) throw new GameError('ニックネームを入力してください');
    if (this.players.length >= LIMITS.maxPlayers) this.pruneAway();
    // 全員不在で手札の席が満室を占める場合は、復旧する観戦者を1人だけ受け入れる
    const recoverySeat = this.phase === 'playing' && !this.hasConnected() && this.players.length === LIMITS.maxPlayers;
    if (this.players.length >= LIMITS.maxPlayers && !recoverySeat) throw new GameError('ルームが満員です');
    const player: Player = { id: randomUUID(), token: randomUUID(), name, connected: true, awaySince: null };
    this.players.push(player);
    if (!this.hostId || !this.players.some((p) => p.id === this.hostId)) this.hostId = player.id;
    // 途中参加者は回答者に入る
    this.refreshDoors();
    return player;
  }

  /** 席を外してはいけないか (手札を持つ人、ラウンド中のGM) */
  private holdsSeat(playerId: string): boolean {
    return this.cards.some((c) => c.ownerId === playerId) || this.isRunningGm(playerId);
  }

  /** 進行中の10の扉のGMか */
  isRunningGm(playerId: string): boolean {
    return !!this.doors && this.doors.isRunning && this.doors.gmId === playerId;
  }

  /** 切断中で手札を持たないプレイヤーを席から外す (ホストとラウンド中のGMは残す) */
  private pruneAway(): void {
    const removed = this.players.filter((p) => !p.connected && p.id !== this.hostId && !this.holdsSeat(p.id));
    this.players = this.players.filter((p) => !removed.includes(p));
    for (const p of removed) {
      this.doors?.dropAuthor(p.id);
      this.dropSuggestions(p.id);
    }
  }

  setConnected(playerId: string, connected: boolean): void {
    const p = this.players.find((x) => x.id === playerId);
    if (!p) return;
    p.connected = connected;
    p.awaySince = connected ? null : Date.now();
    this.refreshDoors();
  }

  private seats(): Seat[] {
    return this.players.map((p) => ({ id: p.id, name: p.name, connected: p.connected }));
  }

  /** 人の出入りに合わせて10の扉の状態を判定し直す */
  private refreshDoors(): void {
    if (!this.doors) return;
    this.doors.refresh(this.seats());
    this.phase = this.doors.phase;
    this.syncDoorsTimer();
  }

  /** GMが猶予を過ぎても切断したままなら、ラウンドを中止する (答えを知らない人へGMを移せないため) */
  abortIfGmAway(now = Date.now()): boolean {
    if (!this.doors?.isRunning || this.doors.isAiGm) return false;
    const gm = this.players.find((p) => p.id === this.doors!.gmId);
    if (gm && (gm.connected || now - (gm.awaySince ?? now) < GM_GRACE_MS)) return false;
    this.doors.abort('GMが30秒以上切断しました');
    this.phase = this.doors.phase;
    this.doorsEngine.stopTimer();
    return true;
  }

  /** ホストが猶予を過ぎても切断したままなら、接続中の別プレイヤーへホストを移す */
  reassignHostIfAway(now = Date.now()): boolean {
    const host = this.players.find((p) => p.id === this.hostId);
    if (host && (host.connected || now - (host.awaySince ?? now) < HOST_GRACE_MS)) return false;
    const next = this.players.find((p) => p.connected);
    if (!next) return false;
    this.hostId = next.id;
    this.dropSuggestions(next.id);
    this.notice = `${next.name} さんがホストになりました`;
    return true;
  }

  /** 退室。手札を持っていなければ席を外し、持っていれば切断扱いにする */
  leave(playerId: string): void {
    if (this.holdsSeat(playerId)) this.setConnected(playerId, false);
    else {
      this.players = this.players.filter((p) => p.id !== playerId);
      this.doors?.dropAuthor(playerId);
      this.dropSuggestions(playerId);
    }
    if (playerId === this.hostId) {
      const next = this.players.find((p) => p.connected && p.id !== playerId);
      if (next) {
        this.hostId = next.id;
        this.dropSuggestions(next.id);
        this.notice = `${next.name} さんがホストになりました`;
      } else {
        this.hostId = '';
      }
    }
    this.refreshDoors();
  }

  hasConnected(): boolean {
    return this.players.some((p) => p.connected);
  }

  private requireHost(playerId: string): void {
    if (playerId !== this.hostId) throw new GameError('ホストだけが操作できます');
  }

  // ---- ロビー ----

  setSettings(playerId: string, cardsPerPlayer: unknown): void {
    this.requireHost(playerId);
    if (this.phase !== 'lobby') throw new GameError('ロビーでだけ変更できます');
    const n = Number(cardsPerPlayer);
    if (Number.isInteger(n) && n >= 1 && n <= LIMITS.maxCardsPerPlayer) this.cardsPerPlayer = n;
  }

  setTopic(playerId: string, topic: string, source: TopicSource): void {
    this.requireHost(playerId);
    if (this.phase !== 'lobby') throw new GameError('お題はロビーでだけ変更できます');
    // 生成中に決めたお題は生成完了時に上書きされるので受け付けない
    if (this.aiBusy) throw new GameError('AIがお題を考え中です');
    if (!topic) throw new GameError('お題を入力してください');
    this.topic = topic;
    this.topicSource = source;
    // お題になった案は一覧から消す
    this.topicSuggestions = this.topicSuggestions.filter((x) => x.text !== topic);
    // 候補から選んだとき以外は、古い候補を残さない
    if (source !== 'ai') this.topicCandidates = [];
  }

  // ---- お題の案 (ホスト以外が送り、ホストが入力欄へコピーして使う) ----

  private dropSuggestions(playerId: string): void {
    this.topicSuggestions = this.topicSuggestions.filter((x) => x.authorId !== playerId);
    this.lastSuggestAt.delete(playerId);
  }

  /** text は呼び出し側で cleanText を通す */
  suggestTopic(playerId: string, text: string, now = Date.now()): void {
    if (this.phase !== 'lobby') throw new GameError('お題はロビーでだけ変更できます');
    if (playerId === this.hostId) throw new GameError('ホストはお題を直接決められます');
    if (!text) throw new GameError('お題を入力してください');
    if (this.topicSuggestions.filter((x) => x.authorId === playerId).length >= LIMITS.topicSuggestionsPerPlayer) {
      throw new GameError(`案は1人${LIMITS.topicSuggestionsPerPlayer}件までです。取り下げてから送ってください`);
    }
    const last = this.lastSuggestAt.get(playerId);
    if (last !== undefined && now - last < SUGGEST_INTERVAL_MS) {
      throw new GameError(`案は${SUGGEST_INTERVAL_MS / 1000}秒に1件まで送れます`);
    }
    if (text === this.topic || this.topicSuggestions.some((x) => x.text === text)) {
      throw new GameError('同じ案がすでにあります');
    }
    this.topicSuggestions.push({ id: randomUUID(), authorId: playerId, text });
    this.lastSuggestAt.set(playerId, now);
  }

  /** 送った本人の取り下げ */
  withdrawSuggestion(playerId: string, id: unknown): void {
    const target = this.topicSuggestions.find((x) => x.id === id && x.authorId === playerId);
    if (!target) throw new GameError('案が見つかりません');
    this.topicSuggestions = this.topicSuggestions.filter((x) => x !== target);
  }

  dismissSuggestion(playerId: string, id: unknown): void {
    this.requireHost(playerId);
    const target = this.topicSuggestions.find((x) => x.id === id);
    if (!target) throw new GameError('案が見つかりません');
    this.topicSuggestions = this.topicSuggestions.filter((x) => x !== target);
  }

  /** 内蔵リストからお題 (10の扉ではテーマ) を出し直す */
  randomizeTopic(playerId: string): void {
    this.setTopic(playerId, this.engine.randomTopic(this.topic), 'random');
  }

  /** ゲーム種別を切り替える。お題と候補は種別ごとに意味が違うので出し直す */
  setMode(playerId: string, mode: unknown): void {
    this.requireHost(playerId);
    if (this.phase !== 'lobby') throw new GameError('ロビーでだけ変更できます');
    if (this.aiBusy) throw new GameError('AIがお題を考え中です');
    if (mode !== 'ito' && mode !== 'doors') throw new GameError('ゲームの種類が正しくありません');
    const next = this.engines[mode];
    if (next === this.engine) return;
    // ロビーでは前の種別のタイマーは要らない。止めておけば、ルームの片付けは今のエンジンだけで済む
    this.engine.dispose();
    this.engine = next;
    this.topicCandidates = [];
    this.topicSuggestions = [];
    this.topic = next.randomTopic();
    this.topicSource = 'random';
    this.notice = '';
  }

  setDoorsSettings(playerId: string, p: Record<string, unknown>): void {
    this.requireHost(playerId);
    if (this.phase !== 'lobby') throw new GameError('ロビーでだけ変更できます');
    const next = { ...this.doorsSettings };
    if (p.gmPick === 'random' || p.gmPick === 'named') next.gmPick = p.gmPick;
    if (p.gmPick === 'ai') {
      if (!isAskConfigured()) throw new GameError('ASK APIの設定が無いため、AIはGMを務められません');
      next.gmPick = 'ai';
    }
    if (typeof p.gmId === 'string' && (p.gmId === '' || this.players.some((x) => x.id === p.gmId))) next.gmId = p.gmId;
    if (isIndex(p.questions, LIMITS.doorsMaxQuestions) && p.questions >= 1) next.questions = p.questions;
    if (isIndex(p.maxLies, LIMITS.doorsMaxLies)) next.maxLies = p.maxLies;
    if (typeof p.timeLimitMin === 'number' && DOORS_TIME_LIMITS.includes(p.timeLimitMin)) next.timeLimitMin = p.timeLimitMin;
    if (typeof p.turnLimitSec === 'number' && DOORS_TURN_LIMITS.includes(p.turnLimitSec)) next.turnLimitSec = p.turnLimitSec;
    const model = DOORS_AI_MODELS.find((m) => m === p.aiModel);
    if (model) next.aiModel = model;
    this.doorsSettings = next;
  }

  /** ロビーで10の扉のGMをランダムに決める設定か。このときだけ次のGMを先に引いておく */
  private isRandomGmLobby(): boolean {
    return this.phase === 'lobby' && this.engine.drawsGmInLobby();
  }

  /** ランダムのGMの抽選対象。3人以上なら、直前のGMを外す */
  private randomGmPool(): Player[] {
    const seated = this.players.filter((p) => p.connected);
    return seated.length >= 3 ? seated.filter((p) => p.id !== this.lastGmId) : seated;
  }

  /**
   * 次のGM (nextGmId) を今の状態に合わせて決め直す。状態を配る前と、開始時に呼ぶ。
   * ロビーでGMがランダムなら、引いた人が抽選対象から外れた (切断・退出など) ときだけ引き直す。それ以外では空にする
   */
  refreshNextGm(): void {
    if (!this.isRandomGmLobby()) {
      this.nextGmId = '';
      return;
    }
    const pool = this.randomGmPool();
    if (pool.some((p) => p.id === this.nextGmId)) return;
    this.nextGmId = pool.length === 0 ? '' : pool[Math.floor(Math.random() * pool.length)]!.id;
  }

  /** ホストが次のGMを引き直す。今の人以外から引く */
  rerollGm(playerId: string): void {
    this.requireHost(playerId);
    if (!this.isRandomGmLobby()) throw new GameError('ロビーでGMがランダムのときだけ引き直せます');
    const others = this.randomGmPool().filter((p) => p.id !== this.nextGmId);
    if (others.length === 0) throw new GameError('ほかに引ける人がいません');
    this.nextGmId = others[Math.floor(Math.random() * others.length)]!.id;
  }

  /** 質問・最終解答の段階の締切に合わせて、10の扉のタイマーを付け直す */
  syncDoorsTimer(): void {
    this.doorsEngine.syncTimer();
  }

  /** 10の扉の操作を実行し、ラウンドのフェーズを部屋へ写す */
  doorsAction(fn: (round: DoorsRound, seats: Seat[]) => void): void {
    // ラウンドは10の扉のエンジンだけが作り、種別はラウンドの無いロビーでしか替えられないので、種別は確かめなくてよい
    const round = this.doors;
    if (!round) throw new GameError('10の扉のラウンド中ではありません');
    fn(round, this.seats());
    this.phase = round.phase;
    this.syncDoorsTimer();
  }

  pickCandidate(playerId: string, index: unknown): void {
    const topic = Number.isInteger(index) ? this.topicCandidates[index as number] : undefined;
    if (topic === undefined) throw new GameError('候補が見つかりません');
    this.setTopic(playerId, topic, 'ai');
  }

  start(playerId: string): void {
    this.requireHost(playerId);
    if (this.phase !== 'lobby') throw new GameError('すでに始まっています');
    if (this.aiBusy) throw new GameError('AIがお題を考え中です');
    const seated = this.players.filter((p) => p.connected);
    if (seated.length < this.engine.minPlayers()) throw new GameError('2人以上で始めてください');
    if (seated.length > LIMITS.maxPlayers) throw new GameError(`${LIMITS.maxPlayers}人以下で始めてください`);
    this.topicSuggestions = [];
    this.lastSuggestAt.clear();
    this.engine.start(seated);
  }

  backToLobby(playerId: string): void {
    this.requireHost(playerId);
    if (this.phase === 'revealing') throw new GameError('めくり終わるまで待ってください');
    // 10の扉の途中なら、まず中止して答えとログを公開する。ロビーへは結果画面から戻る
    if (this.doors?.isRunning) {
      this.doors.abort('ホストが中止しました');
      this.phase = this.doors.phase;
      this.doorsEngine.stopTimer();
      return;
    }
    this.ito.stopReveal();
    this.doorsEngine.round = null;
    this.phase = 'lobby';
    this.cards = [];
    this.order = [];
    this.revealed = 0;
    this.notice = '';
  }

  /** AI GMが決めた答えを確定し、次のラウンドで避けられるよう覚える */
  setAiAnswer(round: DoorsRound, answer: string, memo: string): void {
    round.setAiAnswer(answer, memo);
    this.aiAnswers = [...this.aiAnswers, answer].slice(-AI_ANSWER_MEMORY);
    this.phase = round.phase;
    this.syncDoorsTimer();
  }

  /** AI GMが答えを決められなかった。ロビーへ戻して知らせる (内蔵リストへは切り替えない) */
  failAiAnswer(round: DoorsRound): void {
    round.endAiAnswer();
    if (this.doors !== round || round.phase !== 'doors-setup') return;
    this.doorsEngine.round = null;
    this.phase = 'lobby';
    this.notice = 'AIが答えを決められなかったので、ロビーに戻りました。もう一度開始してください';
  }

  // ---- カード ----

  private ownCard(playerId: string, cardId: unknown): Card {
    const card = this.cards.find((c) => c.id === cardId);
    if (!card || card.ownerId !== playerId) throw new GameError('自分のカードではありません');
    return card;
  }

  setHint(playerId: string, cardId: unknown, hint: string): void {
    if (this.phase !== 'playing') throw new GameError('めくり始める前だけ書き込めます');
    this.ownCard(playerId, cardId).hint = hint;
  }

  /** 自分の手札を列の toIndex の位置に置く */
  place(playerId: string, cardId: unknown, toIndex: unknown): void {
    if (this.phase !== 'playing') throw new GameError('いまは置けません');
    const card = this.ownCard(playerId, cardId);
    if (card.state !== 'hand') throw new GameError('そのカードは置いてあります');
    if (!isIndex(toIndex, this.order.length)) throw new GameError('置けない位置です');
    card.state = 'placed';
    this.order = [...this.order.slice(0, toIndex), card.id, ...this.order.slice(toIndex)];
  }

  /** 列に置いた自分のカードを手札へ戻す */
  unplace(playerId: string, cardId: unknown): void {
    if (this.phase !== 'playing') throw new GameError('いまは戻せません');
    const card = this.ownCard(playerId, cardId);
    if (card.state !== 'placed') throw new GameError('そのカードは手札にあります');
    card.state = 'hand';
    this.order = this.order.filter((id) => id !== card.id);
  }

  /** 列の中でカードを動かす。誰でも動かせる */
  move(cardId: unknown, toIndex: unknown): void {
    if (this.phase !== 'playing') throw new GameError('いまは動かせません');
    const from = this.order.indexOf(cardId as string);
    if (from < 0 || !isIndex(toIndex, this.order.length - 1)) throw new GameError('動かせない位置です');
    const next = this.order.filter((id) => id !== cardId);
    next.splice(toIndex, 0, cardId as string);
    this.order = next;
  }

  /** 全員が置き終わったら、左から1枚ずつめくる。onStep は1枚めくるたびに呼ぶ */
  open(playerId: string, intervalMs: number, onStep: () => void): void {
    this.requireHost(playerId);
    if (this.phase !== 'playing') throw new GameError('いまはオープンできません');
    if (!isReadyToOpen(this.cards, this.players)) throw new GameError('全員のカードが置かれてからオープンしてください');
    // 切断中の人の手札は答え合わせから外す。置ける本人がいないと進行が止まるため
    const absent = this.players.filter((p) => !p.connected && this.cards.some((c) => c.ownerId === p.id && c.state === 'hand'));
    if (absent.length > 0) {
      this.notice = `${absent.map((p) => p.name).join('、')} さんが不在のため、列に置かれていない手札は答え合わせに含めません`;
    }
    this.ito.reveal(intervalMs, onStep);
  }

  // ---- 表示 ----

  private isRevealed(card: Card): boolean {
    if (this.phase === 'result') return true;
    const idx = this.order.indexOf(card.id);
    return idx >= 0 && idx < this.revealed;
  }

  /**
   * viewer 向けの状態。本人のカードと公開済みのカード以外の数字は送らない。
   * nextGmId は読むだけなので、配る前に refreshNextGm を呼んでおく (server/index.ts の broadcast が呼ぶ)
   */
  viewFor(viewerId: string): RoomView {
    return {
      code: this.code,
      you: viewerId,
      hostId: this.hostId,
      phase: this.phase,
      mode: this.engine.mode,
      doorsSettings: this.doorsSettings,
      doors: this.doors ? this.doors.viewFor(viewerId, this.seats()) : null,
      cardsPerPlayer: this.cardsPerPlayer,
      topic: this.topic,
      topicSource: this.topicSource,
      topicCandidates: this.topicCandidates,
      topicSuggestions: this.topicSuggestions.map((x) => ({ id: x.id, authorId: x.authorId, text: x.text })),
      aiBusy: this.aiBusy,
      aiAvailable: isAskConfigured(),
      nextGmId: this.nextGmId,
      notice: this.notice,
      round: this.round,
      players: this.players.map((p) => ({ id: p.id, name: p.name, connected: p.connected })),
      cards: this.cards.map((c) => ({
        id: c.id,
        ownerId: c.ownerId,
        value: c.ownerId === viewerId || this.isRevealed(c) ? c.value : null,
        hint: c.hint,
        state: c.state,
      })),
      order: this.order,
      revealed: this.revealed,
    };
  }
}

export function newRoomCode(existing: ReadonlyMap<string, unknown>): string {
  for (let i = 0; i < 100; i++) {
    const code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    if (!existing.has(code)) return code;
  }
  throw new GameError('ルームを作れませんでした。もう一度試してください');
}
