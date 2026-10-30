import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import type { RoomView } from '../../shared/types';
import { Lobby } from './Lobby';
import { Board, DEAL_INTERVAL_S } from './Board';

const COPIED_LABEL_MS = 2000;
// お知らせが消えるとき、余白ごと畳んで下の要素を詰める
const NOTICE_COLLAPSE = { opacity: 0, height: 0, marginTop: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 };

// navigator.clipboard は https か localhost でしか使えない。LANのIPをhttpで開いたときは execCommand に頼る
async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 権限で拒否されたときは下の方法を試す
    }
  }
  const previousFocus = document.activeElement;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  // iOS Safari は select() だけでは選択されない
  textarea.setSelectionRange(0, text.length);
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
  }
}

export type Act = (event: string, payload?: object) => Promise<void>;

interface Props {
  view: RoomView;
  act: Act;
  onLeave: () => Promise<void>;
}

export function RoomScreen({ view, act, onLeave }: Props) {
  const isHost = view.you === view.hostId;
  const nameOf = useCallback(
    (id: string) => view.players.find((p) => p.id === id)?.name ?? '?',
    [view.players],
  );
  const myCards = view.cards.filter((c) => c.ownerId === view.you).sort((a, b) => (a.value ?? 0) - (b.value ?? 0));
  const onHint = useCallback((cardId: string, hint: string) => act('hint', { cardId, hint }), [act]);
  const isPerfect = useMemo(() => {
    if (view.phase !== 'result') return false;
    const values = new Map(view.cards.map((c) => [c.id, c.value ?? 0]));
    return view.order.every((id, i) => i === 0 || values.get(id)! > values.get(view.order[i - 1]!)!);
  }, [view.phase, view.cards, view.order]);
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

      <section className="topic">
        <span className="label">お題</span>
        <AnimatePresence mode="wait" initial={false}>
          <m.span
            key={view.topic}
            className="topic-text"
            initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -14, filter: 'blur(6px)' }}
            transition={{ duration: 0.25 }}
          >
            {view.topic}
          </m.span>
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

      {view.phase !== 'lobby' && myCards.length > 0 && (
        <m.section
          className="my-numbers"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: flow.isDealing ? myCards.length * DEAL_INTERVAL_S + 0.2 : 0 }}
        >
          あなたの数字: {myCards.map((c) => <strong key={c.id}>{c.value}</strong>)}
        </m.section>
      )}

      {view.phase !== 'lobby' && myCards.length === 0 && (
        <div className="notice">観戦中です。次のラウンドから参加できます</div>
      )}

      {view.phase === 'lobby' ? (
        <m.div key="lobby" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
          <Lobby view={view} isHost={isHost} act={act} />
        </m.div>
      ) : (
        <m.div key="board" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
          <Board view={view} isHost={isHost} nameOf={nameOf} act={act} onHint={onHint} isDealing={flow.isDealing} />
        </m.div>
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
    </div>
  );
}
