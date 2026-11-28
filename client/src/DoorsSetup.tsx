import { useState } from 'react';
import { LIMITS, type RoomView } from '../../shared/types';
import type { Act } from './RoomScreen';
import { WaitingDoors } from './DoorsParts';

export function SetupPhase({ view, isGm, isHost, act }: { view: RoomView; isGm: boolean; isHost: boolean; act: Act }) {
  const [answer, setAnswer] = useState('');
  const doors = view.doors!;
  return (
    <section className="doors-panel">
      {doors.isAiGm ? (
        <div className="busy-shimmer ai-setup">
          <WaitingDoors text="AIが答えを考え中" />
        </div>
      ) : isGm ? (
        <>
          <h3>あなたがGMです</h3>
          <p>
            テーマ「{view.topic}」に沿った答えを1つ決めて確定してください。確定するまで質問は始まりません。
          </p>
          <form
            className="field-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (answer.trim()) void act('doors:answer', { answer });
            }}
          >
            <input
              placeholder={`答え (${LIMITS.doorsAnswer}文字まで)`}
              value={answer}
              maxLength={LIMITS.doorsAnswer}
              onChange={(e) => setAnswer(e.target.value)}
              autoFocus
            />
            <button className="primary" disabled={!answer.trim()}>
              確定
            </button>
          </form>
        </>
      ) : (
        <WaitingDoors text="GMが答えを考え中" />
      )}
      {isHost && (
        <p className="muted">{doors.isAiGm ? 'AI' : 'GM'}の答えを待つ間も、ホストは下のボタンでロビーへ戻せます。</p>
      )}
    </section>
  );
}
