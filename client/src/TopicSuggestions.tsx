import { useState } from 'react';
import { LIMITS, type RoomView } from '../../shared/types';
import type { Act } from './RoomScreen';

interface Props {
  view: RoomView;
  isHost: boolean;
  act: Act;
  /** 「お題に使う」: 案をお題の入力欄へコピーする (ホストだけ) */
  onUse?: (text: string) => void;
  /** 「AIに頼む」: 案をジャンル欄へコピーする (ホストだけ) */
  onAsk?: (text: string) => void;
}

/** ホスト以外の案の送信欄 */
export function SuggestForm({ view, act }: Pick<Props, 'view' | 'act'>) {
  const [text, setText] = useState('');
  const label = view.mode === 'doors' ? 'テーマ' : 'お題';
  const mine = view.topicSuggestions.filter((s) => s.authorId === view.you).length;
  const left = Math.max(0, LIMITS.topicSuggestionsPerPlayer - mine);
  const submit = async () => {
    if (!text.trim()) return;
    if (await act('topic:suggest', { topic: text })) setText('');
  };
  return (
    <div className="suggest-form">
      <p className="muted">{label}の案を送る (あと{left}件送れます)</p>
      <div className="field-row">
        <input
          placeholder={`${label}の案`}
          value={text}
          maxLength={LIMITS.topic}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit();
          }}
        />
        <button disabled={!text.trim() || left === 0} onClick={() => void submit()}>
          送る
        </button>
      </div>
    </div>
  );
}

/** 全員に見える案の一覧。0件なら何も出さない */
export function TopicSuggestions({ view, isHost, act, onUse, onAsk }: Props) {
  if (view.topicSuggestions.length === 0) return null;
  const nameOf = (id: string) => view.players.find((p) => p.id === id)?.name ?? '?';
  return (
    <div className="topic-suggestions">
      <p className="muted">{view.mode === 'doors' ? 'テーマ' : 'お題'}の案</p>
      <ul>
        {view.topicSuggestions.map((s) => (
          <li key={s.id}>
            <span className="suggestion-text">{s.text}</span>
            <span className="suggestion-author muted">{nameOf(s.authorId)}</span>
            <span className="suggestion-actions">
              {isHost && (
                <>
                  <button onClick={() => onUse?.(s.text)}>お題に使う</button>
                  <button onClick={() => onAsk?.(s.text)}>AIに頼む</button>
                  <button onClick={() => void act('topic:dismiss', { id: s.id })}>却下</button>
                </>
              )}
              {s.authorId === view.you && (
                <button onClick={() => void act('topic:suggest-withdraw', { id: s.id })}>取り下げ</button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
