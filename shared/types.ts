export type DoorsPhase = 'doors-setup' | 'doors-asking' | 'doors-final' | 'doors-result';
export type Phase = 'lobby' | 'playing' | 'revealing' | 'result' | DoorsPhase;
export type CardState = 'hand' | 'placed';
export type TopicSource = 'random' | 'custom' | 'ai' | 'ai-fallback';
export type GameMode = 'ito' | 'doors';

export const LIMITS = {
  name: 16,
  hint: 40,
  topic: 100,
  genre: 20,
  /** ホスト以外が1人で同時に出せるお題の案の数 */
  topicSuggestionsPerPlayer: 3,
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
  /** 10の扉: 延長を含めた残り時間の上限 (分) */
  doorsMaxTimeLeftMin: 99,
  doorsMaxLies: 3,
  /** 10の扉: ログに残す提案の数。取り消した提案は、上限に届いたとき古い順に消す */
  doorsLog: 500,
  /** 10の扉: 質問の段階で1人が同時にためておける提案 (承認待ち・送信済み) の数 */
  doorsStockPerPlayer: 20,
  /** 10の扉: ログ上限のうち最終解答のために残す数。質問の段階の提案はここまで使えない */
  doorsFinalReserve: 20,
} as const;

export const DOORS_DEFAULT_QUESTIONS = 10;
/** ロビーで決めるラウンドの制限時間の上限 (分) */
export const DOORS_MAX_TIME_LIMIT_MIN = 60;
/** ラウンドの制限時間 (分)。0 はなし、ほかは 1〜60 分を 1 分刻み */
export const DOORS_TIME_LIMITS: readonly number[] = Array.from({ length: DOORS_MAX_TIME_LIMIT_MIN + 1 }, (_, i) => i);

/** 1手番の制限時間 (秒)。0 はなし、ほかは 10〜180 秒を 10 秒刻み */
export const DOORS_TURN_LIMITS: readonly number[] = [0, ...Array.from({ length: 18 }, (_, i) => (i + 1) * 10)];

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
/** proposed: 承認待ち / sent: GMへ送信済み / discarded: 回数の使い切り・終了時に未処理のまま破棄 */
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
  /** ラウンドの制限時間 (分)。0 はなし */
  timeLimitMin: number;
  /** 1手番の制限時間 (秒)。0 はなし */
  turnLimitSec: number;
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
  /** OKした回答者の名前 */
  approverNames: string[];
  /** 承認待ちのときの、承認が必要な人数とOK済みの人数 */
  approvalsNeeded: number;
  approvalsDone: number;
  /** 見ている本人がOK済みか */
  isApprovedByYou: boolean;
  cancelledByName: string;
  reply: DoorsReply | null;
  /** 訂正前の最初の判定 (嘘の印は付けない)。訂正していなければ null */
  correctedFrom: DoorsReply | null;
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
  /** 呼出に失敗した提案。ホストが再試行するまで回答待ちのまま残る。無ければ空 */
  aiFailedId: string;
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
  /** GMが判定を訂正するたびに増える。GM以外の通知に使う */
  correctSeq: number;
  /** 最後に訂正した提案の通し番号 */
  correctSeqBy: number;
  /** 制限時間 (分)。0 はなし */
  timeLimitMin: number;
  /** 合計の残りミリ秒 (質問の段階・最終解答の段階)。制限時間なし・答えの確定前・質問の段階の時間切れ中・終了後は null。受け取った時点の値から手元で数え直す */
  timeLeftMs: number | null;
  /** 合計の時計が止まっているか (GMへ届いた提案の判定待ち)。timeLeftMs が null のときは false */
  isTimePaused: boolean;
  /** 回答者の負けの理由。時間切れなら「時間切れ」、通常の負けは空 */
  loseReason: string;
  /** 時間切れで、いまも質問の段階が打ち切られているか */
  isTimeUp: boolean;
  /** このラウンドで一度でも時間切れになったか (結果画面用) */
  wasTimeUp: boolean;
  /** 1手番の制限時間 (秒)。0 はなし */
  turnLimitSec: number;
  /** 手番の残りミリ秒 (進行中・止まっている間)。数えない段階・制限なしは null。受け取った時点の値から手元で数え直す */
  turnLeftMs: number | null;
  /** 手番がGMの回答待ちで止まっているか */
  isTurnPaused: boolean;
  /** 手番の時間切れで質問回数を使った回数 */
  turnTimeoutCount: number;
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

export interface TopicSuggestionView {
  id: string;
  authorId: string;
  text: string;
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
  /** ホスト以外の参加者が送ったお題・テーマの案 (ロビーだけ) */
  topicSuggestions: TopicSuggestionView[];
  aiBusy: boolean;
  /** ASK API の設定があり、AIを使えるか。無ければ10の扉のAI GMを選べない */
  aiAvailable: boolean;
  /** 10の扉でGMがランダムのとき、ロビーで引いておいた次のGM。それ以外は空 */
  nextGmId: string;
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

/** サーバが終了する直前に全員へ送る `shutdown` イベントの内容 */
export interface ShutdownNotice {
  reason: 'restart';
}

/**
 * オープンできるか。接続中の人のカードが全部列に置かれ、列が空でないこと。
 * 切断中の人の手札は待たない (本人しか置けず、進行が止まるため)
 */
export function isReadyToOpen(
  cards: readonly { ownerId: string; state: CardState }[],
  players: readonly { id: string; connected: boolean }[],
): boolean {
  const connected = new Set(players.filter((p) => p.connected).map((p) => p.id));
  return cards.some((c) => c.state === 'placed') && cards.every((c) => c.state === 'placed' || !connected.has(c.ownerId));
}

/** 実行時には信用できない入力なので、フィールドは unknown で受ける */
type Fields<K extends string = never> = { [P in K]?: unknown };
type Empty = Record<string, never> | undefined;

/** クライアントがサーバへ送るイベントの名前とペイロードの対応 */
export interface ClientEventPayloads {
  create: Fields<'name'>;
  join: Fields<'code' | 'name' | 'token'>;
  leave: Empty;
  settings: Fields<'cardsPerPlayer'>;
  'topic:random': Empty;
  'topic:set': Fields<'topic'>;
  'topic:suggest': Fields<'topic'>;
  'topic:suggest-withdraw': Fields<'id'>;
  'topic:dismiss': Fields<'id'>;
  'topic:ai': Fields<'genre'>;
  'topic:pick': Fields<'index'>;
  start: Empty;
  hint: Fields<'cardId' | 'hint'>;
  place: Fields<'cardId' | 'toIndex'>;
  unplace: Fields<'cardId'>;
  move: Fields<'cardId' | 'toIndex'>;
  open: Empty;
  lobby: Empty;
  mode: Fields<'mode'>;
  'doors:settings': Record<string, unknown>;
  'doors:reroll-gm': Empty;
  'doors:answer': Record<string, unknown>;
  'doors:propose': Record<string, unknown>;
  'doors:approve': Fields<'id'>;
  'doors:cancel': Fields<'id'>;
  'doors:reply': Fields<'id' | 'reply' | 'lie'>;
  'doors:correct': Fields<'id' | 'reply' | 'lie'>;
  'doors:reject': Fields<'id'>;
  'doors:extend': Record<string, unknown>;
  'doors:extend-time': Empty;
  'doors:ai-retry': Empty;
  'doors:extend-request': Empty;
}
export type ClientEventName = keyof ClientEventPayloads;

/** Socket.IO の ListenEvents (サーバ側が受ける) */
export type ClientToServerEvents = {
  [E in ClientEventName]: (payload: ClientEventPayloads[E], ack: Ack) => void;
};

/** Socket.IO の EmitEvents (サーバ側が送る) */
export interface ServerToClientEvents {
  state: (view: RoomView) => void;
  shutdown: (notice: ShutdownNotice) => void;
}

// CI確認用: 型エラーを意図的に入れる (mergeしない)
export const ciProbe: number = 'not a number';
