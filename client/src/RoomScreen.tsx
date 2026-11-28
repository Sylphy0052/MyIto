import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, Suspense, type KeyboardEvent } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { isDoorsPhase, type RoomView } from '../../shared/types';
import { Lobby } from './Lobby';
import { DEAL_INTERVAL_S } from './dealTiming';
import { ChunkErrorBoundary, GameLoading, lazyGame } from './lazyGame';
import { copyText } from './copyText';
import { isPerfectOrder } from './bgm';

const Board = lazyGame(() => import('./Board').then((m) => ({ default: m.Board })));
const Doors = lazyGame(() => import('./Doors').then((m) => ({ default: m.Doors })));

const COPIED_LABEL_MS = 2000;
// お知らせが消えるとき、余白ごと畳んで下の要素を詰める
const NOTICE_COLLAPSE = { opacity: 0, height: 0, marginTop: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 };

export type Act = (event: string, payload?: object) => Promise<boolean>;

interface Props {
  view: RoomView;
  act: Act;
  onLeave: () => Promise<void>;
  connected: boolean;
}

// ロビー以外ではお題を3行に省略する (行数はstyles.cssの`.topic-text.clamped`と揃える)。
// 省略が起きているときだけ、タップで全文と3行を切り替える
function TopicText({ topic, isLobby }: { topic: string; isLobby: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);
  // ロビーへ戻ったときだけ3行へ戻す。ゲーム中の段階の移り変わりでは保つ。
  // 同じお題のまま次のゲームへ進むと要素が作り直されないので、描画中に戻す (上のflowと同じ書き方)
  if (isLobby && isExpanded) setIsExpanded(false);
  // 省略の有無は3行の状態でだけ測る。全文表示中は高さが等しくなるので、直前の判定を保つ
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || isLobby || isExpanded) return;
    const measure = () => setIsClamped(el.scrollHeight > el.clientHeight);
    measure();
    // ResizeObserverが無い環境では、幅の変化を拾えないだけで済ませる
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [topic, isLobby, isExpanded]);
  const isInteractive = !isLobby && (isClamped || isExpanded);
  const toggle = () => setIsExpanded((prev) => !prev);
  return (
    <m.span
      ref={ref}
      className={`topic-text${isLobby || isExpanded ? '' : ' clamped'}${isInteractive ? ' tappable' : ''}`}
      {...(isInteractive
        ? {
            role: 'button',
            tabIndex: 0,
            'aria-expanded': isExpanded,
            onClick: toggle,
            onKeyDown: (e: KeyboardEvent<HTMLSpanElement>) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              toggle();
            },
          }
        : {})}
      initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, y: -14, filter: 'blur(6px)' }}
      transition={{ duration: 0.25 }}
    >
      {topic}
    </m.span>
  );
}

export function RoomScreen({ view, act, onLeave, connected }: Props) {
  const isHost = view.you === view.hostId;
  const isDoorsRound = isDoorsPhase(view.phase);
  const nameOf = useCallback(
    (id: string) => view.players.find((p) => p.id === id)?.name ?? '?',
    [view.players],
  );
  const myCards = view.cards.filter((c) => c.ownerId === view.you).sort((a, b) => (a.value ?? 0) - (b.value ?? 0));
  const canRecover = view.phase === 'playing' && isHost && !view.cards.some((card) =>
    view.players.some((player) => player.id === card.ownerId && player.connected),
  );
  const onHint = useCallback((cardId: string, hint: string) => act('hint', { cardId, hint }), [act]);
  const isPerfect = useMemo(() => {
    return view.phase === 'result' && isPerfectOrder(view);
  }, [view]);
  // 配りと紙吹雪は、その場で段階が進んだときだけ演出する。リロード・再接続・途中参加では出さない
  const [flow, setFlow] = useState({ phase: view.phase, isDealing: false, isJustFinished: false });
  if (flow.phase !== view.phase) {
    setFlow({
      phase: view.phase,
      isDealing: flow.phase === 'lobby' && view.phase === 'playing',
      // playing → revealing → result と進むので、直前の phase は問わない
      isJustFinished: view.phase === 'result',
    });
  }
  // 全部正しい順番のときだけ紙吹雪を出す。読み込みは必要になってから
  useEffect(() => {
    if (!isPerfect || !flow.isJustFinished) return;
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
        // 紙吹雪は飾り。読み込みに失敗しても、ゲームの進行は止めない
      });
    return () => {
      isCancelled = true;
      reset?.();
    };
  }, [isPerfect, flow.isJustFinished]);
  const inviteUrl = `${location.origin}/?room=${view.code}`;
  // 最後にコピーできた時刻。0 なら表示を戻す。連打したときは最後に押してから数える
  const [copiedAt, setCopiedAt] = useState(0);
  useEffect(() => {
    if (copiedAt === 0) return;
    const timer = setTimeout(() => setCopiedAt(0), COPIED_LABEL_MS);
    return () => clearTimeout(timer);
  }, [copiedAt]);
  const isCopied = copiedAt !== 0;
  const copyInvite = async () => {
    const isOk = await copyText(inviteUrl);
    if (!isOk) {
      // どの方法でもコピーできないときは、手で選んでコピーできるように出す
      window.prompt('招待URL', inviteUrl);
      return;
    }
    setCopiedAt(Date.now());
  };

  return (
    <div className="room">
      <m.header
        className="room-header"
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      >
        <div>
          ルーム{' '}
          <strong className="code">
            {/* ルームコードは入室中に変わらないので、位置をkeyにしてよい */}
            {[...view.code].map((ch, i) => (
              <m.span
                key={i}
                className="code-char"
                initial={{ opacity: 0, rotateX: -90 }}
                animate={{ opacity: 1, rotateX: 0 }}
                transition={{ delay: 0.15 + i * 0.07, type: 'spring', stiffness: 300, damping: 18 }}
              >
                {ch}
              </m.span>
            ))}
          </strong>
          <button className={`small copy-button ${isCopied ? 'copied' : ''}`} onClick={() => void copyInvite()}>
            <AnimatePresence mode="wait" initial={false}>
              <m.span
                key={isCopied ? 'done' : 'idle'}
                className="copy-label"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
              >
                {isCopied ? 'コピーしました' : '招待URLをコピー'}
              </m.span>
            </AnimatePresence>
          </button>
        </div>
        <div className="players">
          <AnimatePresence initial={false}>
            {view.players.map((p) => (
              <m.span
                key={p.id}
                layout
                className={`player ${p.connected ? '' : 'away'} ${p.id === view.you ? 'me' : ''}`}
                initial={{ opacity: 0, scale: 0.4 }}
                animate={{ opacity: p.connected ? 1 : 0.6, scale: 1 }}
                exit={{ opacity: 0, scale: 0.4 }}
                transition={{ type: 'spring', stiffness: 420, damping: 22 }}
              >
                {p.id === view.hostId && <span className="host-star">★</span>}
                {p.name}
              </m.span>
            ))}
          </AnimatePresence>
        </div>
        <button className="small" onClick={() => void onLeave()}>
          退室
        </button>
      </m.header>
      <fieldset className="room-controls" disabled={!connected}>
        <section className="topic">
          <span className="label">{view.mode === 'doors' ? 'テーマ' : 'お題'}</span>
          <AnimatePresence mode="wait" initial={false}>
            <TopicText key={view.topic} topic={view.topic} isLobby={view.phase === 'lobby'} />
          </AnimatePresence>
        </section>

        <AnimatePresence>
          {view.notice && (
            <m.div
              key={view.notice}
              className="notice"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={NOTICE_COLLAPSE}
            >
              {view.notice}
            </m.div>
          )}
        </AnimatePresence>

        {view.phase !== 'lobby' && !isDoorsRound && myCards.length > 0 && (
          <m.section
            className="my-numbers"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: flow.isDealing ? myCards.length * DEAL_INTERVAL_S + 0.2 : 0 }}
          >
            あなたの数字: {myCards.map((c) => <strong key={c.id}>{c.value}</strong>)}
          </m.section>
        )}

        {view.phase !== 'lobby' && !isDoorsRound && myCards.length === 0 && (
          <div className="notice">観戦中です。次のラウンドから参加できます</div>
        )}

        {view.phase === 'lobby' ? (
          <m.div key="lobby" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
            <Lobby view={view} isHost={isHost} act={act} />
          </m.div>
        ) : isDoorsRound && view.doors ? (
          <m.div key="doors" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
            <ChunkErrorBoundary><Suspense fallback={<GameLoading />}><Doors view={view} isHost={isHost} act={act} /></Suspense></ChunkErrorBoundary>
          </m.div>
        ) : (
          <m.div key="board" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
            <ChunkErrorBoundary><Suspense fallback={<GameLoading />}><Board view={view} isHost={isHost} nameOf={nameOf} act={act} onHint={onHint} isDealing={flow.isDealing} /></Suspense></ChunkErrorBoundary>
          </m.div>
        )}

        {canRecover && (
          <button className="small" onClick={() => act('lobby')}>
            参加者が不在のためロビーに戻る
          </button>
        )}

        {view.phase === 'result' && (
          <m.section
            className="result"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
          >
            <m.h2
              className={isPerfect ? 'perfect' : undefined}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.15, type: 'spring', stiffness: 320, damping: 12 }}
            >
              {isPerfect ? '全部正しい順番でした!' : '答え合わせ完了'}
            </m.h2>
            {isHost ? (
              <button className="primary" onClick={() => act('lobby')}>
                次のラウンドへ (ロビーに戻る)
              </button>
            ) : (
              <p className="muted">ホストが次のラウンドを始めるのを待っています</p>
            )}
          </m.section>
        )}
      </fieldset>
    </div>
  );
}
