import { useEffect, useState } from 'react';
import { m, type Variants } from 'motion/react';
import type { DoorsView, RoomView } from '../../shared/types';
import type { Act } from './RoomScreen';
import { LogRow, REPLY_LABEL, STATUS_LABEL, kindLabel } from './DoorsParts';
import { copyText } from './copyText';

const COPIED_LABEL_MS = 2000;

// 嘘印の付いた回答を順にめくって公開する (itoの結果のめくりと同じstagger)
const liesVariants: Variants = {
  show: { transition: { staggerChildren: 0.35, delayChildren: 0.6 } },
};
const lieVariants: Variants = {
  hidden: { opacity: 0, rotateY: -90 },
  show: { opacity: 1, rotateY: 0, transition: { type: 'spring', stiffness: 220, damping: 18 } },
};

export function outcomeLabel(doors: DoorsView): string {
  if (doors.outcome === 'win') return '回答者の勝ち';
  if (doors.outcome === 'lose') return '回答者の負け';
  return `中止 (${doors.abortReason || '理由不明'})`;
}

/** 通話で共有する用のテキスト。答え・勝敗・全ログ */
function logText(view: RoomView, doors: DoorsView): string {
  const lines = doors.proposals.map((p) => {
    const result = p.reply ? REPLY_LABEL[p.reply] : STATUS_LABEL[p.status];
    return `${p.seq}. [${kindLabel(p.kind, p.isFinal)}] ${p.authorName}: ${p.text} → ${result}${p.lie ? ' (嘘)' : ''}`;
  });
  return [`10の扉 テーマ: ${view.topic}`, `答え: ${doors.answer || '(未決定)'}`, `結果: ${outcomeLabel(doors)}`, '', ...lines].join('\n');
}

interface Props {
  view: RoomView;
  doors: DoorsView;
  isHost: boolean;
  act: Act;
  /** その場で結果画面へ進んだか。リロード・再接続では false で、紙吹雪とめくりを出さない */
  isJustFinished: boolean;
}

export function DoorsResult({ view, doors, isHost, act, isJustFinished }: Props) {
  const isWin = doors.outcome === 'win';
  const isLose = doors.outcome === 'lose';
  const lies = doors.proposals.filter((p) => p.lie);

  useEffect(() => {
    if (!isWin || !isJustFinished) return;
    let isCancelled = false;
    let reset: (() => void) | undefined;
    import('canvas-confetti')
      .then(({ default: confetti }) => {
        if (isCancelled) return;
        reset = confetti.reset;
        const burst = (originX: number, angle: number) =>
          confetti({ particleCount: 90, spread: 70, angle, origin: { x: originX, y: 0.7 }, disableForReducedMotion: true });
        burst(0.1, 60);
        burst(0.9, 120);
      })
      .catch(() => {
        // 紙吹雪は飾り。読み込みに失敗しても進行は止めない
      });
    return () => {
      isCancelled = true;
      reset?.();
    };
  }, [isWin, isJustFinished]);

  const [copiedAt, setCopiedAt] = useState(0);
  useEffect(() => {
    if (copiedAt === 0) return;
    const timer = setTimeout(() => setCopiedAt(0), COPIED_LABEL_MS);
    return () => clearTimeout(timer);
  }, [copiedAt]);
  const copyLog = async () => {
    const text = logText(view, doors);
    if (await copyText(text)) setCopiedAt(Date.now());
    else window.prompt('ログ', text);
  };

  return (
    <section className={`result doors-result ${isLose ? 'is-lose' : ''}`}>
      {/* 負けは静かに暗転する。不透明度だけを動かす */}
      {isLose && (
        <m.div className="result-dim" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.2 }} />
      )}
      <h2 className={isWin ? 'perfect' : undefined}>{outcomeLabel(doors)}</h2>
      <div className="answer-reveal">
        <span className="label">答え</span>
        <span className={`secret-card ${isJustFinished ? 'flip' : ''}`}>{doors.answer || '(未決定)'}</span>
      </div>
      {lies.length > 0 && (
        <div className="lie-reveal">
          <span className="label">GMの嘘</span>
          <m.ul variants={liesVariants} initial={isJustFinished ? 'hidden' : false} animate="show">
            {lies.map((p) => (
              <m.li key={p.id} variants={lieVariants} className="lie-item">
                {p.seq}. {p.text} → {p.reply && REPLY_LABEL[p.reply]} <span className="lie-tag">嘘</span>
              </m.li>
            ))}
          </m.ul>
        </div>
      )}
      <ol className="doors-log result-log">
        {doors.proposals.map((p) => (
          <li key={p.id} className={`log-item status-${p.status}`}>
            <LogRow p={p} showLie />
          </li>
        ))}
      </ol>
      <div className="result-actions">
        <button className="small" onClick={() => void copyLog()}>
          {copiedAt ? 'コピーしました' : 'ログをコピー'}
        </button>
        {isHost ? (
          <button className="primary" onClick={() => act('lobby')}>
            ロビーに戻る (設定は引き継ぎます)
          </button>
        ) : (
          <p className="muted">ホストがロビーへ戻すのを待っています</p>
        )}
      </div>
    </section>
  );
}
