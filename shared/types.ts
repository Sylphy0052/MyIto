export type DoorsPhase = 'doors-setup' | 'doors-asking' | 'doors-final' | 'doors-result';
export type Phase = 'lobby' | 'playing' | 'revealing' | 'result' | DoorsPhase;
export type CardState = 'hand' | 'placed';
export type TopicSource = 'random' | 'custom' | 'ai' | 'ai-fallback';
export type GameMode = 'ito' | 'doors';

export const LIMITS = {
  name: 16,
  hint: 40,
  topic: 60,
  genre: 20,
  aiCandidates: 10,
  maxPlayers: 14,
  maxCardsPerPlayer: 5,
  /** 10の扉: 質問・解答の文字数 */
  doorsProposal: 60,
  /** 10の扉: GMの答えの文字数 */
  doorsAnswer: 30,
  /** 10の扉: ロビーで決める質問回数の上限 */
  doorsMaxQuestions: 30,
  /** 10の扉: 延長を含めた質問回数の上限 */
  doorsMaxTotal: 99,
  doorsMaxLies: 3,
  /** 10の扉: 1人が同時に出せる承認待ちの数 */
  doorsPendingPerPlayer: 2,
  /** 10の扉: ログに残す提案の数 */
  doorsLog: 500,
} as const;

export const DOORS_DEFAULT_QUESTIONS = 10;

export function isDoorsPhase(phase: Phase): phase is DoorsPhase {
  return phase.startsWith('doors-');
}

/** AI GMが使えるモデル (ASKのmodelVariant)。実機で200が返った値だけを許可する */
export const DOORS_AI_MODELS = ['gpt-6-luna-thinking', 'gpt-6-luna'] as const;
export type DoorsAiModel = (typeof DOORS_AI_MODELS)[number];
export const DOORS_AI_MODEL_LABEL: Record<DoorsAiModel, string> = {
  'gpt-6-luna-thinking': 'Luna (考えてから答える・推奨)',
  'gpt-6-luna': 'Luna (すぐ答える)',
};

/** ai: AIがGMを務め、参加者全員が回答者になる */
export type GmPick = 'random' | 'named' | 'ai';
export type ProposalKind = 'question' | 'guess';
/** proposed: 承認待ち / sent: GMへ送信済み / discarded: 終了時に未処理のまま破棄 */
export type ProposalStatus = 'proposed' | 'sent' | 'answered' | 'rejected' | 'cancelled' | 'discarded';
export type QuestionReply = 'yes' | 'no' | 'maybe-yes' | 'maybe-no' | 'unknown';
export type GuessReply = 'correct' | 'close' | 'wrong';
export type DoorsReply = QuestionReply | GuessReply;
export type DoorsOutcome = 'win' | 'lose' | 'aborted';

export const QUESTION_REPLIES: readonly QuestionReply[] = ['yes', 'maybe-yes', 'unknown', 'maybe-no', 'no'];
export const GUESS_REPLIES: readonly GuessReply[] = ['correct', 'close', 'wrong'];

export interface DoorsSettings {
  gmPick: GmPick;
  /** gmPick が named のときのGM */
  gmId: string;
  questions: number;
  maxLies: number;
  /** gmPick が ai のときに使うモデル */
  aiModel: DoorsAiModel;
}

export interface ProposalView {
  id: string;
  /** 通し番号 (1始まり) */
  seq: number;
  authorId: string;
  authorName: string;
  kind: ProposalKind;
  /** 最終解答か */
  isFinal: boolean;
  text: string;
  status: ProposalStatus;
  approverName: string;
  cancelledByName: string;
  reply: DoorsReply | null;
  /** 嘘印。GM本人と結果画面にだけ入る。それ以外は null */
  lie: boolean | null;
  /** AI GMの解答の判定理由。結果画面にだけ入る。それ以外は null */
  reason: string | null;
}

export interface DoorsView {
  gmId: string;
  /** AIがGMを務めているか */
  isAiGm: boolean;
  /** AI GMが答えを決めている、または提案に答えている最中か */
  aiBusy: boolean;
  /** AI GMが答えている最中の提案。取り消せない。無ければ空 */
  aiBusyId: string;
  /** AI GMの呼出に失敗した理由。ホストが再試行するまで次の提案へ進まない。無ければ空 */
  aiError: string;
  /** 失敗するたびに増える。揺れの演出に使う */
  aiErrorSeq: number;
  /** GM本人と結果画面にだけ入る。それ以外は null */
  answer: string | null;
  /** 延長を含めた質問回数 */
  limit: number;
  used: number;
  maxLies: number;
  /** GM本人と結果画面にだけ入る。それ以外は null */
  liesUsed: number | null;
  proposals: ProposalView[];
  outcome: DoorsOutcome | null;
  abortReason: string;
  /** 「延長をお願い」が押されるたびに増える。ホストとGMの画面で通知に使う */
  extendRequestSeq: number;
  extendRequestBy: string;
}

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
  mode: GameMode;
  doorsSettings: DoorsSettings;
  /** 10の扉のラウンド中と結果画面だけ入る */
  doors: DoorsView | null;
  cardsPerPlayer: number;
  topic: string;
  topicSource: TopicSource;
  /** 直近のAI生成で出たお題の候補。ホストがここから選ぶ */
  topicCandidates: string[];
  aiBusy: boolean;
  /** ASK API の設定があり、AIを使えるか。無ければ10の扉のAI GMを選べない */
  aiAvailable: boolean;
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
