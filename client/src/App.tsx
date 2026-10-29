import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomView } from '../../shared/types';
import { clearSession, loadSession, saveSession, send, socket } from './socket';
import { Entry } from './Entry';
import { RoomScreen } from './RoomScreen';

export function App() {
  const [view, setView] = useState<RoomView | null>(null);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(socket.connected);
  const errorTimer = useRef<number | undefined>(undefined);

  const showError = useCallback((msg: string) => {
    setError(msg);
    window.clearTimeout(errorTimer.current);
    errorTimer.current = window.setTimeout(() => setError(''), 4000);
  }, []);

  useEffect(() => {
    // 新しい rejoin を始めたら、古い join の結果と再試行タイマーは捨てる
    let generation = 0;
    let retryTimer: number | undefined;
    const rejoin = async () => {
      setConnected(true);
      window.clearTimeout(retryTimer);
      const s = loadSession();
      if (!s) return;
      const current = ++generation;
      const res = await send('join', { code: s.code, name: s.name, token: s.token });
      if (current !== generation || res.ok) return;
      showError(res.error);
      // 一時的な失敗はセッションを残して再試行し、サーバが断ったとき (ルームや席が無い) だけ捨てる
      if (res.retry) {
        if (socket.connected) retryTimer = window.setTimeout(() => void rejoin(), 3000);
      } else {
        clearSession();
        setView(null);
      }
    };
    const onDisconnect = () => setConnected(false);
    socket.on('connect', rejoin);
    socket.on('disconnect', onDisconnect);
    socket.on('state', setView);
    if (socket.connected) void rejoin();
    return () => {
      generation += 1;
      window.clearTimeout(retryTimer);
      socket.off('connect', rejoin);
      socket.off('disconnect', onDisconnect);
      socket.off('state', setView);
    };
  }, [showError]);

  const enterRoom = async (name: string, code: string | null) => {
    const res = code ? await send('join', { code, name }) : await send('create', { name });
    if (!res.ok) return showError(res.error);
    saveSession({ code: res.code!, token: res.token!, name });
  };

  const leave = async () => {
    await send('leave');
    clearSession();
    setView(null);
  };

  /** ゲーム操作を送り、失敗したらエラーを表示する */
  const act = useCallback(
    async (event: string, payload: object = {}) => {
      const res = await send(event, payload);
      if (!res.ok) showError(res.error);
    },
    [showError],
  );

  return (
    <div className="app">
      {!connected && <div className="banner">サーバに再接続しています...</div>}
      {error && <div className="toast">{error}</div>}
      {view ? <RoomScreen view={view} act={act} onLeave={leave} /> : <Entry onEnter={enterRoom} />}
    </div>
  );
}
