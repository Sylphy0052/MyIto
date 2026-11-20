import type { ReactNode } from 'react';
import { AnimatePresence, m } from 'motion/react';
import type { DoorsReply, DoorsView, ProposalKind, ProposalStatus, ProposalView } from '../../shared/types';

export const REPLY_LABEL: Record<DoorsReply, string> = {
  yes: 'Yes',
  no: 'No',
  'maybe-yes': 'どちらかといえばYes',
  'maybe-no': 'どちらかといえばNo',
  unknown: '分からない',
  correct: '正解',
  close: 'おしい',
  wrong: '不正解',
};

// 色だけに頼らず、記号でも区別できるようにする
export const REPLY_SYMBOL: Record<DoorsReply, string> = {
  yes: '○',
  no: '×',
  'maybe-yes': '△',
  'maybe-no': '△',
  unknown: '?',
  correct: '◎',
  close: '△',
  wrong: '×',
};

/** ラウンドが終わる判定 (解答の正解、最終解答への判定) は、押す前に確かめる */
export function confirmReply(p: Pick<ProposalView, 'kind' | 'isFinal' | 'text'>, reply: DoorsReply): boolean {
  if (p.kind !== 'guess' || (reply !== 'correct' && !p.isFinal)) return true;
  const ends = reply === 'correct' ? '回答者の勝ちでラウンドが終わります' : 'ラウンドが終わります';
  return window.confirm(`「${p.text}」を${REPLY_LABEL[reply]}にします。${ends}。よろしいですか?`);
}

export const STATUS_LABEL: Record<ProposalStatus, string> = {
  proposed: '承認待ち',
  sent: 'GMの回答待ち',
  answered: '回答済み',
  rejected: '却下',
  cancelled: '取り消し',
  discarded: '未処理',
};

export function kindLabel(kind: ProposalKind, isFinal: boolean): string {
  if (isFinal) return '最終解答';
  return kind === 'question' ? '質問' : '解答';
}

/** 返答の種類ごとの色の分類 (CSSのクラス名) */
export function replyTone(reply: DoorsReply): string {
  if (reply === 'yes' || reply === 'maybe-yes' || reply === 'correct') return 'tone-ok';
  if (reply === 'no' || reply === 'maybe-no' || reply === 'wrong') return 'tone-ng';
  if (reply === 'close') return 'tone-warn';
  return 'tone-muted';
}

export function ReplyBadge({ reply, large }: { reply: DoorsReply; large?: boolean }) {
  return (
    <span className={`reply-badge ${replyTone(reply)} ${large ? 'large' : ''}`}>
      <span className="reply-symbol" aria-hidden="true">
        {REPLY_SYMBOL[reply]}
      </span>
      {REPLY_LABEL[reply]}
    </span>
  );
}

// 10枚までは扉を並べ、それより多いときは数字で見せる
const MAX_DOOR_ICONS = 10;

function Door({ isOpen, isGlowing }: { isOpen: boolean; isGlowing: boolean }) {
  return (
    <m.span
      className={`door-slot ${isGlowing ? 'glowing' : ''}`}
      layout="position"
      initial={{ opacity: 0, scale: 0.4 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.4 }}
      transition={{ type: 'spring', stiffness: 380, damping: 24 }}
    >
      <m.span
        className="door"
        initial={false}
        animate={{ rotateY: isOpen ? -72 : 0, opacity: isOpen ? 0.55 : 1 }}
        transition={{ type: 'spring', stiffness: 160, damping: 16 }}
      />
    </m.span>
  );
}

/** 残り回数。回答されるたびに扉が開き、延長で増減する */
export function DoorRow({ doors, isFinal }: { doors: DoorsView; isFinal: boolean }) {
  const remaining = Math.max(0, doors.limit - doors.used);
  const label = isFinal ? '最終解答' : `残り ${remaining} / ${doors.limit} 回`;
  if (doors.limit > MAX_DOOR_ICONS) {
    return (
      <div className="door-row" aria-label={label}>
        <span className="count-box door-counter">
          <AnimatePresence mode="popLayout" initial={false}>
            <m.strong
              key={remaining}
              className="count"
              initial={{ opacity: 0, y: -12, scale: 1.4 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ type: 'spring', stiffness: 400, damping: 18 }}
            >
              {remaining}
            </m.strong>
          </AnimatePresence>
        </span>
        <span className="muted">/ {doors.limit} 回 {isFinal && '(最終解答)'}</span>
      </div>
    );
  }
  return (
    <div className="door-row" aria-label={label}>
      <span className="door-icons" aria-hidden="true">
        <AnimatePresence initial={false}>
          {/* 扉は左から順に開くだけで並び替わらないので、位置をkeyにする */}
          {Array.from({ length: doors.limit }, (_, i) => (
            <Door key={i} isOpen={i < doors.used} isGlowing={isFinal && i === doors.limit - 1} />
          ))}
        </AnimatePresence>
      </span>
      <span className="muted">{label}</span>
    </div>
  );
}

/** ログの1行。通し番号、提案者、質問/解答の別、回答や処理の結果 */
export function LogRow({ p, showLie, action }: { p: ProposalView; showLie: boolean; action?: ReactNode }) {
  return (
    <>
      <span className="log-seq">{p.seq}</span>
      <span className={`kind-tag kind-${p.isFinal ? 'final' : p.kind}`}>{kindLabel(p.kind, p.isFinal)}</span>
      <span className="log-text">
        <span className="log-author">{p.authorName}</span>
        {p.text}
      </span>
      <span className="log-result">
        {p.reply ? <ReplyBadge reply={p.reply} /> : <span className={`status-tag status-${p.status}`}>{STATUS_LABEL[p.status]}</span>}
        {showLie && p.lie && <span className="lie-tag">嘘</span>}
        {p.correctedFrom && p.reply && (
          <small className="muted corrected-tag">
            訂正: {REPLY_LABEL[p.correctedFrom]} → {REPLY_LABEL[p.reply]}
          </small>
        )}
        {action}
        {p.status === 'cancelled' && p.cancelledByName && <small className="muted"> ({p.cancelledByName})</small>}
        {p.reason && <small className="muted reply-reason"> {p.reason}</small>}
      </span>
    </>
  );
}

/** 「GMが答えを考え中」の待機表示。itoの揺れるカードを扉に差し替えたもの */
export function WaitingDoors({ text }: { text: string }) {
  return (
    <div className="lobby-waiting">
      <div className="waiting-cards" aria-hidden="true">
        {[0, 1, 2].map((i) => {
          const tilt = (i - 1) * 8;
          return (
            <m.span
              key={i}
              className="waiting-door"
              animate={{ y: [0, -10, 0], rotate: [tilt, tilt * 1.4, tilt] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut', delay: i * 0.18 }}
            />
          );
        })}
      </div>
      <p className="muted">
        {text}
        <span className="dots" aria-hidden="true">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      </p>
    </div>
  );
}
