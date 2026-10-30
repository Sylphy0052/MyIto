import { useCallback } from 'react';
import type { RoomView } from '../../shared/types';
import { Lobby } from './Lobby';
import { Board } from './Board';

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
  const myCards = view.cards.filter((c) => c.ownerId === view.you);
  const onHint = useCallback((cardId: string, hint: string) => act('hint', { cardId, hint }), [act]);
  const isPerfect = view.order.every((id, i) => {
    if (i === 0) return true;
    const value = (cid: string) => view.cards.find((c) => c.id === cid)?.value ?? 0;
    return value(id) > value(view.order[i - 1]!);
  });
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
        <section className="my-numbers">
          あなたの数字: {myCards.map((c) => <strong key={c.id}>{c.value}</strong>)}
        </section>
      )}

      {view.phase !== 'lobby' && myCards.length === 0 && (
        <div className="notice">観戦中です。次のラウンドから参加できます</div>
      )}

      {view.phase === 'lobby' && <Lobby view={view} isHost={isHost} act={act} />}
      {view.phase !== 'lobby' && <Board view={view} isHost={isHost} nameOf={nameOf} act={act} onHint={onHint} />}

      {view.phase === 'result' && (
        <section className="result">
          <h2>{isPerfect ? '全部正しい順番でした!' : '答え合わせ完了'}</h2>
          {isHost ? (
            <button className="primary" onClick={() => act('lobby')}>
              次のラウンドへ (ロビーに戻る)
            </button>
          ) : (
            <p className="muted">ホストが次のラウンドを始めるのを待っています</p>
          )}
        </section>
      )}
    </div>
  );
}
