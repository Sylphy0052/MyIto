import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { LIMITS, type DoorsView, type ProposalKind, type ProposalView, type RoomView } from '../../shared/types';
import { normalizeText } from '../../shared/normalize';
import type { Act } from './RoomScreen';
import { DoorRow, LogRow, ReplyBadge, STATUS_LABEL, WaitingDoors, kindLabel } from './DoorsParts';
import { GmQueue, SecretAnswer } from './DoorsGm';
import { DoorsResult } from './DoorsResult';
import { playChime, useSoundSetting } from './sound';

interface Props {
  view: RoomView;
  isHost: boolean;
  act: Act;
}

const EXTEND_NOTICE_MS = 6000;
const ACTIVE = new Set(['proposed', 'sent']);

// ヘッダーのお題と同じ、ぼかしとスライドの切り替え
const PHASE_MOTION = {
  initial: { opacity: 0, y: 14, filter: 'blur(6px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -14, filter: 'blur(6px)' },
  transition: { duration: 0.25 },
};

export function Doors({ view, isHost, act }: Props) {
  const doors = view.doors!;
  const isGm = view.you === doors.gmId;
  const gmName = doors.isAiGm ? 'AI' : (view.players.find((p) => p.id === doors.gmId)?.name ?? '(退室)');
  const isRunning = view.phase !== 'doors-result';
  // 結果の演出は、その場で結果画面へ進んだときだけ出す。リロード・再接続・途中参加では出さない
  const [flow, setFlow] = useState({ phase: view.phase, isJustFinished: false });
  if (flow.phase !== view.phase) {
    setFlow({ phase: view.phase, isJustFinished: view.phase === 'doors-result' });
  }

  // 途中で止めるときは、答えとログを公開することを確かめてから
  const abort = () => {
    if (window.confirm('ラウンドを中止して、答えとログを全員に公開しますか?')) void act('lobby');
  };

  return (
    <div className="doors">
      <div className="doors-status">
        <span>
          GM: <strong>{gmName}</strong>
          {isGm && <span className="you-tag">あなた</span>}
        </span>
        {view.phase !== 'doors-setup' && <DoorRow doors={doors} isFinal={view.phase === 'doors-final'} />}
        {doors.maxLies > 0 && !isGm && isRunning && (
          <span className="lie-notice">
            {doors.isAiGm ? 'AI' : 'GM'}は最大{doors.maxLies}回嘘をつくことがあります
          </span>
        )}
      </div>
      <ExtendRequestNotice doors={doors} canSee={isHost || isGm} />
      {isRunning && doors.isAiGm && <AiStatus doors={doors} isHost={isHost} act={act} />}
      {isGm && isRunning && doors.answer && <SecretAnswer answer={doors.answer} />}
      {/* フェーズが切り替わっても、直前の回答を出し続けるため外に置く */}
      {isRunning && <LatestReply doors={doors} />}

      <AnimatePresence mode="wait" initial={false}>
        <m.div key={view.phase} {...PHASE_MOTION}>
          {view.phase === 'doors-setup' && <SetupPhase view={view} isGm={isGm} isHost={isHost} act={act} />}
          {(view.phase === 'doors-asking' || view.phase === 'doors-final') && (
            <PlayPhase view={view} doors={doors} isGm={isGm} isHost={isHost} act={act} />
          )}
          {view.phase === 'doors-result' && <DoorsResult view={view} doors={doors} isHost={isHost} act={act} isJustFinished={flow.isJustFinished} />}
        </m.div>
      </AnimatePresence>

      {isHost && isRunning && (
        <button className="small abort-button" onClick={abort}>
          中止して答えを公開 (ロビーへ)
        </button>
      )}
    </div>
  );
}

/** 「延長をお願い」をホストとGMの画面に出す。リロード直後は前の依頼を出さない */
function ExtendRequestNotice({ doors, canSee }: { doors: DoorsView; canSee: boolean }) {
  const lastSeen = useRef(doors.extendRequestSeq);
  const [shownSeq, setShownSeq] = useState(0);
  useEffect(() => {
    if (doors.extendRequestSeq <= lastSeen.current) return;
    lastSeen.current = doors.extendRequestSeq;
    if (!canSee) return;
    setShownSeq(doors.extendRequestSeq);
    playChime();
    const timer = window.setTimeout(() => setShownSeq(0), EXTEND_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [doors.extendRequestSeq, canSee]);
  return (
    <AnimatePresence>
      {shownSeq > 0 && (
        <m.div
          key={shownSeq}
          className="notice extend-notice"
          role="status"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0 }}
        >
          {doors.extendRequestBy} さんが延長をお願いしています
        </m.div>
      )}
    </AnimatePresence>
  );
}

/** AI GMの様子。考え中は揺れる扉を、失敗したら揺れで知らせてホストに再試行を促す */
function AiStatus({ doors, isHost, act }: { doors: DoorsView; isHost: boolean; act: Act }) {
  if (doors.aiError) {
    return (
      <div key={doors.aiErrorSeq} className="notice ai-error ng-shake" role="alert">
        <span>{doors.aiError}</span>
        {isHost ? (
          <button className="primary retry-button" onClick={() => act('doors:ai-retry')}>
            再試行
          </button>
        ) : (
          <span className="muted">ホストの再試行を待っています</span>
        )}
      </div>
    );
  }
  if (!doors.aiBusy || !doors.aiBusyId) return null;
  return <ThinkingBadge text="AIが回答を考え中" />;
}

/** 考え中を示す小さな揺れる扉 */
function ThinkingBadge({ text }: { text: string }) {
  return (
    <div className="ai-thinking busy-shimmer" role="status">
      <m.span
        className="waiting-door small-door"
        aria-hidden="true"
        animate={{ rotate: [-8, 8, -8] }}
        transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
      />
      <span>{text}</span>
    </div>
  );
}

function SetupPhase({ view, isGm, isHost, act }: { view: RoomView; isGm: boolean; isHost: boolean; act: Act }) {
  const [answer, setAnswer] = useState('');
  const doors = view.doors!;
  return (
    <section className="doors-panel">
      {doors.isAiGm ? (
        <div className="busy-shimmer ai-setup">
          <WaitingDoors text="AIが答えを考え中" />
        </div>
      ) : isGm ? (
        <>
          <h3>あなたがGMです</h3>
          <p>
            テーマ「{view.topic}」に沿った答えを1つ決めて確定してください。確定するまで質問は始まりません。
          </p>
          <form
            className="field-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (answer.trim()) void act('doors:answer', { answer });
            }}
          >
            <input
              placeholder={`答え (${LIMITS.doorsAnswer}文字まで)`}
              value={answer}
              maxLength={LIMITS.doorsAnswer}
              onChange={(e) => setAnswer(e.target.value)}
              autoFocus
            />
            <button className="primary" disabled={!answer.trim()}>
              確定
            </button>
          </form>
        </>
      ) : (
        <WaitingDoors text="GMが答えを考え中" />
      )}
      {isHost && (
        <p className="muted">{doors.isAiGm ? 'AI' : 'GM'}の答えを待つ間も、ホストは下のボタンでロビーへ戻せます。</p>
      )}
    </section>
  );
}

function PlayPhase({ view, doors, isGm, isHost, act }: { view: RoomView; doors: DoorsView; isGm: boolean; isHost: boolean; act: Act }) {
  const isFinal = view.phase === 'doors-final';
  const active = doors.proposals.filter((p) => ACTIVE.has(p.status));
  const finished = doors.proposals.filter((p) => !ACTIVE.has(p.status));
  const [isSoundOn, setSoundOn] = useSoundSetting();
  const canExtend = isHost || isGm;

  return (
    <div className="doors-play">

      {isFinal && (
        <p className="final-guide">
          質問回数を使い切りました。回答者は最終解答を1回だけ出せます (承認の流れは同じ)。
          {canExtend ? 'あなたは「延長 +1」で質問フェーズへ戻せます。' : 'ホストかGMは「延長 +1」で質問フェーズへ戻せます。'}
        </p>
      )}

      <div className="doors-columns">
        {isGm ? <GmQueue doors={doors} act={act} /> : <ProposalForm view={view} doors={doors} isFinal={isFinal} act={act} />}
        <ActiveList view={view} doors={doors} active={isGm ? active.filter((p) => p.status === 'proposed') : active} isGm={isGm} act={act} />
      </div>

      <div className="doors-controls">
        {canExtend && (
          <span className="extend-buttons">
            <span className="label">延長 (ホスト・GM)</span>
            <button className="small" onClick={() => act('doors:extend', { delta: -1 })}>
              -1
            </button>
            <button className={`small ${isFinal ? 'primary' : ''}`} onClick={() => act('doors:extend', { delta: 1 })}>
              延長 +1
            </button>
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

      <LogList finished={finished} showLie={isGm} />
    </div>
  );
}

/** 直前に届いたGMの回答を大きく出す。再接続直後は出さない */
function LatestReply({ doors }: { doors: DoorsView }) {
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
  const effect = latest.reply === 'close' ? 'warn-pulse' : latest.reply === 'wrong' ? 'ng-shake' : latest.reply === 'correct' ? 'ok-glow' : '';
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

function ProposalForm({ view, doors, isFinal, act }: { view: RoomView; doors: DoorsView; isFinal: boolean; act: Act }) {
  const [kind, setKind] = useState<ProposalKind>('question');
  const [text, setText] = useState('');
  const sendKind: ProposalKind = isFinal ? 'guess' : kind;
  const key = normalizeText(text);
  // 同じ内容がすでに出ていれば警告する (止めはしない)
  const duplicate = useMemo(
    () =>
      key
        ? doors.proposals.find((p) => p.status !== 'cancelled' && p.status !== 'rejected' && normalizeText(p.text) === key)
        : undefined,
    [doors.proposals, key],
  );
  const activeCount = doors.proposals.filter((p) => ACTIVE.has(p.status) && !p.isFinal).length;
  const mine = doors.proposals.filter((p) => p.authorId === view.you && p.status === 'proposed').length;
  const blocker = isFinal
    ? doors.proposals.some((p) => ACTIVE.has(p.status) && p.isFinal)
      ? '最終解答は1件ずつ出せます'
      : ''
    : activeCount >= doors.limit - doors.used
      ? '残り回数の分だけ提案が出ています'
      : mine >= LIMITS.doorsPendingPerPlayer
        ? `承認待ちは1人${LIMITS.doorsPendingPerPlayer}件までです`
        : '';

  const submit = async () => {
    if (!text.trim() || blocker) return;
    if (await act('doors:propose', { kind: sendKind, text })) setText('');
  };

  return (
    <section className="doors-panel proposal-form">
      <h3>{isFinal ? '最終解答を出す' : '質問・解答を提案'}</h3>
      {!isFinal && (
        <div className="kind-toggle" role="radiogroup" aria-label="提案の種類">
          {(['question', 'guess'] as const).map((k) => (
            <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'selected' : ''} onClick={() => setKind(k)}>
              {k === 'question' ? '質問' : '解答'}
            </button>
          ))}
        </div>
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
      <p className="muted hint-text">
        提案は、ほかの回答者が1人OKすると{doors.isAiGm ? 'AI' : 'GM'}へ届きます (OKできる人がいなければ自動で届きます)。質問で答えそのものを聞いても (例:「答えは犬ですか」) 質問として答えられ、勝ちにはなりません。当てるときは「解答」で出してください。
      </p>
    </section>
  );
}

/** 処理中の提案。承認待ちは枠が脈打ち、OKが付くとGMの列へ送られるように動き、取り消すと縮んで消える */
function ActiveList({ view, doors, active, isGm, act }: { view: RoomView; doors: DoorsView; active: ProposalView[]; isGm: boolean; act: Act }) {
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
            const canApprove = !isGm && p.status === 'proposed' && p.authorId !== view.you;
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
                    {p.approverName && ` (OK: ${p.approverName})`}
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
                    {p.status === 'proposed' && p.authorId === view.you && <span className="muted">ほかの回答者のOK待ち</span>}
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

function LogList({ finished, showLie }: { finished: ProposalView[]; showLie: boolean }) {
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
              <LogRow p={p} showLie={showLie} />
            </m.li>
          ))}
        </AnimatePresence>
      </ol>
    </section>
  );
}
