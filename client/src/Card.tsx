import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LIMITS, type CardView } from '../../shared/types';

interface Props {
  card: CardView;
  ownerName: string;
  isMine: boolean;
  /** 自分のカードで例えを書き換えられるとき */
  canEdit?: boolean;
  onHint?: (hint: string) => void;
  /** めくり結果。true=正しい並び */
  verdict?: boolean;
  children?: ReactNode;
}

export function Card({ card, ownerName, isMine, canEdit, onHint, verdict, children }: Props) {
  const [draft, setDraft] = useState(card.hint);
  const onHintRef = useRef(onHint);
  onHintRef.current = onHint;

  useEffect(() => {
    if (!canEdit) setDraft(card.hint);
  }, [card.hint, canEdit]);

  // 入力が止まってから送る
  useEffect(() => {
    if (!canEdit || draft === card.hint) return;
    const t = window.setTimeout(() => onHintRef.current?.(draft), 400);
    return () => window.clearTimeout(t);
  }, [draft, canEdit, card.hint]);

  const isOpen = card.value !== null;
  const classes = ['card', isMine ? 'mine' : '', isOpen ? 'open' : 'closed'];
  if (verdict !== undefined) classes.push(verdict ? 'ok' : 'ng');

  return (
    <div className={classes.join(' ')}>
      <div className="card-inner">
        <div className="card-owner">{ownerName}</div>
        <div className="card-value">{card.value ?? '?'}</div>
        {canEdit ? (
          <textarea
            className="card-hint"
            placeholder="例えを書く"
            value={draft}
            maxLength={LIMITS.hint}
            onChange={(e) => setDraft(e.target.value)}
          />
        ) : (
          <div className="card-hint">{card.hint || <span className="muted">(例えなし)</span>}</div>
        )}
        {verdict !== undefined && <div className="card-verdict">{verdict ? 'OK' : 'NG'}</div>}
        {children}
      </div>
    </div>
  );
}
