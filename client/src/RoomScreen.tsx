import { useCallback, useEffect, useMemo, useState } from 'react';
import { m } from 'motion/react';
import type { RoomView } from '../../shared/types';
import { Lobby } from './Lobby';
import { Board, DEAL_INTERVAL_S } from './Board';

const COPIED_LABEL_MS = 2000;

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
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

export type Act =(event: string, payload?: object) => Promise<void>;

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
  const [isCopied, setIsCopied] = useState(false);
  const copyInvite = async () => {
    const isOk = await copyText(inviteUrl);
    if (!isOk) {
      // どの方法でもコピーできないときは、手で選んでコピーできるように出す
      window.prompt('招待URL', inviteUrl);
      return;
    }
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), COPIED_LABEL_MS);
  };

  return (
    <div className="room">
      <header className="room-header">
        <div>
          ルーム <strong className="code">{view.code}</strong>
          <button className="small" onClick={() => void copyInvite()}>
            {isCopied ? 'コピーしました' : '招待URLをコピー'}
          </button>
        </div>
        <div className="players">
          {view.players.map((p) => (
            <span key={p.id} className={`player ${p.connected ? '' : 'away'} ${p.id === view.you ? 'me' : ''}`}>
              {p.id === view.hostId && '★'}
              {p.name}
            </span>
          ))}
        </div>
        <button className="small" onClick={() => void onLeave()}>
          退室
        </button>
      </header>

      <section className="topic">
        <span className="label">お題</span>
        <span className="topic-text">{view.topic}</span>
      </section>

      {view.notice && <div className="notice">{view.notice}</div>}

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
          <h2>{isPerfect ? '全部正しい順番でした!' : '答え合わせ完了'}</h2>
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
