import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomView } from '../../shared/types';
import { AnimatePresence, m } from 'motion/react';
import { clearSession, loadSession, saveSession, send, socket } from './socket';
import { Entry } from './Entry';
import { RoomScreen } from './RoomScreen';

// 背景にゆっくり漂うカードの影。位置・大きさ・周期は固定値で、描画ごとに変わらないようにする
const BACKDROP_CARDS = [
  { left: '6%', size: 64, duration: 26, delay: 0 },
  { left: '22%', size: 44, duration: 32, delay: -8 },
  { left: '41%', size: 72, duration: 38, delay: -20 },
  { left: '63%', size: 52, duration: 29, delay: -4 },
  { left: '80%', size: 68, duration: 35, delay: -15 },
  { left: '92%', size: 40, duration: 24, delay: -11 },
];

function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      {BACKDROP_CARDS.map((c) => (
        <span
          key={c.left}
          className="backdrop-card"
          style={{
            left: c.left,
            width: c.size,
            height: c.size * 1.4,
            animationDuration: `${c.duration}s`,
            animationDelay: `${c.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

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
      <Backdrop />
      <AnimatePresence>
        {!connected && (
          <m.div
            key="banner"
            className="banner"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            サーバに再接続しています...
          </m.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {error && (
          <m.div
            key={error}
            className="toast"
            role="alert"
            initial={{ opacity: 0, y: -24, x: '-50%', scale: 0.9 }}
            animate={{ opacity: 1, y: 0, x: ['-50%', '-52%', '-48%', '-50%'], scale: 1 }}
            exit={{ opacity: 0, y: -24, x: '-50%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 24, x: { duration: 0.3, delay: 0.15 } }}
          >
            {error}
          </m.div>
        )}
      </AnimatePresence>
      <AnimatePresence mode="wait">
        {view ? (
          <m.div key="room" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <RoomScreen view={view} act={act} onLeave={leave} />
          </m.div>
        ) : (
          <m.div key="entry" exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}>
            <Entry onEnter={enterRoom} />
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
