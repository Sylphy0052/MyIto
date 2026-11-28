import { AnimatePresence, m, type TargetAndTransition, type Transition, type Variants } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { DoorsView } from '../../shared/types';
import { expressionForCue, gmCueFor, gmImageFor, preloadGmImages, type GmCue } from './gmExpression';

/** 漫符を出しておく時間 (ms) */
const MARK_MS = 1300;

const KEYFRAME_TRANSITION = { duration: 0.6, ease: 'easeInOut' } as const;
const SINK_TRANSITION = { duration: 1, ease: 'easeInOut' } as const;

// 動きの途中で合図が変わっても、前の動きの値が残らないよう、全合図で動かさない値は静止位置へ戻す
const REST = { x: 0, y: 0, rotate: 0, scale: 1, scaleY: 1 };
const move = (keyframes: TargetAndTransition, transition: Transition = KEYFRAME_TRANSITION): TargetAndTransition => ({ ...REST, ...keyframes, transition });

const HOP = move({ y: [null, -10, 0, -5, 0] }); // yes: 小さく弾む
const JUMP = move({ y: [null, -18, 0, -8, 0] }); // close・correct: 跳ねる
const TILT = move({ rotate: [null, 6, 4, 6, 0] }); // unknown・maybe-no: 首をかしげる
const PUFF = move({ scaleY: [null, 1.06, 1] }); // wrong・lose: 胸を張る
const SINK = move({ y: [null, 12, 12, 0] }, SINK_TRANSITION); // win・error: 沈む

/** 合図が変わった瞬間のワンショットの動き。reduced-motionでは client/src/main.tsx の MotionConfig がtransformを止める */
const CUE_MOTION: Variants = {
  idle: move({}),
  thinking: move({}),
  yes: HOP,
  no: move({ rotate: [null, -6, 6, -5, 5, 0] }),
  'maybe-yes': move({ scale: [null, 0.94, 1] }),
  unknown: TILT,
  'maybe-no': TILT,
  close: JUMP,
  correct: JUMP,
  wrong: PUFF,
  lose: PUFF,
  win: SINK,
  error: SINK,
  aborted: move({ x: [null, -8, 8, -8, 8, 0] }),
};

const TEAR = (
  <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
    <path d="M12 2 C12 2 5 11 5 15 a7 7 0 0 0 14 0 C19 11 12 2 12 2 Z" fill="#6cb6ff" stroke="#2b6cb0" strokeWidth="1.5" />
  </svg>
);

const ANGER = (
  <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" fill="none" stroke="#e53e3e" strokeWidth="2.5" strokeLinecap="round">
    <path d="M3 9 Q9 9 9 3 M21 9 Q15 9 15 3 M3 15 Q9 15 9 21 M21 15 Q15 15 15 21" />
  </svg>
);

const BLUSH_LINES = (
  <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" fill="none" stroke="#e5547a" strokeWidth="2.5" strokeLinecap="round">
    <path d="M6 6 L4 14 M12 6 L10 14 M18 6 L16 14" />
  </svg>
);

/** 合図ごとの漫符。画像素材は使わず文字とインラインSVGで作る */
const CUE_MARK: Partial<Record<GmCue, ReactNode>> = {
  thinking: '…',
  yes: '♪',
  no: '×',
  'maybe-yes': BLUSH_LINES,
  unknown: '?',
  'maybe-no': '?',
  close: '!',
  correct: '!',
  wrong: '✦',
  lose: '✦',
  win: TEAR,
  error: TEAR,
  aborted: ANGER,
};

/** AI GMの立ち絵。表情が変わるとクロスフェードし、合図が変わると動きと漫符が出る。人GMのときは出さない */
export function GmPortrait({ doors }: { doors: DoorsView }) {
  if (!doors.isAiGm) return null;
  return <AiPortrait cue={gmCueFor(doors)} />;
}

function AiPortrait({ cue }: { cue: GmCue }) {
  const expression = expressionForCue(cue);
  const [markCue, setMarkCue] = useState<GmCue | null>(null);
  // 前回の合図。表示を開いた時点の合図は「変わった」ではないので、漫符を出さない (動きも initial={false} で出ない)
  const prevCue = useRef(cue);

  // AI GMの画面が出た時点で全表情の画像を先読みする
  useEffect(() => {
    preloadGmImages();
  }, []);

  useEffect(() => {
    if (prevCue.current === cue) return;
    prevCue.current = cue;
    // 合図が変わったら、表示中の漫符はすぐ新しいものに入れ替える
    setMarkCue(cue in CUE_MARK ? cue : null);
    const timer = setTimeout(() => setMarkCue(null), MARK_MS);
    return () => clearTimeout(timer);
  }, [cue]);

  return (
    <m.div
      className="gm-portrait"
      aria-hidden="true"
      variants={CUE_MOTION}
      initial={false}
      animate={cue}
      style={{ transformOrigin: '50% 100%' }}
    >
      <AnimatePresence initial={false}>
        <m.img
          key={expression}
          src={gmImageFor(expression)}
          alt=""
          draggable={false}
          onError={(e) => {
            // 素材が欠けていても壊れた画像のアイコンは出さない
            e.currentTarget.style.visibility = 'hidden';
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
        />
      </AnimatePresence>
      <AnimatePresence>
        {markCue && (
          <m.span
            key={markCue}
            className="gm-portrait-mark"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0 } }}
            transition={{ duration: 0.25 }}
          >
            {CUE_MARK[markCue]}
          </m.span>
        )}
      </AnimatePresence>
    </m.div>
  );
}
