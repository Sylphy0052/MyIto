import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { LIMITS, type DoorsView, type ProposalKind, type ProposalView, type RoomView } from '../../shared/types';
import { normalizeText } from '../../shared/normalize';
import type { Act } from './RoomScreen';
import { RadioGroup } from './RadioGroup';
import { LogRow, ReplyBadge, STATUS_LABEL, kindLabel } from './DoorsParts';
import { CorrectPanel, GmQueue } from './DoorsGm';
import { useSoundSetting } from './sound';

const ACTIVE = new Set(['proposed', 'sent']);

export function PlayPhase({
  view,
  doors,
  isGm,
  isHost,
  act,
}: {
  view: RoomView;
  doors: DoorsView;
  isGm: boolean;
  isHost: boolean;
  act: Act;
}) {
  const isFinal = view.phase === 'doors-final';
  const active = doors.proposals.filter((p) => ACTIVE.has(p.status));
  const finished = doors.proposals.filter((p) => !ACTIVE.has(p.status));
  const [isSoundOn, setSoundOn] = useSoundSetting();
  const canExtend = isHost || isGm;
  // 回数を使い切る-1は、ストック中の提案 (GMへ届いた分を含む) を未処理にするので確かめる。
  // AIが回答中の1件はサーバと同じく使用済みとして数え、その回答が付いた時点で使い切る場合も確かめる。
  // サーバが断る-1 (下限を割る、回数が1) は確かめずに送る
  const aiBusyCount = doors.aiBusyId ? 1 : 0;
  const stockCount = active.filter((p) => !p.isFinal).length - aiBusyCount;
  const decrease = () => {
    const isExhausting = !isFinal && doors.limit > 1 && doors.limit - 1 === doors.used + aiBusyCount && stockCount > 0;
    if (isExhausting && !window.confirm(`回数を使い切り、ストック中の提案${stockCount}件は未処理になります。よろしいですか?`)) return;
    void act('doors:extend', { delta: -1 });
  };

  return (
    <div className="doors-play">
      {isFinal && (
        <p className="final-guide">
          {doors.isTimeUp ? '時間切れです。' : '質問回数を使い切りました。'}回答者は最終解答を1回だけ出せます (承認の流れは同じ)。
          {doors.isTimeUp
            ? canExtend
              ? ''
              : doors.used < doors.limit
                ? 'ホストかGMは時間を延ばして質問フェーズへ戻せます。'
                : 'ホストかGMは時間と回数を延ばして質問フェーズへ戻せます。'
            : canExtend
              ? 'あなたは「延長 +1」で質問フェーズへ戻せます。'
              : 'ホストかGMは「延長 +1」で質問フェーズへ戻せます。'}
        </p>
      )}

      {doors.isTimeUp && canExtend && (
        <p className="final-guide">
          {doors.used < doors.limit
            ? '時間切れのため、質問へ戻るには「時間 +1分」で時間も延ばす必要があります (回数を足すだけでは戻りません)。'
            : doors.limit < LIMITS.doorsMaxTotal
              ? '時間切れで回数も使い切っています。質問へ戻るには「延長 +1」で回数を足し、「時間 +1分」で時間も延ばしてください。'
              : `時間切れで、回数も上限の${LIMITS.doorsMaxTotal}回に達しています。これ以上は質問へ戻せません。`}
        </p>
      )}

      <div className="doors-columns">
        {isGm ? <GmQueue doors={doors} act={act} /> : <ProposalForm doors={doors} isFinal={isFinal} act={act} />}
        <ActiveList
          view={view}
          doors={doors}
          active={isGm ? active.filter((p) => p.status === 'proposed') : active}
          isGm={isGm}
          act={act}
        />
      </div>

      <div className="doors-controls">
        {canExtend && (
          <span className="extend-buttons">
            <span className="label">延長 (ホスト・GM)</span>
            <button className="small" onClick={decrease}>
              -1
            </button>
            <button className={`small ${isFinal ? 'primary' : ''}`} onClick={() => act('doors:extend', { delta: 1 })}>
              延長 +1
            </button>
            {doors.timeLimitMin > 0 && (
              <button className={`small ${doors.isTimeUp ? 'primary' : ''}`} onClick={() => act('doors:extend-time')}>
                時間 +1分
              </button>
            )}
          </span>
        )}
        {!isGm && !canExtend && (
          <button className="small" onClick={() => act('doors:extend-request')}>
            延長をお願い
          </button>
        )}
        {isGm && (
          <label className="sound-toggle">
            <input type="checkbox" checked={isSoundOn} onChange={(e) => setSoundOn(e.target.checked)} />
            通知音を鳴らす
          </label>
        )}
      </div>

      <LogList
        finished={finished}
        showLie={isGm}
        canCorrect={isGm && !doors.isAiGm}
        liesLeft={doors.maxLies - (doors.liesUsed ?? 0)}
        act={act}
      />
    </div>
  );
}

/** 直前に届いたGMの回答を大きく出す。再接続直後は出さない */
export function LatestReply({ doors }: { doors: DoorsView }) {
  const answered = doors.proposals.filter((p) => p.status === 'answered');
  const seen = useRef(new Set(answered.map((p) => p.id)));
  const [latest, setLatest] = useState<ProposalView | null>(null);
  useEffect(() => {
    const fresh = answered.filter((p) => !seen.current.has(p.id));
    if (fresh.length === 0) return;
    for (const p of fresh) seen.current.add(p.id);
    setLatest(fresh[fresh.length - 1]!);
  }, [answered]);
  if (!latest?.reply) return null;
  const effect =
    latest.reply === 'close' ? 'warn-pulse' : latest.reply === 'wrong' ? 'ng-shake' : latest.reply === 'correct' ? 'ok-glow' : '';
  return (
    <div className="latest-reply" aria-live="polite">
      <AnimatePresence mode="popLayout">
        <m.div
          key={latest.id}
          className={`latest-reply-card ${effect}`}
          initial={{ opacity: 0, scale: 0.5, y: -10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 420, damping: 16 }}
        >
          <span className="muted">
            {latest.seq}. {kindLabel(latest.kind, latest.isFinal)}「{latest.text}」
          </span>
          <ReplyBadge reply={latest.reply} large />
        </m.div>
      </AnimatePresence>
    </div>
  );
}

function ProposalForm({ doors, isFinal, act }: { doors: DoorsView; isFinal: boolean; act: Act }) {
  const [kind, setKind] = useState<ProposalKind>('question');
  const [text, setText] = useState('');
  const sendKind: ProposalKind = isFinal ? 'guess' : kind;
  const key = normalizeText(text);
  // 同じ内容がすでに出ていれば警告する (止めはしない)
  const duplicate = useMemo(
    () =>
      key ? doors.proposals.find((p) => p.status !== 'cancelled' && p.status !== 'rejected' && normalizeText(p.text) === key) : undefined,
    [doors.proposals, key],
  );
  const activeCount = doors.proposals.filter((p) => ACTIVE.has(p.status) && !p.isFinal).length;
  // 質問の段階は残り回数を超えてストックできる。超えた分は回数を使い切った時点で未処理になる
  const isOverStock = !isFinal && activeCount > doors.limit - doors.used;
  const blocker = isFinal && doors.proposals.some((p) => ACTIVE.has(p.status) && p.isFinal) ? '最終解答は1件ずつ出せます' : '';

  const submit = async () => {
    if (!text.trim() || blocker) return;
    if (await act('doors:propose', { kind: sendKind, text })) setText('');
  };

  return (
    <section className="doors-panel proposal-form">
      <h3>{isFinal ? '最終解答を出す' : '質問・解答を提案'}</h3>
      {!isFinal && (
        <RadioGroup
          label="提案の種類"
          className="kind-toggle"
          options={['question', 'guess'] as const}
          value={kind}
          getLabel={(k) => (k === 'question' ? '質問' : '解答')}
          onChange={setKind}
        />
      )}
      <form
        className="field-row"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          placeholder={sendKind === 'question' ? '例: 生き物ですか?' : '答えだと思うもの'}
          value={text}
          maxLength={LIMITS.doorsProposal}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="primary" disabled={!text.trim() || !!blocker}>
          提案
        </button>
      </form>
      {duplicate && (
        <p className="warn-text">
          同じ内容の提案がすでにあります ({duplicate.seq}. {duplicate.authorName})
        </p>
      )}
      {blocker && <p className="muted">{blocker}</p>}
      {isOverStock && <p className="muted">残り回数を超えてストックしています。回数を使い切ると、残った提案は未処理で終わります。</p>}
      <p className="muted hint-text">
        提案は、提案者以外の回答者全員がOKすると{doors.isAiGm ? 'AI' : 'GM'}へ届きます
        (OKできる人がいなければ自動で届きます)。質問で答えそのものを聞いても (例:「答えは犬ですか」)
        質問として答えられ、勝ちにはなりません。当てるときは「解答」で出してください。
      </p>
    </section>
  );
}

/** 処理中の提案。承認待ちは枠が脈打ち、OKが付くとGMの列へ送られるように動き、取り消すと縮んで消える */
function ActiveList({
  view,
  doors,
  active,
  isGm,
  act,
}: {
  view: RoomView;
  doors: DoorsView;
  active: ProposalView[];
  isGm: boolean;
  act: Act;
}) {
  // AI GMは送信済みを古い順に1件ずつ答える。答えている1件は「回答待ち」で取り消せず、残りは順番待ち
  const sentLabel = (p: ProposalView): string => {
    if (!doors.isAiGm) return `→ ${STATUS_LABEL.sent}`;
    if (p.id === doors.aiBusyId) return '→ 回答待ち (AIが考え中)';
    if (p.id === doors.aiFailedId) return '→ AIの応答に失敗 (ホストが再試行できます)';
    return '→ AIの順番待ち';
  };
  return (
    <section className="doors-panel">
      <h3>処理中の提案</h3>
      {active.length === 0 && <p className="muted">いまはありません</p>}
      <ul className="active-list">
        <AnimatePresence initial={false}>
          {active.map((p) => {
            const isApproved = p.isApprovedByYou;
            const canApprove = !isGm && p.status === 'proposed' && p.authorId !== view.you && !isApproved;
            const isAiWorking = p.id === doors.aiBusyId;
            return (
              <m.li
                key={p.id}
                layout="position"
                className={`active-item status-${p.status} ${isAiWorking ? 'busy-shimmer' : ''}`}
                initial={{ opacity: 0, y: 16, scale: 0.9 }}
                animate={p.status === 'sent' ? { opacity: 1, y: 0, scale: 1, x: [0, 14, 0] } : { opacity: 1, y: 0, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={{ type: 'spring', stiffness: 360, damping: 24 }}
              >
                <div className="queue-head">
                  <span className="log-seq">{p.seq}</span>
                  <span className={`kind-tag kind-${p.isFinal ? 'final' : p.kind}`}>{kindLabel(p.kind, p.isFinal)}</span>
                  <span className="log-author">{p.authorName}</span>
                  <span className={`status-tag status-${p.status}`}>
                    {p.status === 'sent' ? sentLabel(p) : STATUS_LABEL.proposed}
                    {p.status === 'proposed' && ` ${p.approvalsDone}/${p.approvalsNeeded}`}
                    {p.approverNames.length > 0 && ` (OK: ${p.approverNames.join('、')})`}
                  </span>
                </div>
                <p className="queue-text">{p.text}</p>
                {!isGm && (
                  <div className="item-actions">
                    {canApprove && (
                      <button className="small primary" onClick={() => act('doors:approve', { id: p.id })}>
                        OK
                      </button>
                    )}
                    {isApproved && p.status === 'proposed' && <span className="muted">OK済み</span>}
                    {p.status === 'proposed' && p.authorId === view.you && (
                      <span className="muted">
                        ほかの回答者のOK待ち ({p.approvalsDone}/{p.approvalsNeeded})
                      </span>
                    )}
                    {!isAiWorking && (
                      <button className="small" onClick={() => act('doors:cancel', { id: p.id })}>
                        取り消し
                      </button>
                    )}
                  </div>
                )}
              </m.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </section>
  );
}

function LogList({
  finished,
  showLie,
  canCorrect,
  liesLeft,
  act,
}: {
  finished: ProposalView[];
  showLie: boolean;
  canCorrect: boolean;
  liesLeft: number;
  act: Act;
}) {
  const [editingId, setEditingId] = useState('');
  return (
    <section className="doors-panel">
      <h3>ログ</h3>
      {finished.length === 0 && <p className="muted">まだありません</p>}
      <ol className="doors-log">
        {/* 新しい行だけを動かす。最初からある行は静止したまま出す */}
        <AnimatePresence initial={false}>
          {finished.map((p) => (
            <m.li
              key={p.id}
              className={`log-item status-${p.status}`}
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 360, damping: 26 }}
            >
              <LogRow
                p={p}
                showLie={showLie}
                action={
                  canCorrect && p.status === 'answered' && editingId !== p.id ? (
                    <button className="small" onClick={() => setEditingId(p.id)}>
                      訂正
                    </button>
                  ) : undefined
                }
              />
              {canCorrect && p.status === 'answered' && editingId === p.id && (
                <CorrectPanel p={p} canLie={liesLeft > 0} act={act} onClose={() => setEditingId('')} />
              )}
            </m.li>
          ))}
        </AnimatePresence>
      </ol>
    </section>
  );
}
