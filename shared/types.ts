export type Mode = 'coop' | 'free';
export type Phase = 'lobby' | 'playing' | 'revealing' | 'result';
export type CardState = 'hand' | 'played' | 'discarded';
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
  mode: Mode;
  cardsPerPlayer: number;
  topic: string;
  topicSource: TopicSource;
  aiBusy: boolean;
  notice: string;
  round: number;
  players: PlayerView[];
  cards: CardView[];
  /** 協力モード: 場に出た順 (ミスで捨てたカードも含む) */
  field: string[];
  misses: number;
  /** 自由配置モード: 列の並び (左が小さい側) */
  order: string[];
  /** 自由配置モード: 左からめくった枚数 */
  revealed: number;
}

export type AckResult =
  | { ok: true; code?: string; token?: string }
  /** retry: 一時的な失敗 (タイムアウト、レート制限)。セッションを残して再試行してよい */
  | { ok: false; error: string; retry?: boolean };
export type Ack = (res: AckResult) => void;
