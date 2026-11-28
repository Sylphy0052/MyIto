import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import type { DoorsView, RoomView } from '../../shared/types';
import type { Act } from './RoomScreen';
import { DoorRow } from './DoorsParts';
import { SetupPhase } from './DoorsSetup';
import { LatestReply, PlayPhase } from './DoorsPlay';
import { SecretAnswer } from './DoorsGm';
import { DoorsResult } from './DoorsResult';
import { GmPortrait } from './GmPortrait';
import { TimeLeft, TimeUpNotice, TurnLeft, TurnTimeoutNotice } from './DoorsTime';
import { playChime } from './sound';

interface Props {
  view: RoomView;
  isHost: boolean;
  act: Act;
}

const EXTEND_NOTICE_MS = 6000;

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
      <GmPortrait doors={doors} />
      <div className="doors-status">
        <span>
          GM: <strong>{gmName}</strong>
          {isGm && <span className="you-tag">あなた</span>}
        </span>
        {view.phase !== 'doors-setup' && <DoorRow doors={doors} isFinal={view.phase === 'doors-final'} />}
        {isRunning && <TimeLeft doors={doors} />}
        {isRunning && <TurnLeft doors={doors} />}
        {doors.maxLies > 0 && !isGm && isRunning && (
          <span className="lie-notice">
            {doors.isAiGm ? 'AI' : 'GM'}は最大{doors.maxLies}回嘘をつくことがあります
          </span>
        )}
      </div>
      <ExtendRequestNotice doors={doors} canSee={isHost || isGm} />
      {isRunning && <CorrectNotice doors={doors} canSee={!isGm} />}
      {isRunning && <TimeUpNotice doors={doors} />}
      {isRunning && <TurnTimeoutNotice doors={doors} />}
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

/** GMが判定を訂正したことをGM以外に知らせる。リロード直後は前の訂正を出さない */
function CorrectNotice({ doors, canSee }: { doors: DoorsView; canSee: boolean }) {
  const lastSeen = useRef(doors.correctSeq);
  const [shown, setShown] = useState({ seq: 0, no: 0 });
  useEffect(() => {
    if (doors.correctSeq <= lastSeen.current) return;
    lastSeen.current = doors.correctSeq;
    if (!canSee) return;
    setShown({ seq: doors.correctSeq, no: doors.correctSeqBy });
    playChime();
    const timer = window.setTimeout(() => setShown({ seq: 0, no: 0 }), EXTEND_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [doors.correctSeq, doors.correctSeqBy, canSee]);
  return (
    <AnimatePresence>
      {shown.seq > 0 && (
        <m.div
          key={shown.seq}
          className="notice extend-notice"
          role="status"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0 }}
        >
          GMが{shown.no}番の判定を訂正しました
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
