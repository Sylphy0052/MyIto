import { useState } from 'react';
import { LIMITS } from '../../shared/types';
import { loadSession } from './socket';

interface Props {
  onEnter: (name: string, code: string | null) => Promise<void>;
}

export function Entry({ onEnter }: Props) {
  const [name, setName] = useState(() => loadSession()?.name ?? localStorage.getItem('ito:name') ?? '');
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '');
  const [busy, setBusy] = useState(false);

  const submit = async (joinCode: string | null) => {
    if (busy) return;
    setBusy(true);
    localStorage.setItem('ito:name', name.trim());
    await onEnter(name.trim(), joinCode);
    setBusy(false);
  };

  return (
    <div className="entry">
      <h1>ito online</h1>
      <label>
        ニックネーム
        <input value={name} maxLength={LIMITS.name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="entry-row">
        <input
          className="code-input"
          placeholder="ルームコード"
          value={code}
          maxLength={4}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <button disabled={busy || !name.trim() || code.length !== 4} onClick={() => submit(code)}>
          入室
        </button>
      </div>
      <div className="entry-or">または</div>
      <button className="primary" disabled={busy || !name.trim()} onClick={() => submit(null)}>
        ルームを作る
      </button>
    </div>
  );
}
