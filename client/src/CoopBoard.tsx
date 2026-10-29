import type { RoomView } from '../../shared/types';
import { Card } from './Card';
import type { Act } from './RoomScreen';

interface Props {
  view: RoomView;
  nameOf: (id: string) => string;
  act: Act;
  onHint: (cardId: string, hint: string) => void;
}

export function CoopBoard({ view, nameOf, act, onHint }: Props) {
  const byId = new Map(view.cards.map((c) => [c.id, c]));
  const fieldCards = view.field.map((id) => byId.get(id)!).filter(Boolean);
  const others = view.players.filter((p) => p.id !== view.you);
  const myHand = view.cards.filter((c) => c.ownerId === view.you && c.state === 'hand');
  const isPlaying = view.phase === 'playing';

  return (
    <div className="board">
      <section>
        <h3>
          場 <span className="muted">(ミス {view.misses})</span>
        </h3>
        <div className="field">
          {fieldCards.length === 0 && <p className="muted">まだ誰も出していません。小さいと思う人から「出す」</p>}
          {fieldCards.map((c) => (
            <Card key={c.id} card={c} ownerName={nameOf(c.ownerId)} isMine={c.ownerId === view.you} isMiss={c.state === 'discarded'} />
          ))}
        </div>
      </section>

      <section>
        <h3>みんなの手札</h3>
        <div className="hands">
          {others.map((p) => {
            const hand = view.cards.filter((c) => c.ownerId === p.id && c.state === 'hand');
            return (
              <div key={p.id} className="other-hand">
                <div className="other-name">
                  {p.name} <span className="muted">({hand.length}枚)</span>
                </div>
                <div className="hand">
                  {hand.map((c) => (
                    <Card key={c.id} card={c} ownerName={p.name} isMine={false} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h3>自分の手札</h3>
        <div className="hand">
          {myHand.length === 0 && <p className="muted">出し切りました</p>}
          {myHand.map((c) => (
            <Card key={c.id} card={c} ownerName="あなた" isMine canEdit={isPlaying} onHint={(h) => onHint(c.id, h)}>
              {isPlaying && (
                <button className="primary" onClick={() => act('play', { cardId: c.id })}>
                  出す
                </button>
              )}
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
