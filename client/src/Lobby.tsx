import { useState } from 'react';
import { LIMITS, type RoomView } from '../../shared/types';
import type { Act } from './RoomScreen';

interface Props {
  view: RoomView;
  isHost: boolean;
  act: Act;
}

const SOURCE_LABEL = {
  random: '内蔵リスト',
  custom: '自由入力',
  ai: 'AI生成',
  'ai-fallback': '内蔵リスト (AI失敗)',
} as const;

export function Lobby({ view, isHost, act }: Props) {
  const [customTopic, setCustomTopic] = useState('');
  const [genre, setGenre] = useState('');
  const seated = view.players.filter((p) => p.connected).length;

  if (!isHost) {
    return (
      <section className="lobby">
        <p>
          1人 {view.cardsPerPlayer} 枚 / お題:{' '}
          {SOURCE_LABEL[view.topicSource]}
        </p>
        <p className="muted">ホストが開始するのを待っています ({seated}人参加中)</p>
      </section>
    );
  }

  return (
    <section className="lobby">
      <div className="field-row">
        <span className="label">1人あたりの枚数</span>
        <select
          value={view.cardsPerPlayer}
          onChange={(e) => act('settings', { cardsPerPlayer: Number(e.target.value) })}
        >
          {Array.from({ length: LIMITS.maxCardsPerPlayer }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      <div className="field-row">
        <span className="label">お題 ({SOURCE_LABEL[view.topicSource]})</span>
        <button onClick={() => act('topic:random')}>ランダム</button>
      </div>
      <div className="field-row">
        <input
          placeholder="お題を自由入力"
          value={customTopic}
          maxLength={LIMITS.topic}
          onChange={(e) => setCustomTopic(e.target.value)}
        />
        <button disabled={!customTopic.trim()} onClick={() => act('topic:set', { topic: customTopic })}>
          決定
        </button>
      </div>
      <div className="field-row">
        <input
          placeholder={`AI: ジャンル (${LIMITS.genre}文字まで、空でも可)`}
          value={genre}
          maxLength={LIMITS.genre}
          onChange={(e) => setGenre(e.target.value)}
        />
        <button disabled={view.aiBusy} onClick={() => act('topic:ai', { genre })}>
          {view.aiBusy ? '生成中...' : 'AIで生成'}
        </button>
      </div>

      <button className="primary big" disabled={seated < 2 || view.aiBusy} onClick={() => act('start')}>
        配って開始 ({seated}人)
      </button>
      {seated < 2 && <p className="muted">2人以上集まると開始できます</p>}
    </section>
  );
}
