import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { m } from 'motion/react';
import { isReadyToOpen, type CardView, type RoomView } from '../../shared/types';
import { Card } from './Card';
import type { Act } from './RoomScreen';

interface Props {
  view: RoomView;
  isHost: boolean;
  nameOf: (id: string) => string;
  act: Act;
  onHint: (cardId: string, hint: string) => void;
}

interface Drag {
  pointerId: number;
  cardId: string;
  from: 'hand' | 'row';
  /** ポインタ位置とカード左上の差 */
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  /** 一定距離動かしてからドラッグ扱いにする (クリックと区別する) */
  isMoving: boolean;
  /** ドラッグ中のカードを除いた列での挿入位置。列の外なら null */
  insertAt: number | null;
  isOverHand: boolean;
}

const DRAG_THRESHOLD_PX = 6;
const ROW_MARGIN_PX = 40;
/** 配るときの1枚あたりの間隔 (秒) */
export const DEAL_INTERVAL_S = 0.08;
const LAYOUT_TRANSITION = { type: 'spring', stiffness: 500, damping: 40 } as const;

/** めくった位置 i の正誤。左隣より大きければ正しい */
function verdictAt(row: CardView[], i: number): boolean {
  if (i === 0) return true;
  return (row[i]!.value ?? 0) > (row[i - 1]!.value ?? 0);
}

function contains(rect: DOMRect, x: number, y: number, margin = 0): boolean {
  return x >= rect.left - margin && x <= rect.right + margin && y >= rect.top - margin && y <= rect.bottom + margin;
}

/** 列の中で (x, y) に落としたときの挿入位置 (ドラッグ中のカードを除いた並びでの添字) */
function findInsertIndex(rowEl: HTMLElement, cardId: string, x: number, y: number): number | null {
  if (!contains(rowEl.getBoundingClientRect(), x, y, ROW_MARGIN_PX)) return null;
  const slots = Array.from(rowEl.querySelectorAll<HTMLElement>('[data-slot]')).filter(
    (el) => el.dataset.slot !== cardId,
  );
  if (slots.length === 0) return 0;
  let best = 0;
  let bestDist = Infinity;
  slots.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    const dist = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  });
  const r = slots[best]!.getBoundingClientRect();
  return x < r.left + r.width / 2 ? best : best + 1;
}

export function Board({ view, isHost, nameOf, act, onHint }: Props) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const handRef = useRef<HTMLDivElement>(null);
  // 開始直後に表示されたときだけ、手札を1枚ずつ配る (途中参加や再接続では動かさない)
  const shouldDeal = useRef(view.phase === 'playing' && view.cards.every((c) => c.state === 'hand'));

  const byId = new Map(view.cards.map((c) => [c.id, c]));
  const row = view.order.map((id) => byId.get(id)!).filter(Boolean);
  const myCards = view.cards.filter((c) => c.ownerId === view.you).sort((a, b) => (a.value ?? 0) - (b.value ?? 0));
  const isPlaying = view.phase === 'playing';
  const revealedCount = view.phase === 'result' ? row.length : view.revealed;
  const placedCount = view.cards.filter((c) => c.state === 'placed').length;
  // 切断中の人の手札は待たないので、分母に入れない
  const connectedIds = new Set(view.players.filter((p) => p.connected).map((p) => p.id));
  const awaitedCount = view.cards.filter((c) => c.state === 'placed' || connectedIds.has(c.ownerId)).length;
  const isAllPlaced = isReadyToOpen(view.cards, view.players);

  const updateDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const startDrag = (e: ReactPointerEvent<HTMLElement>, cardId: string, from: Drag['from']) => {
    // 2本目の指 (isPrimary=false) では始めない。新しい主ポインタの押下は、取り残されたドラッグを置き換える
    if (!isPlaying || e.button !== 0 || !e.isPrimary) return;
    if ((e.target as HTMLElement).closest('textarea, button')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    updateDrag({
      pointerId: e.pointerId,
      cardId,
      from,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      isMoving: false,
      insertAt: null,
      isOverHand: false,
    });
  };

  // ドロップ時の判定で最新の view を使う
  const latest = useRef({ byId, you: view.you, act });
  latest.current = { byId, you: view.you, act };

  const isDragging = drag !== null;
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      // ウィンドウ外でボタンを離すと pointerup が来ないことがある
      if (e.pointerType === 'mouse' && e.buttons === 0) return updateDrag(null);
      const isMoving = d.isMoving || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > DRAG_THRESHOLD_PX;
      if (!isMoving) return;
      e.preventDefault();
      updateDrag({
        ...d,
        x: e.clientX,
        y: e.clientY,
        isMoving,
        insertAt: rowRef.current ? findInsertIndex(rowRef.current, d.cardId, e.clientX, e.clientY) : null,
        isOverHand: !!handRef.current && contains(handRef.current.getBoundingClientRect(), e.clientX, e.clientY),
      });
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      updateDrag(null);
      if (!d.isMoving) return;
      const { byId: cards, you, act: send } = latest.current;
      if (d.insertAt !== null) {
        void send(d.from === 'hand' ? 'place' : 'move', { cardId: d.cardId, toIndex: d.insertAt });
      } else if (d.from === 'row' && d.isOverHand && cards.get(d.cardId)?.ownerId === you) {
        void send('unplace', { cardId: d.cardId });
      }
    };
    const onCancel = (e: PointerEvent) => {
      if (e.pointerId === dragRef.current?.pointerId) updateDrag(null);
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [isDragging]);

  // めくり始めたら、途中のドラッグは捨てる
  useEffect(() => {
    if (!isPlaying) updateDrag(null);
  }, [isPlaying]);

  const movingId = drag?.isMoving ? drag.cardId : null;
  const moveBy = (cardId: string, toIndex: number) => {
    if (toIndex >= 0 && toIndex < row.length) void act('move', { cardId, toIndex });
  };

  const rowItems = row
    .filter((c) => c.id !== movingId)
    .map((c) => {
      const i = row.indexOf(c);
      const isRevealed = i < revealedCount;
      return (
        <m.div
          key={c.id}
          layout="position"
          transition={LAYOUT_TRANSITION}
          initial={{ opacity: 0, scale: 1.12 }}
          animate={{ opacity: 1, scale: 1 }}
          data-slot={c.id}
          className={`slot ${isPlaying ? 'draggable' : ''}`}
          onPointerDown={(e) => startDrag(e, c.id, 'row')}
        >
          <div key={isRevealed ? 'open' : 'closed'} className={isRevealed ? 'flip' : ''}>
            <Card
              card={c}
              ownerName={nameOf(c.ownerId)}
              isMine={c.ownerId === view.you}
              verdict={isRevealed ? verdictAt(row, i) : undefined}
            />
          </div>
          {isPlaying && (
            <div className="slot-arrows">
              <button className="small" disabled={i === 0} onClick={() => moveBy(c.id, i - 1)}>
                ◀
              </button>
              <button className="small" disabled={i === row.length - 1} onClick={() => moveBy(c.id, i + 1)}>
                ▶
              </button>
            </div>
          )}
        </m.div>
      );
    });
  if (drag?.isMoving && drag.insertAt !== null) {
    rowItems.splice(drag.insertAt, 0, <div key="drop-marker" className="drop-marker" />);
  }

  const draggedCard = movingId ? byId.get(movingId) : undefined;
  const isUnplaceTarget = !!drag?.isMoving && drag.isOverHand && drag.from === 'row';

  return (
    <div className="board">
      <section>
        <h3>
          列 <span className="muted">(左が小さい / ドラッグで置く・動かす)</span>
        </h3>
        <div className="row-labels">
          <span>小 1</span>
          <span>100 大</span>
        </div>
        <div ref={rowRef} className={`free-row ${drag?.isMoving && drag.insertAt !== null ? 'drop-active' : ''}`}>
          {rowItems}
          {row.length === 0 && !drag?.isMoving && <p className="muted">ここに自分のカードをドラッグして置く</p>}
        </div>
      </section>

      {isPlaying &&
        (isHost ? (
          <button className="primary big" disabled={!isAllPlaced} onClick={() => act('open')}>
            {isAllPlaced ? 'オープン (小さい側から順にめくる)' : `全員が置くまで待つ (${placedCount} / ${awaitedCount})`}
          </button>
        ) : (
          <p className="muted">
            {isAllPlaced ? '全員置きました。ホストが「オープン」します' : `置いたカード ${placedCount} / ${awaitedCount}`}
          </p>
        ))}
      {view.phase === 'revealing' && (
        <p className="notice">
          めくっています... ({view.revealed} / {row.length})
        </p>
      )}

      {myCards.length > 0 && (
        <section>
          <h3>
            自分のカード <span className="muted">(例えはめくるまで書き換えられる)</span>
          </h3>
          <div ref={handRef} className={`hand ${isUnplaceTarget ? 'drop-active' : ''}`}>
            {myCards.map((c, i) => {
              const isInHand = c.state === 'hand';
              return (
                <m.div
                  key={c.id}
                  layout="position"
                  transition={LAYOUT_TRANSITION}
                  className={`slot ${isPlaying && isInHand ? 'draggable' : ''} ${c.id === movingId ? 'dragging' : ''}`}
                  onPointerDown={(e) => isInHand && startDrag(e, c.id, 'hand')}
                >
                  {/* 配る動き。layout や .dragging の opacity と干渉しないよう、内側で行う */}
                  <m.div
                    className="deal"
                    initial={shouldDeal.current ? { opacity: 0, y: -160, rotate: -12, scale: 0.7 } : false}
                    animate={{ opacity: 1, y: 0, rotate: 0, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 22, delay: i * DEAL_INTERVAL_S }}
                  >
                    <Card card={c} ownerName="あなた" isMine canEdit={isPlaying} onHint={(h) => onHint(c.id, h)} />
                  </m.div>
                  {isPlaying &&
                    (isInHand ? (
                      <button className="small" onClick={() => act('place', { cardId: c.id, toIndex: row.length })}>
                        列の右端に置く
                      </button>
                    ) : (
                      <button className="small" onClick={() => act('unplace', { cardId: c.id })}>
                        手札へ戻す
                      </button>
                    ))}
                </m.div>
              );
            })}
          </div>
        </section>
      )}

      {draggedCard && drag && (
        <div className="drag-ghost" style={{ left: drag.x - drag.offsetX, top: drag.y - drag.offsetY }}>
          <Card card={draggedCard} ownerName={nameOf(draggedCard.ownerId)} isMine={draggedCard.ownerId === view.you} />
        </div>
      )}
    </div>
  );
}
