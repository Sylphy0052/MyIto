import { io } from 'socket.io-client';

export const socket = io();

type AckResult = { ok: true; code?: string; playerId?: string } | { ok: false; error: string };

export function send(event: string, payload: object = {}): Promise<AckResult> {
  return new Promise((resolve) => {
    socket.timeout(10_000).emit(event, payload, (err: Error | null, res: AckResult) => {
      resolve(err ? { ok: false, error: '通信がタイムアウトしました' } : res);
    });
  });
}

export interface Session {
  code: string;
  playerId: string;
  name: string;
}

const SESSION_KEY = 'ito:session';

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Session>;
    return s.code && s.playerId && s.name ? { code: s.code, playerId: s.playerId, name: s.name } : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}
