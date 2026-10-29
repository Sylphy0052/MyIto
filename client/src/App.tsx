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
    const rejoin = async () => {
      setConnected(true);
      const s = loadSession();
      if (!s) return;
      const res = await send('join', { code: s.code, name: s.name, playerId: s.playerId });
      if (!res.ok) {
        clearSession();
        setView(null);
        showError(res.error);
      }
    };
    const onDisconnect = () => setConnected(false);
    socket.on('connect', rejoin);
    socket.on('disconnect', onDisconnect);
    socket.on('state', setView);
    if (socket.connected) void rejoin();
    return () => {
      socket.off('connect', rejoin);
      socket.off('disconnect', onDisconnect);
      socket.off('state', setView);
    };
  }, [showError]);

  const enterRoom = async (name: string, code: string | null) => {
    const res = code ? await send('join', { code, name }) : await send('create', { name });
    if (!res.ok) return showError(res.error);
    saveSession({ code: res.code!, playerId: res.playerId!, name });
  };

  const leave = () => {
    clearSession();
    setView(null);
    socket.disconnect().connect();
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
