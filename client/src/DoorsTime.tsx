import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import type { DoorsView } from '../../shared/types';
import { playChime, useSoundSetting } from './sound';

const TICK_MS = 250;
const WARN_MS = 60_000;
const URGENT_MS = 10_000;
const TIME_UP_NOTICE_MS = 8000;

function formatLeft(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * 質問の段階の残り時間。サーバは締切の時刻でなく残りミリ秒を送るので、受け取った時点から手元の時計で数え直す
 * (端末の時計のずれに左右されない)。残り1分で色を変え、残り10秒で脈打たせる (reduced-motionでは色だけ)
 */
export function TimeLeft({ doors }: { doors: DoorsView }) {
  const received = doors.timeLeftMs;
  // 受け取った値と、そのとき手元で測った時刻。新しい値が届いたその描画で基準を替える (古い基準で1回描かない)
  const base = useMemo(() => ({ left: received, at: performance.now() }), [received]);
  const [now, setNow] = useState(() => performance.now());
  const isTicking = received !== null && !doors.isTimeUp;
  useEffect(() => {
    if (!isTicking) return;
    const timer = window.setInterval(() => setNow(performance.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [isTicking]);

  if (received === null || doors.timeLimitMin === 0) return null;
  if (doors.isTimeUp) return <span className="time-left is-up">時間切れ</span>;
  const left = Math.max(0, (base.left ?? received) - (Math.max(now, base.at) - base.at));
  const tone = left <= URGENT_MS ? 'is-urgent' : left <= WARN_MS ? 'is-warn' : '';
  return (
    <span className={`time-left ${tone}`} role="timer" aria-label={`残り時間 ${formatLeft(left)}`}>
      残り <strong>{formatLeft(left)}</strong>
    </span>
  );
}

/** 時間切れを知らせる。再接続・リロード直後は出さない。通知音をオンにしている人だけ鳴らす */
export function TimeUpNotice({ doors }: { doors: DoorsView }) {
  const [isSoundOn] = useSoundSetting();
  // 音の設定は鳴らす瞬間に読むだけ。依存に入れると、切り替えたときに消すタイマーが外れて通知が出たままになる
  const isSoundOnRef = useRef(isSoundOn);
  isSoundOnRef.current = isSoundOn;
  const wasUp = useRef(doors.isTimeUp);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (doors.isTimeUp === wasUp.current) return;
    wasUp.current = doors.isTimeUp;
    if (!doors.isTimeUp) {
      setShown(0);
      return;
    }
    setShown((n) => n + 1);
    if (isSoundOnRef.current) playChime();
  }, [doors.isTimeUp]);
  // 出してから一定時間で消す。出し直したら数え直す
  useEffect(() => {
    if (shown === 0) return;
    const timer = window.setTimeout(() => setShown(0), TIME_UP_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [shown]);
  return (
    <AnimatePresence>
      {shown > 0 && (
        <m.div
          key={shown}
          className="notice time-up-notice"
          role="status"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0 }}
        >
          時間切れ。最終解答へ進みます
        </m.div>
      )}
    </AnimatePresence>
  );
}
