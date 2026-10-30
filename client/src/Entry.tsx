import { useState } from 'react';
import { m, type Variants } from 'motion/react';
import { LIMITS } from '../../shared/types';
import { loadSession } from './socket';

interface Props {
  onEnter: (name: string, code: string | null) => Promise<void>;
}

const TITLE = 'ito online';
// タイトルの上に浮かべる飾りのカード
const DECO_NUMBERS = [7, 42, 88, 100, 1, 63];
const DECO_STEP_PERCENT = 16;
const DECO_TILT_DEG = 8;

const panelVariants: Variants = {
  hidden: { opacity: 0, y: 24, scale: 0.96 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring', stiffness: 220, damping: 22, staggerChildren: 0.07, delayChildren: 0.15 },
  },
};
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};
const titleVariants: Variants = {
  show: { transition: { staggerChildren: 0.05 } },
};
const letterVariants: Variants = {
  hidden: { opacity: 0, y: -24, rotate: -12 },
  show: { opacity: 1, y: 0, rotate: 0, transition: { type: 'spring', stiffness: 400, damping: 14 } },
};

export function Entry({ onEnter }: Props) {
  const [name, setName] = useState(() => loadSession()?.name ?? localStorage.getItem('ito:name') ?? '');
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '');
  const [busy, setBusy] = useState(false);

  const submit = async (joinCode: string | null) => {
    if (busy) return;
    setBusy(true);
    localStorage.setItem('ito:name', name.trim());
    await onEnter(name.trim(), joinCode);
    setBusy(false);
  };

  return (
    <m.div className="entry" variants={panelVariants} initial="hidden" animate="show">
      <div className="entry-deco" aria-hidden="true">
        {DECO_NUMBERS.map((n, i) => {
          const tilt = i % 2 ? -DECO_TILT_DEG : DECO_TILT_DEG;
          return (
            <m.span
              key={n}
              className="entry-deco-card"
              style={{ left: `${4 + i * DECO_STEP_PERCENT}%` }}
              initial={{ opacity: 0, y: 30, rotate: tilt }}
              animate={{ opacity: 1, y: [0, -8, 0], rotate: [tilt, tilt / 2, tilt] }}
              transition={{
                opacity: { delay: 0.3 + i * 0.08 },
                y: { duration: 3 + i * 0.4, repeat: Infinity, ease: 'easeInOut' },
                rotate: { duration: 4 + i * 0.3, repeat: Infinity, ease: 'easeInOut' },
              }}
            >
              {n}
            </m.span>
          );
        })}
      </div>
      <m.h1 variants={titleVariants} aria-label={TITLE}>
        {/* TITLEは固定文字列なので位置をkeyにしてよい。空白はinline-blockで潰れるのでNBSPに置き換える */}
        {[...TITLE].map((ch, i) => (
          <m.span key={i} className="entry-title-char" variants={letterVariants} aria-hidden="true">
            {ch === ' ' ? '\u00A0' : ch}
          </m.span>
        ))}
      </m.h1>
      <m.label variants={itemVariants}>
        ニックネーム
        <input value={name} maxLength={LIMITS.name} onChange={(e) => setName(e.target.value)} />
      </m.label>
      <m.div className="entry-row" variants={itemVariants}>
        <input
          className="code-input"
          placeholder="ルームコード"
          value={code}
          maxLength={4}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <button disabled={busy || !name.trim() || code.length !== 4} onClick={() => submit(code)}>
          入室
        </button>
      </m.div>
      <m.div className="entry-or" variants={itemVariants}>
        または
      </m.div>
      <m.button
        className="primary shine"
        variants={itemVariants}
        whileTap={{ scale: 0.96 }}
        disabled={busy || !name.trim()}
        onClick={() => submit(null)}
      >
        ルームを作る
      </m.button>
    </m.div>
  );
}
