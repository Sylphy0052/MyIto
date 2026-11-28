import './loadEnv';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import {
  LIMITS,
  type Ack,
  type ClientToServerEvents,
  type DoorsAiModel,
  type ServerToClientEvents,
  type ShutdownNotice,
} from '../shared/types';
import { GM_GRACE_MS, GameError, Room, cleanText, newRoomCode } from './game';
import { randomDoorsTheme, randomTopic } from './topics';
import { AiLimitError, acquireAiSlot, generateTopics, releaseRoomAiSlots, sanitizeGenre } from './ai';
import type { DoorsRound } from './doors';
import { answerQuestion, generateSecretAnswer, judgeGuess, type HistoryItem, type Judgement, type SecretAnswer } from './doorsAi';
import { normalizeText } from '../shared/normalize';

const PORT = Number(process.env.PORT ?? 47213);
const REVEAL_INTERVAL_MS = 1_200;
const HOST_GRACE_MS = 30_000;
const ROOM_IDLE_MS = 60 * 60_000;
// 一度もロビーを出ずに無人になったルームは早く片付ける (作成の連打で枠を埋められないようにする)
const UNPLAYED_ROOM_IDLE_MS = 3 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;
// 接続元アドレスごとのルーム作成の間隔。1人が数回作り直す使い方は止めず、連打だけを断る。
// 接続ごとに数えると、つなぎ直すだけで逃れられる
const CREATE_INTERVAL_MS = 30_000;
const MAX_ROOMS = 200;
// 接続元アドレスごとの同時接続数。同じ回線 (家庭・会議室) で数ルーム遊ぶ使い方は止めない
const MAX_CONNECTIONS_PER_KEY = 20;
// 接続元アドレスごとに、存在しないコードへの join を JOIN_FAIL_WINDOW_MS に JOIN_FAIL_MAX 種類まで受け、
// 超えたら JOIN_BLOCK_MS の間 join を断る (コードの総当たり対策)。同じコードの失敗は1回と数えるので、
// 再起動で消えたルームへ同じ回線の複数人が入り直しても詰まらない
const JOIN_FAIL_WINDOW_MS = 60_000;
const JOIN_FAIL_MAX = 10;
const JOIN_BLOCK_MS = 60_000;
const EVENTS_PER_SECOND = 20;
// 10の扉の提案・承認・取り消しは人の手の速さで足りるので、全体の上限より狭くする
const DOORS_BURST_WINDOW_MS = 3_000;
const DOORS_BURST_MAX = 6;
// 終了の告知を送ってから接続を閉じるまでの待ち。io.close()は送信待ちのデータを捨てるので、告知が届く間を空ける
const SHUTDOWN_NOTICE_MS = 1_000;
// 終了信号から強制終了までの上限。docker stopの既定の猶予 (10秒) より短くする
const SHUTDOWN_FORCE_EXIT_MS = 5_000;

/** 終了信号を受けた後か。二重の終了処理を防ぎ、新しい接続を断る */
let shuttingDown = false;
const rooms = new Map<string, Room>();
/** 一度でもロビーを出たルームのコード。ルームを消すときに一緒に消す */
const playedRooms = new Set<string>();

const app = express();
// 画面ファイルの場所。ビルド済みJS (dist/server/index.js) からは隣の dist/client、
// 開発時 (tsx server/index.ts) は repo ルートの dist/client を見る。
// ソースの隣の client/ はviteの元ファイルなので、存在の有無ではなく実行中のファイルの種類で分ける
const serverFile = fileURLToPath(import.meta.url);
const clientDir = serverFile.endsWith('.ts')
  ? join(dirname(serverFile), '..', 'dist', 'client')
  : join(dirname(serverFile), '..', 'client');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; connect-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
  );
  next();
});
// 死活確認用。SPAのフォールバックより前に置く。内部の状態は返さない。終了処理中も200のまま (socket.ioのallowRequestや接続数制限はHTTPのこの経路に掛からない)
app.get('/healthz', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true });
});
if (existsSync(clientDir)) {
  app.use(compression());
  app.use(
    express.static(clientDir, {
      // 既定のETag/Last-Modifiedは残し、Cache-Controlだけ種類ごとに上書きする
      setHeaders: (res, filePath) => {
        const rel = relative(clientDir, filePath).split(sep);
        if (rel[0] === 'assets') res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else if (rel[0] === 'bgm' || rel[0] === 'gm') res.setHeader('Cache-Control', 'public, max-age=86400');
        else if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );
  app.get('/{*path}', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    // rootを渡すと、配置先パスの`.xxx`ディレクトリ (dotfiles判定) に影響されない
    res.sendFile('index.html', { root: clientDir });
  });
}
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
  maxHttpBufferSize: 16 * 1024,
  // 他サイトのページからの接続を断る
  allowRequest: (req, callback) => {
    // 終了処理中は新しい接続を受けない
    if (shuttingDown) return callback('server shutting down', false);
    // 同時接続の上限は、ここ (HTTPの握手) で断る。connectionで切ると、クライアントは自動で再接続せず戻れない
    const addressKey = addressToKey(req.socket.remoteAddress ?? '');
    if (addressKey && (connectionCounts.get(addressKey) ?? 0) >= MAX_CONNECTIONS_PER_KEY) {
      return callback('too many connections', false);
    }
    const origin = req.headers.origin;
    if (!origin) return callback(null, true);
    try {
      callback(null, new URL(origin).host === req.headers.host);
    } catch {
      callback(null, false);
    }
  },
});

interface SocketData {
  code?: string;
  playerId?: string;
  windowStart?: number;
  windowCount?: number;
  doorsWindowStart?: number;
  doorsWindowCount?: number;
}
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

// ルーム作成の間隔を数える単位ごとの、最後に作った時刻
const lastCreateAt = new Map<string, number>();
// 接続元ごとの同時接続数
const connectionCounts = new Map<string, number>();
// 接続元ごとの、存在しないコードへの join の記録
interface JoinFailures {
  windowStart: number;
  codes: Set<string>;
  blockedUntil: number;
}
const joinFailures = new Map<string, JoinFailures>();
function isJoinBlocked(key: string, now: number): boolean {
  const f = joinFailures.get(key);
  return f !== undefined && now < f.blockedUntil;
}
function recordJoinFailure(key: string, code: string, now: number): void {
  let f = joinFailures.get(key);
  if (!f || now - f.windowStart >= JOIN_FAIL_WINDOW_MS) {
    f = { windowStart: now, codes: new Set(), blockedUntil: 0 };
    joinFailures.set(key, f);
  }
  f.codes.add(code);
  if (f.codes.size >= JOIN_FAIL_MAX) f.blockedUntil = now + JOIN_BLOCK_MS;
}
// IPv6は端末ごとにアドレスを変えられるので、先頭64bit (/64) にまとめて数える
function ipv6Prefix(address: string): string {
  const [head = '', tail = ''] = address.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = address.includes('::') && tail ? tail.split(':') : [];
  const groups = address.includes('::')
    ? [...headGroups, ...Array<string>(8 - headGroups.length - tailGroups.length).fill('0'), ...tailGroups]
    : headGroups;
  return groups
    .slice(0, 4)
    .map((g) => g.toLowerCase().replace(/^0+(?=.)/, ''))
    .join(':');
}
// 数える単位。アドレスが取れないときは接続ごとに戻す (リバースプロキシを置くと全員が同じアドレスになるので、置く前に見直す)
function addressToKey(rawAddress: string): string | null {
  const address = rawAddress.replace(/^::ffff:/i, '');
  if (!address) return null;
  return address.includes(':') ? `v6:${ipv6Prefix(address)}` : `addr:${address}`;
}
function createKey(socket: GameSocket): string {
  return addressToKey(socket.handshake.address ?? '') ?? `socket:${socket.id}`;
}

function broadcast(room: Room): void {
  room.lastActiveAt = Date.now();
  if (room.phase !== 'lobby') playedRooms.add(room.code);
  // 状態が変わるたびに、AI GMが次にすることがあるかを見る。処理中の印は配信の前に付ける
  driveAiGm(room);
  // 10の扉でGMがランダムなら、ロビーで次のGMを引いておいてから配る (切断・退出・設定変更で決め直す)
  room.refreshNextGm();
  for (const s of roomSockets(room.code)) {
    if (s.data.code === room.code && s.data.playerId) {
      s.emit('state', room.viewFor(s.data.playerId));
    }
  }
}

/** Socket.IOのroom (socket.join) に入っているソケットだけを返す。全接続は走査しない */
function* roomSockets(code: string): Generator<GameSocket> {
  const ids = io.sockets.adapter.rooms.get(code);
  if (!ids) return;
  for (const id of ids) {
    const s = io.sockets.sockets.get(id);
    if (s) yield s;
  }
}

function aiErrorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** ルームが破棄されておらず、ラウンドが差し替わっていないか */
function isCurrentRound(room: Room, round: DoorsRound): boolean {
  return rooms.get(room.code) === room && room.doors === round;
}

/**
 * AI GMの仕事を1つ始める。答えが未定なら答えを決め、送信済みの提案があれば古い順に1件答える。
 * 終わったら broadcast し、その中で次の仕事を探す。結果が届くまでにラウンドが中止・破棄されていたら捨てる
 */
function driveAiGm(room: Room): void {
  const round = room.doors;
  if (!round?.isAiGm || !round.isRunning || round.aiBusy) return;
  if (round.phase === 'doors-setup') {
    if (round.answer) return;
    round.aiBusy = true;
    generateSecretAnswer(room.code, room.doorsSettings.aiModel, room.topic, room.aiAnswers)
      .then(({ answer, memo }) => {
        if (!isCurrentRound(room, round) || round.phase !== 'doors-setup') return round.endAiAnswer();
        room.setAiAnswer(round, answer, memo);
      })
      .catch((e: unknown) => {
        console.error('AI doors answer failed:', aiErrorText(e));
        const wasSetup = room.doors === round && round.phase === 'doors-setup';
        room.failAiAnswer(round);
        if (wasSetup && e instanceof AiLimitError) {
          room.notice = 'AIの上限に達したので、ロビーに戻りました。少し待ってからもう一度開始してください';
        }
      })
      .finally(() => {
        if (rooms.get(room.code) === room) broadcast(room);
      });
    return;
  }
  const p = round.nextForAi();
  if (!p) return;
  round.beginAi(p);
  const { id, kind, text } = p;
  const secret = { answer: round.answer, memo: round.memo };
  const job =
    kind === 'question'
      ? answerQuestion(room.code, room.doorsSettings.aiModel, secret, aiHistory(round), text).then((reply) => {
          if (isCurrentRound(room, round) && round.isAwaitingAi(id)) round.applyAiQuestion(id, reply);
        })
      : judge(room.code, room.doorsSettings.aiModel, secret, text).then(({ verdict, reason }) => {
          if (isCurrentRound(room, round) && round.isAwaitingAi(id)) round.applyAiGuess(id, verdict, reason);
        });
  job
    .catch((e: unknown) => {
      console.error('AI doors reply failed:', aiErrorText(e));
      if (isCurrentRound(room, round) && round.isAwaitingAi(id)) {
        round.failAi(
          id,
          e instanceof AiLimitError
            ? 'AIの上限に達しました。少し待ってからホストが再試行してください'
            : 'AIの応答に失敗しました。ホストは再試行できます',
        );
      }
    })
    .finally(() => {
      // 結果を捨てた場合も、処理中の印を残して進行を止めない
      round.releaseAi(id);
      if (rooms.get(room.code) !== room) return;
      room.phase = room.doors?.phase ?? room.phase;
      // AIの回答で手番が動き出す・止まるので、誰も操作しなくても時間切れが起きるよう付け直す
      room.syncDoorsTimer();
      broadcast(room);
    });
}

/** AIへ渡す履歴。嘘で反転する前の正直な回答を渡し、AIが自分の回答と矛盾しないようにする */
function aiHistory(round: DoorsRound): HistoryItem[] {
  return round.proposals.flatMap((p) =>
    p.kind === 'question' && p.status === 'answered' && p.honestReply ? [{ question: p.text, reply: p.honestReply }] : [],
  );
}

/** 表記の正規化で答えと一致すれば、AIに聞かずに正解にする */
async function judge(roomCode: string, model: DoorsAiModel, secret: SecretAnswer, guess: string): Promise<Judgement> {
  const key = normalizeText(guess);
  // 正規化で空になる (記号だけの) 解答・答えは完全一致にせず、AIの判定に回す
  if (key !== '' && key === normalizeText(secret.answer)) {
    return { verdict: 'correct', reason: '表記をそろえると答えと一致しました' };
  }
  return judgeGuess(roomCode, model, secret, guess);
}

function errorMessage(e: unknown): string {
  if (e instanceof GameError) return e.message;
  console.error(e);
  return 'サーバでエラーが起きました';
}

type Payload = Record<string, unknown>;

/** 1ソケットあたり1秒に EVENTS_PER_SECOND 回を超えたら true */
function isFlooding(socket: GameSocket): boolean {
  const now = Date.now();
  if (!socket.data.windowStart || now - socket.data.windowStart >= 1000) {
    socket.data.windowStart = now;
    socket.data.windowCount = 0;
  }
  socket.data.windowCount = (socket.data.windowCount ?? 0) + 1;
  return socket.data.windowCount > EVENTS_PER_SECOND;
}

/** 10の扉の提案・承認・取り消しを、1ソケットあたり DOORS_BURST_WINDOW_MS に DOORS_BURST_MAX 回までにする */
function isDoorsFlooding(socket: GameSocket): boolean {
  const now = Date.now();
  if (!socket.data.doorsWindowStart || now - socket.data.doorsWindowStart >= DOORS_BURST_WINDOW_MS) {
    socket.data.doorsWindowStart = now;
    socket.data.doorsWindowCount = 0;
  }
  socket.data.doorsWindowCount = (socket.data.doorsWindowCount ?? 0) + 1;
  return socket.data.doorsWindowCount > DOORS_BURST_MAX;
}

/** 入室済みソケットの操作を、例外を ack へ変換して実行する */
function withRoom(socket: GameSocket, fn: (room: Room, playerId: string, payload: Payload) => void) {
  return (...args: unknown[]) => {
    const last = args[args.length - 1];
    const ack: Ack = typeof last === 'function' ? (last as Ack) : () => {};
    const first = args[0];
    const payload: Payload = first && typeof first === 'object' ? (first as Payload) : {};
    if (isFlooding(socket)) return ack({ ok: false, error: '操作が多すぎます。少し待ってください', retry: true });
    const { code, playerId } = socket.data;
    const room = code ? rooms.get(code) : undefined;
    if (!room || !playerId) return ack({ ok: false, error: 'ルームに入っていません' });
    try {
      fn(room, playerId, payload);
      broadcast(room);
      ack({ ok: true });
    } catch (e) {
      ack({ ok: false, error: errorMessage(e) });
    }
  };
}

/** ソケットがいま入っているルームから抜ける (同じ席の別ソケットが残っていれば接続中のまま) */
function detach(socket: GameSocket): void {
  const { code, playerId } = socket.data;
  socket.data.code = undefined;
  socket.data.playerId = undefined;
  if (code) void socket.leave(code);
  const room = code ? rooms.get(code) : undefined;
  if (!room || !playerId || isPlayerOnline(room.code, playerId)) return;
  room.setConnected(playerId, false);
  broadcast(room);
  if (playerId === room.hostId) {
    setTimeout(() => {
      if (rooms.get(room.code) === room && room.reassignHostIfAway()) broadcast(room);
    }, HOST_GRACE_MS + 1_000);
  }
  watchGm(room, playerId);
}

/** ラウンド中のGMが席を離れたら、猶予を過ぎても戻らないときにラウンドを中止する */
function watchGm(room: Room, playerId: string): void {
  if (!room.isRunningGm(playerId)) return;
  setTimeout(() => {
    if (rooms.get(room.code) === room && room.abortIfGmAway()) broadcast(room);
  }, GM_GRACE_MS + 1_000);
}

function enter(socket: GameSocket, room: Room, name: string, token: unknown, ack: Ack): void {
  try {
    const player = room.join(name, typeof token === 'string' ? token : undefined);
    if (socket.data.code !== room.code || socket.data.playerId !== player.id) detach(socket);
    socket.data.code = room.code;
    socket.data.playerId = player.id;
    void socket.join(room.code);
    room.reassignHostIfAway();
    ack({ ok: true, code: room.code, token: player.token });
    broadcast(room);
  } catch (e) {
    ack({ ok: false, error: errorMessage(e) });
  }
}

function isPlayerOnline(code: string, playerId: string): boolean {
  for (const s of roomSockets(code)) {
    if (s.data.code === code && s.data.playerId === playerId) return true;
  }
  return false;
}

io.on('connection', (socket: GameSocket) => {
  // 数える単位はソケットの接続元アドレス (handshake.address) で、X-Forwarded-For などクライアントが付けられるヘッダは見ない
  const limitKey = createKey(socket);
  const connections = connectionCounts.get(limitKey) ?? 0;
  if (connections >= MAX_CONNECTIONS_PER_KEY) {
    socket.disconnect(true);
    return;
  }
  connectionCounts.set(limitKey, connections + 1);
  socket.on('disconnect', () => {
    const left = (connectionCounts.get(limitKey) ?? 1) - 1;
    if (left > 0) connectionCounts.set(limitKey, left);
    else connectionCounts.delete(limitKey);
  });

  socket.on('create', (p: { name?: unknown }, ack: Ack) => {
    if (typeof ack !== 'function') return;
    if (isFlooding(socket)) return ack({ ok: false, error: '操作が多すぎます。少し待ってください', retry: true });
    const name = cleanText(p?.name, LIMITS.name);
    if (!name) return ack({ ok: false, error: 'ニックネームを入力してください' });
    const now = Date.now();
    const lastAt = lastCreateAt.get(limitKey);
    if (lastAt !== undefined && now - lastAt < CREATE_INTERVAL_MS) {
      return ack({ ok: false, error: 'ルームの作成は30秒に1回までです。少し待ってください' });
    }
    if (rooms.size >= MAX_ROOMS) return ack({ ok: false, error: 'ルーム数が上限です。既存のルームに入ってください' });
    let code: string;
    try {
      code = newRoomCode(rooms);
    } catch (e) {
      return ack({ ok: false, error: errorMessage(e) });
    }
    lastCreateAt.set(limitKey, now);
    const room = new Room(code);
    room.onDoorsTimeUp = () => broadcast(room);
    rooms.set(room.code, room);
    enter(socket, room, name, undefined, ack);
  });

  socket.on('join', (p: { code?: unknown; name?: unknown; token?: unknown }, ack: Ack) => {
    if (typeof ack !== 'function') return;
    if (isFlooding(socket)) return ack({ ok: false, error: '操作が多すぎます。少し待ってください', retry: true });
    const code = cleanText(p?.code, 4).toUpperCase();
    const room = rooms.get(code);
    const now = Date.now();
    // 断っている間も、席の token を持つ再接続は通す
    const isSeatHolder = room !== undefined && typeof p?.token === 'string' && room.players.some((pl) => pl.token === p.token);
    if (!isSeatHolder && isJoinBlocked(limitKey, now)) {
      return ack({ ok: false, error: 'ルームコードの入力が多すぎます。1分ほど待ってください', retry: true });
    }
    if (!room) {
      recordJoinFailure(limitKey, code, now);
      return ack({ ok: false, error: 'ルームが見つかりません' });
    }
    enter(socket, room, cleanText(p?.name, LIMITS.name), p?.token, ack);
  });

  socket.on('leave', (_p: unknown, ack: Ack) => {
    const { code, playerId } = socket.data;
    const room = code ? rooms.get(code) : undefined;
    socket.data.code = undefined;
    socket.data.playerId = undefined;
    if (code) void socket.leave(code);
    // 同じ席の別タブが残っていれば席はそのまま
    if (room && playerId && !isPlayerOnline(room.code, playerId)) {
      room.leave(playerId);
      watchGm(room, playerId);
      broadcast(room);
    }
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on(
    'settings',
    withRoom(socket, (room, pid, p) => room.setSettings(pid, p.cardsPerPlayer)),
  );
  socket.on(
    'topic:random',
    withRoom(socket, (room, pid) => room.randomizeTopic(pid)),
  );
  socket.on(
    'topic:set',
    withRoom(socket, (room, pid, p) => room.setTopic(pid, cleanText(p.topic, LIMITS.topic), 'custom')),
  );
  socket.on(
    'topic:suggest',
    withRoom(socket, (room, pid, p) => room.suggestTopic(pid, cleanText(p.topic, LIMITS.topic))),
  );
  socket.on(
    'topic:suggest-withdraw',
    withRoom(socket, (room, pid, p) => room.withdrawSuggestion(pid, p.id)),
  );
  socket.on(
    'topic:dismiss',
    withRoom(socket, (room, pid, p) => room.dismissSuggestion(pid, p.id)),
  );
  socket.on(
    'topic:ai',
    withRoom(socket, (room, pid, p) => {
      if (pid !== room.hostId) throw new GameError('ホストだけが操作できます');
      if (room.phase !== 'lobby') throw new GameError('お題はロビーでだけ変更できます');
      if (room.aiBusy) throw new GameError('AIがお題を考え中です');
      const limited = acquireAiSlot('topic', room.code);
      if (limited) throw new GameError(limited);
      const { mode } = room;
      const label = mode === 'doors' ? 'テーマ' : 'お題';
      room.aiBusy = true;
      room.notice = `AIが${label}を考えています...`;
      generateTopics(sanitizeGenre(p.genre), mode, room.code)
        .then((topics) => {
          if (room.phase !== 'lobby' || room.mode !== mode) return;
          room.topicCandidates = topics;
          room.topic = topics[0]!;
          room.topicSource = 'ai';
          room.notice = '';
        })
        .catch((e: unknown) => {
          console.error('AI topic failed:', e instanceof Error ? e.message : e);
          if (room.phase !== 'lobby' || room.mode !== mode) return;
          room.topic = mode === 'doors' ? randomDoorsTheme(room.topic) : randomTopic(room.topic);
          room.topicSource = 'ai-fallback';
          room.topicCandidates = [];
          room.notice =
            e instanceof AiLimitError
              ? `AIが混み合っているので、内蔵リストから${label}を出しました`
              : `AI生成に失敗したので、内蔵リストから${label}を出しました`;
        })
        .finally(() => {
          room.aiBusy = false;
          broadcast(room);
        })
        .catch((e: unknown) => {
          console.error('AI topic chain failed:', e instanceof Error ? e.message : e);
        });
    }),
  );
  socket.on(
    'topic:pick',
    withRoom(socket, (room, pid, p) => room.pickCandidate(pid, p.index)),
  );
  socket.on(
    'start',
    withRoom(socket, (room, pid) => room.start(pid)),
  );
  socket.on(
    'hint',
    withRoom(socket, (room, pid, p) => room.setHint(pid, p.cardId, cleanText(p.hint, LIMITS.hint))),
  );
  socket.on(
    'place',
    withRoom(socket, (room, pid, p) => room.place(pid, p.cardId, p.toIndex)),
  );
  socket.on(
    'unplace',
    withRoom(socket, (room, pid, p) => room.unplace(pid, p.cardId)),
  );
  socket.on(
    'move',
    withRoom(socket, (room, _pid, p) => room.move(p.cardId, p.toIndex)),
  );
  socket.on(
    'open',
    withRoom(socket, (room, pid) => room.open(pid, REVEAL_INTERVAL_MS, () => broadcast(room))),
  );
  socket.on(
    'lobby',
    withRoom(socket, (room, pid) => room.backToLobby(pid)),
  );

  // ---- 10の扉 ----
  socket.on(
    'mode',
    withRoom(socket, (room, pid, p) => room.setMode(pid, p.mode)),
  );
  socket.on(
    'doors:settings',
    withRoom(socket, (room, pid, p) => room.setDoorsSettings(pid, p)),
  );
  socket.on(
    'doors:reroll-gm',
    withRoom(socket, (room, pid) => room.rerollGm(pid)),
  );
  socket.on(
    'doors:answer',
    withRoom(socket, (room, pid, p) => room.doorsAction((d) => d.setAnswer(pid, cleanText(p.answer, LIMITS.doorsAnswer)))),
  );
  /** 提案・承認・取り消しは連打されやすいので、全体の上限に加えて専用の上限を掛ける */
  const burst = (fn: (room: Room, pid: string, p: Payload) => void) =>
    withRoom(socket, (room, pid, p) => {
      if (isDoorsFlooding(socket)) throw new GameError('操作が多すぎます。少し待ってください');
      fn(room, pid, p);
    });
  socket.on(
    'doors:propose',
    burst((room, pid, p) => room.doorsAction((d, seats) => d.propose(pid, seats, p.kind, cleanText(p.text, LIMITS.doorsProposal)))),
  );
  socket.on(
    'doors:approve',
    burst((room, pid, p) => room.doorsAction((d, seats) => d.approve(pid, seats, p.id))),
  );
  socket.on(
    'doors:cancel',
    burst((room, pid, p) => room.doorsAction((d, seats) => d.cancel(pid, seats, p.id))),
  );
  socket.on(
    'doors:reply',
    withRoom(socket, (room, pid, p) => room.doorsAction((d) => d.reply(pid, p.id, p.reply, p.lie))),
  );
  socket.on(
    'doors:correct',
    withRoom(socket, (room, pid, p) => room.doorsAction((d) => d.correct(pid, p.id, p.reply, p.lie))),
  );
  socket.on(
    'doors:reject',
    withRoom(socket, (room, pid, p) => room.doorsAction((d) => d.reject(pid, p.id))),
  );
  socket.on(
    'doors:extend',
    withRoom(socket, (room, pid, p) => room.doorsAction((d) => d.extend(pid === room.hostId || pid === d.gmId, p.delta))),
  );
  socket.on(
    'doors:extend-time',
    withRoom(socket, (room, pid) => room.doorsAction((d) => d.extendTime(pid === room.hostId || pid === d.gmId))),
  );
  socket.on(
    'doors:ai-retry',
    withRoom(socket, (room, pid) => room.doorsAction((d) => d.retryAi(pid === room.hostId))),
  );
  socket.on(
    'doors:extend-request',
    withRoom(socket, (room, pid) => room.doorsAction((d, seats) => d.requestExtend(pid, seats))),
  );

  socket.on('disconnect', () => detach(socket));
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const idleMs = playedRooms.has(code) ? ROOM_IDLE_MS : UNPLAYED_ROOM_IDLE_MS;
    if (!room.hasConnected() && now - room.lastActiveAt > idleMs) {
      room.dispose();
      rooms.delete(code);
      playedRooms.delete(code);
      releaseRoomAiSlots(code);
    }
  }
  for (const [key, at] of lastCreateAt) if (now - at >= CREATE_INTERVAL_MS) lastCreateAt.delete(key);
  for (const [key, f] of joinFailures) {
    if (now >= f.blockedUntil && now - f.windowStart >= JOIN_FAIL_WINDOW_MS) joinFailures.delete(key);
  }
}, SWEEP_INTERVAL_MS);

httpServer.listen(PORT, () => {
  console.log(`ito server listening on :${PORT}`);
});

/** 終了信号を受けたら全員へ告知し、少し待ってから接続を閉じて終える。ルームはメモリ上にしか無いので消える */
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) {
    // 開発時のCtrl+C2回は待たずに即終了する。SIGTERMの重複は従来どおり無視
    if (signal === 'SIGINT') process.exit(1);
    return;
  }
  shuttingDown = true;
  console.log(`received ${signal}: notifying ${io.engine.clientsCount} clients and shutting down`);
  const notice: ShutdownNotice = { reason: 'restart' };
  io.emit('shutdown', notice);
  // 閉じる処理が終わらなくても、docker stopの猶予内に終える
  setTimeout(() => {
    // docker stopの通常の入れ替えで閉じ切れなくても異常終了扱いにしないため、終了コードは0
    console.log('shutdown timed out; exiting with code 0');
    process.exit(0);
  }, SHUTDOWN_FORCE_EXIT_MS).unref();
  setTimeout(() => {
    void io.close(() => {
      console.log('shutdown complete');
      process.exit(0);
    });
  }, SHUTDOWN_NOTICE_MS);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
