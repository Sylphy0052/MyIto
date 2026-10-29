import { useState } from 'react';
import type { CardView, RoomView } from '../../shared/types';
import { Card } from './Card';
import type { Act } from './RoomScreen';

interface Props {
  view: RoomView;
  isHost: boolean;
  nameOf: (id: string) => string;
  act: Act;
}

/** めくった位置 i の正誤。左隣より大きければ正しい */
function verdictAt(row: CardView[], i: number): boolean {
  if (i === 0) return true;
  return (row[i]!.value ?? 0) > (row[i - 1]!.value ?? 0);
}

export function FreeBoard({ view, isHost, nameOf, act }: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const byId = new Map(view.cards.map((c) => [c.id, c]));
  const row = view.order.map((id) => byId.get(id)!).filter(Boolean);
  const canMove = view.phase === 'playing';
  const revealedCount = view.phase === 'result' ? row.length : view.revealed;

  const moveTo = (cardId: string, toIndex: number) => {
    if (toIndex < 0 || toIndex >= row.length) return;
    void act('move', { cardId, toIndex });
  };

  return (
    <div className="board">
      <section>
        <h3>
          列 <span className="muted">(左が小さい / ドラッグか矢印で並べ替え)</span>
        </h3>
        <div className="row-labels">
          <span>小 1</span>
          <span>100 大</span>
        </div>
        <div className="free-row">
          {row.map((c, i) => {
            const isRevealed = i < revealedCount;
            return (
              <div
                key={c.id}
                className={`slot ${dragId === c.id ? 'dragging' : ''}`}
                draggable={canMove}
                onDragStart={(e) => {
                  setDragId(c.id);
                  e.dataTransfer.setData('text/plain', c.id);
                }}
                onDragEnd={() => setDragId(null)}
                onDragOver={(e) => canMove && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData('text/plain');
                  if (id && id !== c.id) moveTo(id, i);
                  setDragId(null);
                }}
              >
                <div key={isRevealed ? 'open' : 'closed'} className={isRevealed ? 'flip' : ''}>
                  <Card
                    card={c}
                    ownerName={nameOf(c.ownerId)}
                    isMine={c.ownerId === view.you}
                    verdict={isRevealed ? verdictAt(row, i) : undefined}
                  />
                </div>
                {canMove && (
                  <div className="slot-arrows">
                    <button className="small" disabled={i === 0} onClick={() => moveTo(c.id, i - 1)}>
                      ◀
                    </button>
                    <button className="small" disabled={i === row.length - 1} onClick={() => moveTo(c.id, i + 1)}>
                      ▶
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {view.phase === 'playing' &&
        (isHost ? (
          <button className="primary big" onClick={() => act('open')}>
            オープン (小さい側から順にめくる)
          </button>
        ) : (
          <p className="muted">並べ終わったらホストが「オープン」します</p>
        ))}
      {view.phase === 'revealing' && <p className="notice">めくっています... ({view.revealed} / {row.length})</p>}
    </div>
  );
}
