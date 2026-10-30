import { randomUUID } from 'node:crypto';
import {
  LIMITS,
  isReadyToOpen,
  type CardState,
  type Phase,
  type RoomView,
  type TopicSource,
} from '../shared/types';
import { randomTopic } from './topics';

const MAX_VALUE = 100;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

const HOST_GRACE_MS = 30_000;

interface Player {
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

export class GameError extends Error {}

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

export class Room {
  readonly code: string;
  hostId = '';
  phase: Phase = 'lobby';
  cardsPerPlayer = 1;
  topic = randomTopic();
  topicSource: TopicSource = 'random';
  topicCandidates: string[] = [];
  aiBusy = false;
  notice = '';
  round = 0;
  players: Player[] = [];
  cards: Card[] = [];
  order: string[] = [];
  revealed = 0;
  lastActiveAt = Date.now();
  revealTimer: NodeJS.Timeout | null = null;

  constructor(code: string) {
    this.code = code;
  }

  // ---- 参加 ----

  join(name: string, token?: string): Player {
    const existing = token ? this.players.find((p) => p.token === token) : undefined;
    if (existing) {
      existing.connected = true;
      existing.awaySince = null;
      if (name) existing.name = name;
      if (!this.hostId) this.hostId = existing.id;
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
    return player;
  }

  /** 切断中で手札を持たないプレイヤーを席から外す (ホストは残す) */
  private pruneAway(): void {
    this.players = this.players.filter(
      (p) => p.connected || p.id === this.hostId || this.cards.some((c) => c.ownerId === p.id),
    );
  }

  setConnected(playerId: string, connected: boolean): void {
    const p = this.players.find((x) => x.id === playerId);
    if (!p) return;
    p.connected = connected;
    p.awaySince = connected ? null : Date.now();
  }

  /** ホストが猶予を過ぎても切断したままなら、接続中の別プレイヤーへホストを移す */
  reassignHostIfAway(now = Date.now()): boolean {
    const host = this.players.find((p) => p.id === this.hostId);
    if (host && (host.connected || now - (host.awaySince ?? now) < HOST_GRACE_MS)) return false;
    const next = this.players.find((p) => p.connected);
    if (!next) return false;
    this.hostId = next.id;
    this.notice = `${next.name} さんがホストになりました`;
    return true;
  }

  /** 退室。手札を持っていなければ席を外し、持っていれば切断扱いにする */
  leave(playerId: string): void {
    const holdsCards = this.cards.some((c) => c.ownerId === playerId);
    if (holdsCards) this.setConnected(playerId, false);
    else this.players = this.players.filter((p) => p.id !== playerId);
    if (playerId === this.hostId) {
      const next = this.players.find((p) => p.connected && p.id !== playerId);
      if (next) {
        this.hostId = next.id;
        this.notice = `${next.name} さんがホストになりました`;
      } else {
        this.hostId = '';
      }
    }
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
    // 候補から選んだとき以外は、古い候補を残さない
    if (source !== 'ai') this.topicCandidates = [];
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
    if (seated.length < 2) throw new GameError('2人以上で始めてください');
    if (seated.length > LIMITS.maxPlayers) throw new GameError(`${LIMITS.maxPlayers}人以下で始めてください`);
    const total = seated.length * this.cardsPerPlayer;
    if (total > MAX_VALUE) throw new GameError('枚数が多すぎます');

    const values = shuffle(Array.from({ length: MAX_VALUE }, (_, i) => i + 1)).slice(0, total);
    // 配列の並びから同じ持ち主のカードの大小が分からないよう、全体を混ぜてから持つ
    this.cards = shuffle(
      seated.flatMap((p, pi) =>
        values
          .slice(pi * this.cardsPerPlayer, (pi + 1) * this.cardsPerPlayer)
          .map((value) => ({ id: randomUUID(), ownerId: p.id, value, hint: '', state: 'hand' as const })),
      ),
    );
    this.order = [];
    this.revealed = 0;
    this.round += 1;
    this.notice = '';
    this.phase = 'playing';
  }

  backToLobby(playerId: string): void {
    this.requireHost(playerId);
    if (this.phase === 'revealing') throw new GameError('めくり終わるまで待ってください');
    this.stopReveal();
    this.phase = 'lobby';
    this.cards = [];
    this.order = [];
    this.revealed = 0;
    this.notice = '';
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
    this.phase = 'revealing';
    this.revealed = 0;
    this.revealTimer = setInterval(() => {
      this.revealed += 1;
      if (this.revealed >= this.order.length) {
        this.stopReveal();
        this.phase = 'result';
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

  // ---- 表示 ----

  private isRevealed(card: Card): boolean {
    if (this.phase === 'result') return true;
    const idx = this.order.indexOf(card.id);
    return idx >= 0 && idx < this.revealed;
  }

  /** viewer 向けの状態。本人のカードと公開済みのカード以外の数字は送らない */
  viewFor(viewerId: string): RoomView {
    return {
      code: this.code,
      you: viewerId,
      hostId: this.hostId,
      phase: this.phase,
      cardsPerPlayer: this.cardsPerPlayer,
      topic: this.topic,
      topicSource: this.topicSource,
      topicCandidates: this.topicCandidates,
      aiBusy: this.aiBusy,
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
