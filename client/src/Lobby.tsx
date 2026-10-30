import { useState } from 'react';
import { AnimatePresence, m, type Variants } from 'motion/react';
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

const rows: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const row: Variants = {
  hidden: { opacity: 0, x: -16 },
  show: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 300, damping: 26 } },
};

/** 人数が変わるたびに跳ねる数字 */
function Count({ value }: { value: number }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <m.strong
        key={value}
        className="count"
        initial={{ opacity: 0, y: -12, scale: 1.4 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12 }}
        transition={{ type: 'spring', stiffness: 400, damping: 18 }}
      >
        {value}
      </m.strong>
    </AnimatePresence>
  );
}

export function Lobby({ view, isHost, act }: Props) {
  const [customTopic, setCustomTopic] = useState('');
  const [genre, setGenre] = useState('');
  const seated = view.players.filter((p) => p.connected).length;
  const canStart = seated >= 2 && !view.aiBusy;

  if (!isHost) {
    return (
      <m.section className="lobby lobby-waiting" variants={rows} initial="hidden" animate="show">
        <m.div className="waiting-cards" variants={row} aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <m.span
              key={i}
              className="waiting-card"
              animate={{ y: [0, -10, 0], rotate: [(i - 1) * 10, (i - 1) * 14, (i - 1) * 10] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut', delay: i * 0.18 }}
            />
          ))}
        </m.div>
        <m.p variants={row}>
          1人 {view.cardsPerPlayer} 枚 / お題: {SOURCE_LABEL[view.topicSource]}
        </m.p>
        <m.p className="muted" variants={row}>
          ホストが開始するのを待っています
          <span className="dots" aria-hidden="true">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>{' '}
          (<Count value={seated} />
          人参加中)
        </m.p>
      </m.section>
    );
  }

  return (
    <m.section className="lobby" variants={rows} initial="hidden" animate="show">
      <m.div className="field-row" variants={row}>
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
      </m.div>

      <m.div className="field-row" variants={row}>
        <span className="label">お題 ({SOURCE_LABEL[view.topicSource]})</span>
        <m.button
          disabled={view.aiBusy}
          whileTap={{ rotate: 360, scale: 0.9 }}
          transition={{ duration: 0.4 }}
          onClick={() => act('topic:random')}
        >
          ランダム
        </m.button>
      </m.div>
      <m.div className="field-row" variants={row}>
        <input
          placeholder="お題を自由入力"
          value={customTopic}
          maxLength={LIMITS.topic}
          onChange={(e) => setCustomTopic(e.target.value)}
        />
        <button disabled={!customTopic.trim() || view.aiBusy} onClick={() => act('topic:set', { topic: customTopic })}>
          決定
        </button>
      </m.div>
      <m.div className="field-row" variants={row}>
        <input
          placeholder={`AI: ジャンル (${LIMITS.genre}文字まで、空でも可)`}
          value={genre}
          maxLength={LIMITS.genre}
          onChange={(e) => setGenre(e.target.value)}
        />
        <button
          className={view.aiBusy ? 'ai-busy' : undefined}
          disabled={view.aiBusy}
          onClick={() => act('topic:ai', { genre })}
        >
          {view.aiBusy ? '生成中...' : `AIで${LIMITS.aiCandidates}案生成`}
        </button>
      </m.div>
      {view.topicCandidates.length > 0 && (
        // 候補が入れ替わったら、一覧ごと作り直して順に出す
        <m.ul
          key={view.topicCandidates.join('\n')}
          className="topic-candidates"
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.08 } } }}
        >
          {view.topicCandidates.map((t, i) => {
            const isSelected = view.topicSource === 'ai' && view.topic === t;
            return (
              <m.li
                key={t}
                variants={{
                  hidden: { opacity: 0, y: 16, rotateX: -60 },
                  show: { opacity: 1, y: 0, rotateX: 0, transition: { type: 'spring', stiffness: 260, damping: 20 } },
                }}
              >
                <m.button
                  className={isSelected ? 'selected' : undefined}
                  disabled={view.aiBusy}
                  animate={isSelected ? { scale: [1, 1.04, 1] } : { scale: 1 }}
                  transition={{ duration: 0.35 }}
                  whileHover={view.aiBusy ? undefined : { y: -2 }}
                  onClick={() => act('topic:pick', { index: i })}
                >
                  {t}
                </m.button>
              </m.li>
            );
          })}
        </m.ul>
      )}

      <m.div variants={row}>
        <m.button
          className={`primary big shine ${canStart ? 'ready' : ''}`}
          disabled={!canStart}
          whileTap={{ scale: 0.95 }}
          onClick={() => act('start')}
        >
          配って開始 (<Count value={seated} />
          人)
        </m.button>
      </m.div>
      <AnimatePresence>
        {seated < 2 && (
          <m.p
            className="muted"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            2人以上集まると開始できます
          </m.p>
        )}
      </AnimatePresence>
    </m.section>
  );
}
