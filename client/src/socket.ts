import { io, type Socket } from 'socket.io-client';
import type { AckResult, ClientEventName, ClientEventPayloads, ClientToServerEvents, ServerToClientEvents } from '../../shared/types';

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io();

export function send<E extends ClientEventName>(
  event: E,
  payload: ClientEventPayloads[E] = {} as ClientEventPayloads[E],
): Promise<AckResult> {
  return new Promise((resolve) => {
    (socket.timeout(10_000) as unknown as { emit: (e: string, p: unknown, cb: (err: Error | null, res: AckResult) => void) => void }).emit(
      event,
      payload,
      (err: Error | null, res: AckResult) => {
        resolve(err ? { ok: false, error: '通信がタイムアウトしました', retry: true } : res);
      },
    );
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
