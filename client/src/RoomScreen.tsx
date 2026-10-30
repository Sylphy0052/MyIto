import { useCallback, useEffect, useMemo } from 'react';
import { m } from 'motion/react';
import type { RoomView } from '../../shared/types';
import { Lobby } from './Lobby';
import { Board, DEAL_INTERVAL_S } from './Board';

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
  // 全部正しい順番のときだけ紙吹雪を出す。読み込みは必要になってから
  useEffect(() => {
    if (!isPerfect) return;
    let isCancelled = false;
    void import('canvas-confetti').then(({ default: confetti }) => {
      if (isCancelled) return;
      const burst = (originX: number, angle: number) =>
        confetti({ particleCount: 90, spread: 70, angle, origin: { x: originX, y: 0.7 }, disableForReducedMotion: true });
      burst(0.1, 60);
      burst(0.9, 120);
    });
    return () => {
      isCancelled = true;
    };
  }, [isPerfect]);
  const inviteUrl = `${location.origin}/?room=${view.code}`;

  return (
    <div className="room">
      <header className="room-header">
        <div>
          ルーム <strong className="code">{view.code}</strong>
          <button className="small" onClick={() => navigator.clipboard?.writeText(inviteUrl)}>
            招待URLをコピー
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
          key={view.phase === 'playing' ? 'dealt' : 'shown'}
          className="my-numbers"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: view.phase === 'playing' ? myCards.length * DEAL_INTERVAL_S + 0.2 : 0 }}
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
          <Board view={view} isHost={isHost} nameOf={nameOf} act={act} onHint={onHint} />
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
