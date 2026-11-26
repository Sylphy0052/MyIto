import { AnimatePresence, m } from 'motion/react';
import type { DoorsView } from '../../shared/types';
import { gmExpressionFor } from './gmExpression';

/** AI GMの立ち絵。表情が変わるとクロスフェードする。人GMのときは出さない */
export function GmPortrait({ doors }: { doors: DoorsView }) {
  if (!doors.isAiGm) return null;
  const expression = gmExpressionFor(doors);
  return (
    <div className="gm-portrait" aria-hidden="true">
      <AnimatePresence initial={false}>
        <m.img
          key={expression}
          src={`/gm/${expression}.webp`}
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
    </div>
  );
}
