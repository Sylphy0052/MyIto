export type Phase = 'lobby' | 'playing' | 'revealing' | 'result';
export type CardState = 'hand' | 'placed';
export type TopicSource = 'random' | 'custom' | 'ai' | 'ai-fallback';

export const LIMITS = {
  name: 16,
  hint: 40,
  topic: 60,
  genre: 20,
  maxPlayers: 14,
  maxCardsPerPlayer: 5,
} as const;

export interface PlayerView {
  id: string;
  name: string;
  connected: boolean;
}

export interface CardView {
  id: string;
  ownerId: string;
  /** 本人のカードと公開済みのカードだけ数字が入る。それ以外は null */
  value: number | null;
  hint: string;
  state: CardState;
}

export interface RoomView {
  code: string;
  you: string;
  hostId: string;
  phase: Phase;
  cardsPerPlayer: number;
  topic: string;
  topicSource: TopicSource;
  aiBusy: boolean;
  notice: string;
  round: number;
  players: PlayerView[];
  cards: CardView[];
  /** 列に置いたカードの並び (左が小さい側) */
  order: string[];
  /** 左からめくった枚数 */
  revealed: number;
}

export type AckResult =
  | { ok: true; code?: string; token?: string }
  /** retry: 一時的な失敗 (タイムアウト、レート制限)。セッションを残して再試行してよい */
  | { ok: false; error: string; retry?: boolean };
export type Ack = (res: AckResult) => void;

/**
 * オープンできるか。接続中の人のカードが全部列に置かれ、列が空でないこと。
 * 切断中の人の手札は待たない (本人しか置けず、進行が止まるため)
 */
export function isReadyToOpen(
  cards: readonly { ownerId: string; state: CardState }[],
  players: readonly { id: string; connected: boolean }[],
): boolean {
  const connected = new Set(players.filter((p) => p.connected).map((p) => p.id));
  return (
    cards.some((c) => c.state === 'placed') &&
    cards.every((c) => c.state === 'placed' || !connected.has(c.ownerId))
  );
}
