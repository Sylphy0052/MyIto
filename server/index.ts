import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import { LIMITS, type Ack } from '../shared/types';
import { GameError, Room, cleanText, newRoomCode } from './game';
import { randomTopic } from './topics';
import { acquireAiSlot, forgetRoom, generateTopic, sanitizeGenre } from './ai';

const PORT = Number(process.env.PORT ?? 47213);
const REVEAL_INTERVAL_MS = 1_200;
const HOST_GRACE_MS = 30_000;
const ROOM_IDLE_MS = 60 * 60_000;

const rooms = new Map<string, Room>();

const app = express();
const clientDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'client');
if (existsSync(clientDir)) {
  app.use(express.static(clientDir));
  app.get('/{*path}', (_req, res) => res.sendFile(join(clientDir, 'index.html')));
}
const httpServer = createServer(app);
const io = new Server(httpServer, { maxHttpBufferSize: 16 * 1024 });

interface SocketData {
  code?: string;
  playerId?: string;
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

/** 入室済みソケットの操作を、例外を ack へ変換して実行する */
function withRoom(socket: GameSocket, fn: (room: Room, playerId: string, payload: Payload) => void) {
  return (...args: unknown[]) => {
    const last = args[args.length - 1];
    const ack: Ack = typeof last === 'function' ? (last as Ack) : () => {};
    const first = args[0];
    const payload: Payload = first && typeof first === 'object' ? (first as Payload) : {};
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

function enter(socket: GameSocket, room: Room, name: string, playerId: unknown, ack: Ack): void {
  try {
    const player = room.join(name, typeof playerId === 'string' ? playerId : undefined);
    socket.data.code = room.code;
    socket.data.playerId = player.id;
    ack({ ok: true, code: room.code, playerId: player.id });
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
  socket.on('create', (p: { name?: unknown; playerId?: unknown }, ack: Ack) => {
    if (typeof ack !== 'function') return;
    const name = cleanText(p?.name, LIMITS.name);
    if (!name) return ack({ ok: false, error: 'ニックネームを入力してください' });
    const room = new Room(newRoomCode(rooms));
    rooms.set(room.code, room);
    enter(socket, room, name, undefined, ack);
  });

  socket.on('join', (p: { code?: unknown; name?: unknown; playerId?: unknown }, ack: Ack) => {
    if (typeof ack !== 'function') return;
    const code = cleanText(p?.code, 4).toUpperCase();
    const room = rooms.get(code);
    if (!room) return ack({ ok: false, error: 'ルームが見つかりません' });
    enter(socket, room, cleanText(p?.name, LIMITS.name), p?.playerId, ack);
  });

  socket.on(
    'settings',
    withRoom(socket, (room, pid, p) => room.setSettings(pid, p.mode, p.cardsPerPlayer)),
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
      const limited = acquireAiSlot(room.code);
      if (limited) throw new GameError(limited);
      room.aiBusy = true;
      room.notice = 'AIがお題を考えています...';
      generateTopic(sanitizeGenre(p.genre))
        .then((topic) => {
          if (room.phase !== 'lobby') return;
          room.topic = topic;
          room.topicSource = 'ai';
          room.notice = '';
        })
        .catch((e: unknown) => {
          console.error('AI topic failed:', e instanceof Error ? e.message : e);
          if (room.phase !== 'lobby') return;
          room.topic = randomTopic(room.topic);
          room.topicSource = 'ai-fallback';
          room.notice = 'AI生成に失敗したので、内蔵リストからお題を出しました';
        })
        .finally(() => {
          room.aiBusy = false;
          broadcast(room);
        });
    }),
  );
  socket.on('start', withRoom(socket, (room, pid) => room.start(pid)));
  socket.on(
    'hint',
    withRoom(socket, (room, pid, p) => room.setHint(pid, p.cardId, cleanText(p.hint, LIMITS.hint))),
  );
  socket.on('play', withRoom(socket, (room, pid, p) => room.play(pid, p.cardId)));
  socket.on('move', withRoom(socket, (room, _pid, p) => room.move(p.cardId, p.toIndex)));
  socket.on(
    'open',
    withRoom(socket, (room, pid) => room.open(pid, REVEAL_INTERVAL_MS, () => broadcast(room))),
  );
  socket.on('lobby', withRoom(socket, (room, pid) => room.backToLobby(pid)));

  socket.on('disconnect', () => {
    const { code, playerId } = socket.data;
    const room = code ? rooms.get(code) : undefined;
    if (!room || !playerId) return;
    if (isPlayerOnline(room.code, playerId)) return;
    room.setConnected(playerId, false);
    broadcast(room);
    if (playerId === room.hostId) {
      setTimeout(() => {
        if (rooms.get(room.code) === room && room.reassignHostIfAway()) broadcast(room);
      }, HOST_GRACE_MS);
    }
  });
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
