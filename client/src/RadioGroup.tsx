import { useRef, type KeyboardEvent } from 'react';

interface Props<T extends string> {
  label: string;
  className: string;
  options: readonly T[];
  value: T;
  getLabel: (v: T) => string;
  onChange: (v: T) => void;
  disabled?: boolean;
}

const PREV_KEYS = ['ArrowLeft', 'ArrowUp'];
const NEXT_KEYS = ['ArrowRight', 'ArrowDown'];

/** 択一のボタン群。矢印キーで前後に移って選択し (端は反対側へ回る)、Tabで止まるのは選択中の1つだけ */
export function RadioGroup<T extends string>({ label, className, options, value, getLabel, onChange, disabled }: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = PREV_KEYS.includes(e.key) ? -1 : NEXT_KEYS.includes(e.key) ? 1 : 0;
    if (dir === 0 || disabled) return;
    e.preventDefault();
    const next = (options.indexOf(value) + dir + options.length) % options.length;
    const nextValue = options[next];
    if (nextValue === undefined) return;
    onChange(nextValue);
    refs.current[next]?.focus();
  };

  return (
    <div className={className} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((o, i) => (
        <button
          key={o}
          ref={(el) => {
            refs.current[i] = el;
          }}
          role="radio"
          aria-checked={value === o}
          tabIndex={value === o ? 0 : -1}
          className={value === o ? 'selected' : ''}
          disabled={disabled}
          onClick={() => onChange(o)}
        >
          {getLabel(o)}
        </button>
      ))}
    </div>
  );
}
