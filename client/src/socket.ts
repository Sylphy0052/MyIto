import { io } from 'socket.io-client';
import type { AckResult } from '../../shared/types';

export const socket = io();

export function send(event: string, payload: object = {}): Promise<AckResult> {
  return new Promise((resolve) => {
    socket.timeout(10_000).emit(event, payload, (err: Error | null, res: AckResult) => {
      resolve(err ? { ok: false, error: '通信がタイムアウトしました', timeout: true } : res);
    });
  });
}

export interface Session {
  code: string;
  /** 再入室用の秘密トークン */
  token: string;
  name: string;
}

const SESSION_KEY = 'ito:session';

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Session>;
    return s.code && s.token && s.name ? { code: s.code, token: s.token, name: s.name } : null;
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
