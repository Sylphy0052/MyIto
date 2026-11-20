import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { GUESS_REPLIES, QUESTION_REPLIES, type DoorsView, type ProposalView } from '../../shared/types';
import type { Act } from './RoomScreen';
import { REPLY_LABEL, REPLY_SYMBOL, kindLabel, replyTone } from './DoorsParts';
import { playChime } from './sound';

/** 秘密の答え。画面共有の事故に備えて隠せる。切り替えはカードがめくれるように見せる */
export function SecretAnswer({ answer }: { answer: string }) {
  const [isHidden, setIsHidden] = useState(false);
  return (
    <div className="secret-answer">
      <span className="label">あなたの答え (GMだけに見えています)</span>
      <div className="secret-row">
        {/* keyを変えて作り直し、flipの演出をやり直す */}
        <span key={isHidden ? 'hidden' : 'shown'} className={`secret-card flip ${isHidden ? 'is-hidden' : ''}`}>
          {isHidden ? '●●●' : answer}
        </span>
        <button className="small" onClick={() => setIsHidden((v) => !v)}>
          {isHidden ? '表示' : '隠す'}
        </button>
      </div>
    </div>
  );
}

function QueueItem({ p, canLie, act }: { p: ProposalView; canLie: boolean; act: Act }) {
  const [isLie, setIsLie] = useState(false);
  const replies = p.kind === 'question' ? QUESTION_REPLIES : GUESS_REPLIES;
  return (
    <m.li
      className="queue-item"
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
    >
      <div className="queue-head">
        <span className="log-seq">{p.seq}</span>
        <span className={`kind-tag kind-${p.isFinal ? 'final' : p.kind}`}>{kindLabel(p.kind, p.isFinal)}</span>
        <span className="log-author">{p.authorName}</span>
      </div>
      <p className="queue-text">{p.text}</p>
      <div className="reply-buttons">
        {replies.map((r) => (
          <button key={r} className={`reply-button ${replyTone(r)}`} onClick={() => act('doors:reply', { id: p.id, reply: r, lie: isLie })}>
            <span aria-hidden="true">{REPLY_SYMBOL[r]}</span> {REPLY_LABEL[r]}
          </button>
        ))}
        <button className="reply-button tone-muted" onClick={() => act('doors:reject', { id: p.id })}>
          却下
        </button>
      </div>
      {p.kind === 'question' && canLie && (
        <label className="lie-toggle">
          <input type="checkbox" checked={isLie} onChange={(e) => setIsLie(e.target.checked)} />
          嘘をつく (印はGMにだけ見え、結果画面で公開されます)
        </label>
      )}
    </m.li>
  );
}

/** GMの画面。未回答の提案に答える。新しい提案が届いたらバッジを跳ねさせて音で知らせる */
export function GmQueue({ doors, act }: { doors: DoorsView; act: Act }) {
  const queue = doors.proposals.filter((p) => p.status === 'sent');
  const liesLeft = doors.maxLies - (doors.liesUsed ?? 0);
  // 再接続・リロード直後は鳴らさない。届いた件数が増えたときだけ知らせる
  const seen = useRef(new Set(queue.map((p) => p.id)));
  const [bump, setBump] = useState(0);
  useEffect(() => {
    const fresh = queue.filter((p) => !seen.current.has(p.id));
    if (fresh.length === 0) return;
    for (const p of fresh) seen.current.add(p.id);
    setBump((n) => n + 1);
    playChime();
  }, [queue]);

  return (
    <section className="doors-panel gm-queue">
      <div className="panel-head">
        <h3>
          未回答{' '}
          <m.span
            key={bump}
            className={`queue-badge ${queue.length > 0 ? 'has-items' : ''}`}
            initial={bump === 0 ? false : { scale: 1.6, y: -8 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 12 }}
          >
            {queue.length}
          </m.span>
        </h3>
        {doors.maxLies > 0 && <span className="muted">残りの嘘: {liesLeft} 回</span>}
      </div>
      {queue.length === 0 && <p className="muted">回答者の提案が承認されると、ここに届きます</p>}
      <ul className="queue-list">
        <AnimatePresence initial={false}>
          {queue.map((p) => (
            <QueueItem key={p.id} p={p} canLie={liesLeft > 0} act={act} />
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}
