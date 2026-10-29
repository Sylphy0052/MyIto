import { randomUUID } from 'node:crypto';
import {
  LIMITS,
  type CardState,
  type Mode,
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
  mode: Mode = 'coop';
  cardsPerPlayer = 1;
  topic = randomTopic();
  topicSource: TopicSource = 'random';
  aiBusy = false;
  notice = '';
  round = 0;
  players: Player[] = [];
  cards: Card[] = [];
  field: string[] = [];
  misses = 0;
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
      return existing;
    }
    // 席が外れた古い token で新しい席を作らない。クライアントはセッションを捨てて入り直す
    if (token) throw new GameError('席が見つかりません。もう一度入室してください');
    if (!name) throw new GameError('ニックネームを入力してください');
    if (this.players.length >= LIMITS.maxPlayers) this.pruneAway();
    if (this.players.length >= LIMITS.maxPlayers) throw new GameError('ルームが満員です');
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
      } else if (!holdsCards) {
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

  setSettings(playerId: string, mode: unknown, cardsPerPlayer: unknown): void {
    this.requireHost(playerId);
    if (this.phase !== 'lobby') throw new GameError('ロビーでだけ変更できます');
    if (mode === 'coop' || mode === 'free') this.mode = mode;
    const n = Number(cardsPerPlayer);
    if (Number.isInteger(n) && n >= 1 && n <= LIMITS.maxCardsPerPlayer) this.cardsPerPlayer = n;
  }

  setTopic(playerId: string, topic: string, source: TopicSource): void {
    this.requireHost(playerId);
    if (this.phase !== 'lobby') throw new GameError('お題はロビーでだけ変更できます');
    if (!topic) throw new GameError('お題を入力してください');
    this.topic = topic;
    this.topicSource = source;
  }

  start(playerId: string): void {
    this.requireHost(playerId);
    if (this.phase !== 'lobby') throw new GameError('すでに始まっています');
    const seated = this.players.filter((p) => p.connected);
    if (seated.length < 2) throw new GameError('2人以上で始めてください');
    const total = seated.length * this.cardsPerPlayer;
    if (total > MAX_VALUE) throw new GameError('枚数が多すぎます');

    const values = shuffle(Array.from({ length: MAX_VALUE }, (_, i) => i + 1)).slice(0, total);
    this.cards = seated.flatMap((p, pi) =>
      values
        .slice(pi * this.cardsPerPlayer, (pi + 1) * this.cardsPerPlayer)
        .sort((a, b) => a - b)
        .map((value) => ({ id: randomUUID(), ownerId: p.id, value, hint: '', state: 'hand' as const })),
    );
    this.field = [];
    this.misses = 0;
    this.order = this.mode === 'free' ? shuffle(this.cards.map((c) => c.id)) : [];
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
    this.field = [];
    this.order = [];
    this.revealed = 0;
    this.misses = 0;
    this.notice = '';
  }

  // ---- カード ----

  private ownCard(playerId: string, cardId: unknown): Card {
    const card = this.cards.find((c) => c.id === cardId);
    if (!card || card.ownerId !== playerId) throw new GameError('自分のカードではありません');
    return card;
  }

  setHint(playerId: string, cardId: unknown, hint: string): void {
    if (this.phase === 'lobby') throw new GameError('ゲーム中だけ書き込めます');
    this.ownCard(playerId, cardId).hint = hint;
  }

  /** 協力モード: カードを場に出す。より小さい手札が残っていればミスとして公開して捨てる */
  play(playerId: string, cardId: unknown): void {
    if (this.phase !== 'playing' || this.mode !== 'coop') throw new GameError('いまは出せません');
    const card = this.ownCard(playerId, cardId);
    if (card.state !== 'hand') throw new GameError('そのカードは出ています');

    const skipped = this.cards
      .filter((c) => c.state === 'hand' && c.id !== card.id && c.value < card.value)
      .sort((a, b) => a.value - b.value);
    for (const c of skipped) c.state = 'discarded';
    card.state = 'played';
    this.field = [...this.field, ...skipped.map((c) => c.id), card.id];
    this.misses += skipped.length;

    const player = this.players.find((p) => p.id === playerId);
    this.notice =
      skipped.length > 0
        ? `${player?.name ?? '?'} さんの ${card.value} より小さいカードが${skipped.length}枚残っていました (ミス+${skipped.length})`
        : '';
    if (this.cards.every((c) => c.state !== 'hand')) this.phase = 'result';
  }

  /** 自由配置モード: 列の中でカードを動かす。誰でも動かせる */
  move(cardId: unknown, toIndex: unknown): void {
    if (this.phase !== 'playing' || this.mode !== 'free') throw new GameError('いまは動かせません');
    const from = this.order.indexOf(cardId as string);
    const to = Number(toIndex);
    if (from < 0 || !Number.isInteger(to) || to < 0 || to >= this.order.length) {
      throw new GameError('動かせない位置です');
    }
    const next = this.order.filter((id) => id !== cardId);
    next.splice(to, 0, cardId as string);
    this.order = next;
  }

  /** 自由配置モード: 左から1枚ずつめくる。onStep は1枚めくるたびに呼ぶ */
  open(playerId: string, intervalMs: number, onStep: () => void): void {
    this.requireHost(playerId);
    if (this.phase !== 'playing' || this.mode !== 'free') throw new GameError('いまはオープンできません');
    this.phase = 'revealing';
    this.revealed = 0;
    this.revealTimer = setInterval(() => {
      this.revealed += 1;
      if (this.revealed >= this.order.length) {
        this.stopReveal();
        this.misses = this.countFreeMisses();
        this.phase = 'result';
      }
      onStep();
    }, intervalMs);
  }

  private countFreeMisses(): number {
    const values = this.order.map((id) => this.cards.find((c) => c.id === id)!.value);
    return values.filter((v, i) => i > 0 && v < values[i - 1]!).length;
  }

  stopReveal(): void {
    if (this.revealTimer) clearInterval(this.revealTimer);
    this.revealTimer = null;
  }

  // ---- 表示 ----

  private isRevealed(card: Card): boolean {
    if (this.phase === 'result') return true;
    if (this.mode === 'coop') return card.state !== 'hand';
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
      mode: this.mode,
      cardsPerPlayer: this.cardsPerPlayer,
      topic: this.topic,
      topicSource: this.topicSource,
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
      field: this.field,
      misses: this.misses,
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
