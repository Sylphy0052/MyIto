import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import { LIMITS, type Ack } from '../shared/types';
import { GameError, Room, cleanText, newRoomCode } from './game';
import { randomTopic } from './topics';
import { acquireAiSlot, forgetRoom, generateTopics, sanitizeGenre } from './ai';

const PORT = Number(process.env.PORT ?? 47213);
const REVEAL_INTERVAL_MS = 1_200;
const HOST_GRACE_MS = 30_000;
const ROOM_IDLE_MS = 60 * 60_000;
const MAX_ROOMS = 200;
const EVENTS_PER_SECOND = 20;

const rooms = new Map<string, Room>();

const app = express();
const clientDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'client');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; connect-src 'self' ws: wss:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
  );
  next();
});
if (existsSync(clientDir)) {
  app.use(express.static(clientDir));
  app.get('/{*path}', (_req, res) => res.sendFile(join(clientDir, 'index.html')));
}
const httpServer = createServer(app);
const io = new Server(httpServer, {
  maxHttpBufferSize: 16 * 1024,
  // 他サイトのページからの接続を断る
  allowRequest: (req, callback) => {
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
}
type GameSocket = Socket<any, any, any, SocketData>;

function broadcast(room: Room): void {
  room.lastActiveAt = Date.now();
  for (const s of io.sockets.sockets.values() as Iterable<GameSocket>) {
    if (s.data.code === room.code && s.data.playerId) {
      s.emit('state', room.viewFor(s.data.playerId));
    }
  }
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
  const room = code ? rooms.get(code) : undefined;
  if (!room || !playerId || isPlayerOnline(room.code, playerId)) return;
  room.setConnected(playerId, false);
  broadcast(room);
  if (playerId === room.hostId) {
    setTimeout(() => {
      if (rooms.get(room.code) === room && room.reassignHostIfAway()) broadcast(room);
    }, HOST_GRACE_MS + 1_000);
  }
}

function enter(socket: GameSocket, room: Room, name: string, token: unknown, ack: Ack): void {
  try {
    const player = room.join(name, typeof token === 'string' ? token : undefined);
    if (socket.data.code !== room.code || socket.data.playerId !== player.id) detach(socket);
    socket.data.code = room.code;
    socket.data.playerId = player.id;
    room.reassignHostIfAway();
    ack({ ok: true, code: room.code, token: player.token });
    broadcast(room);
  } catch (e) {
    ack({ ok: false, error: errorMessage(e) });
  }
}

function isPlayerOnline(code: string, playerId: string): boolean {
  for (const s of io.sockets.sockets.values() as Iterable<GameSocket>) {
    if (s.data.code === code && s.data.playerId === playerId) return true;
  }
  return false;
}

io.on('connection', (socket: GameSocket) => {
  socket.on('create', (p: { name?: unknown }, ack: Ack) => {
    if (typeof ack !== 'function') return;
    if (isFlooding(socket)) return ack({ ok: false, error: '操作が多すぎます。少し待ってください', retry: true });
    const name = cleanText(p?.name, LIMITS.name);
    if (!name) return ack({ ok: false, error: 'ニックネームを入力してください' });
    if (rooms.size >= MAX_ROOMS) return ack({ ok: false, error: 'ルーム数が上限です。既存のルームに入ってください' });
    let code: string;
    try {
      code = newRoomCode(rooms);
    } catch (e) {
      return ack({ ok: false, error: errorMessage(e) });
    }
    const room = new Room(code);
    rooms.set(room.code, room);
    enter(socket, room, name, undefined, ack);
  });

  socket.on('join', (p: { code?: unknown; name?: unknown; token?: unknown }, ack: Ack) => {
    if (typeof ack !== 'function') return;
    if (isFlooding(socket)) return ack({ ok: false, error: '操作が多すぎます。少し待ってください', retry: true });
    const code = cleanText(p?.code, 4).toUpperCase();
    const room = rooms.get(code);
    if (!room) return ack({ ok: false, error: 'ルームが見つかりません' });
    enter(socket, room, cleanText(p?.name, LIMITS.name), p?.token, ack);
  });

  socket.on('leave', (_p: unknown, ack: Ack) => {
    const { code, playerId } = socket.data;
    const room = code ? rooms.get(code) : undefined;
    socket.data.code = undefined;
    socket.data.playerId = undefined;
    // 同じ席の別タブが残っていれば席はそのまま
    if (room && playerId && !isPlayerOnline(room.code, playerId)) {
      room.leave(playerId);
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
    withRoom(socket, (room, pid) => room.setTopic(pid, randomTopic(room.topic), 'random')),
  );
  socket.on(
    'topic:set',
    withRoom(socket, (room, pid, p) => room.setTopic(pid, cleanText(p.topic, LIMITS.topic), 'custom')),
  );
  socket.on(
    'topic:ai',
    withRoom(socket, (room, pid, p) => {
      if (pid !== room.hostId) throw new GameError('ホストだけが操作できます');
      if (room.phase !== 'lobby') throw new GameError('お題はロビーでだけ変更できます');
      if (room.aiBusy) throw new GameError('AIがお題を考え中です');
      const limited = acquireAiSlot(room.code, socket.handshake.address);
      if (limited) throw new GameError(limited);
      room.aiBusy = true;
      room.notice = 'AIがお題を考えています...';
      generateTopics(sanitizeGenre(p.genre))
        .then((topics) => {
          if (room.phase !== 'lobby') return;
          room.topicCandidates = topics;
          room.topic = topics[0]!;
          room.topicSource = 'ai';
          room.notice = '';
        })
        .catch((e: unknown) => {
          console.error('AI topic failed:', e instanceof Error ? e.message : e);
          if (room.phase !== 'lobby') return;
          room.topic = randomTopic(room.topic);
          room.topicSource = 'ai-fallback';
          room.topicCandidates = [];
          room.notice = 'AI生成に失敗したので、内蔵リストからお題を出しました';
        })
        .finally(() => {
          room.aiBusy = false;
          broadcast(room);
        });
    }),
  );
  socket.on(
    'topic:pick',
    withRoom(socket, (room, pid, p) => room.pickCandidate(pid, p.index)),
  );
  socket.on('start', withRoom(socket, (room, pid) => room.start(pid)));
  socket.on(
    'hint',
    withRoom(socket, (room, pid, p) => room.setHint(pid, p.cardId, cleanText(p.hint, LIMITS.hint))),
  );
  socket.on('place', withRoom(socket, (room, pid, p) => room.place(pid, p.cardId, p.toIndex)));
  socket.on('unplace', withRoom(socket, (room, pid, p) => room.unplace(pid, p.cardId)));
  socket.on('move', withRoom(socket, (room, _pid, p) => room.move(p.cardId, p.toIndex)));
  socket.on(
    'open',
    withRoom(socket, (room, pid) => room.open(pid, REVEAL_INTERVAL_MS, () => broadcast(room))),
  );
  socket.on('lobby', withRoom(socket, (room, pid) => room.backToLobby(pid)));

  socket.on('disconnect', () => detach(socket));
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (!room.hasConnected() && now - room.lastActiveAt > ROOM_IDLE_MS) {
      room.stopReveal();
      rooms.delete(code);
      forgetRoom(code);
    }
  }
}, 5 * 60_000);

httpServer.listen(PORT, () => {
  console.log(`ito server listening on :${PORT}`);
});
