import { m, type Variants } from 'motion/react';
import { LIMITS, type GameMode, type RoomView } from '../../shared/types';
import type { Act } from './RoomScreen';

export const MODE_LABEL: Record<GameMode, string> = { ito: 'ito', doors: '10の扉' };

/** 10の扉の開始を止める理由。開始できるなら空 */
export function doorsStartBlocker(view: RoomView): string {
  const s = view.doorsSettings;
  if (s.gmPick !== 'named') return '';
  const gm = view.players.find((p) => p.id === s.gmId);
  if (!gm) return 'GMを指名してください';
  if (!gm.connected) return `${gm.name} さんが切断しています。GMを指名し直してください`;
  return '';
}

/** 参加者の画面に出す、10の扉の設定の一覧 */
export function DoorsSummary({ view }: { view: RoomView }) {
  const s = view.doorsSettings;
  const gmName = view.players.find((p) => p.id === s.gmId)?.name;
  return (
    <ul className="settings-summary">
      <li>GM: {s.gmPick === 'named' ? `指名 (${gmName ?? '未指名'})` : 'ランダム'}</li>
      <li>質問回数: {s.questions} 回</li>
      <li>嘘の上限: {s.maxLies === 0 ? 'なし' : `最大 ${s.maxLies} 回`}</li>
    </ul>
  );
}

export function ModeToggle({ view, act }: { view: RoomView; act: Act }) {
  return (
    <div className="kind-toggle mode-toggle" role="radiogroup" aria-label="ゲームの種類">
      {(['ito', 'doors'] as const).map((mode) => (
        <button
          key={mode}
          role="radio"
          aria-checked={view.mode === mode}
          className={view.mode === mode ? 'selected' : ''}
          disabled={view.aiBusy}
          onClick={() => act('mode', { mode })}
        >
          {MODE_LABEL[mode]}
        </button>
      ))}
    </div>
  );
}

/** ホストが決める10の扉の設定 */
export function DoorsSettingsForm({ view, act, variants }: { view: RoomView; act: Act; variants: Variants }) {
  const s = view.doorsSettings;
  const connected = view.players.filter((p) => p.connected);
  return (
    <>
      <m.div className="field-row" variants={variants}>
        <span className="label">GMの決め方</span>
        <select value={s.gmPick} onChange={(e) => act('doors:settings', { gmPick: e.target.value })}>
          <option value="random">ランダム (毎ラウンド抽選)</option>
          <option value="named">プレイヤー指名</option>
        </select>
        {s.gmPick === 'named' && (
          <select value={s.gmId} onChange={(e) => act('doors:settings', { gmId: e.target.value })}>
            <option value="">選んでください</option>
            {view.players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.connected ? '' : ' (切断中)'}
              </option>
            ))}
          </select>
        )}
      </m.div>
      <m.div className="field-row" variants={variants}>
        <span className="label">質問回数</span>
        <select value={s.questions} onChange={(e) => act('doors:settings', { questions: Number(e.target.value) })}>
          {Array.from({ length: LIMITS.doorsMaxQuestions }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span className="label">嘘の上限</span>
        <select value={s.maxLies} onChange={(e) => act('doors:settings', { maxLies: Number(e.target.value) })}>
          {Array.from({ length: LIMITS.doorsMaxLies + 1 }, (_, i) => i).map((n) => (
            <option key={n} value={n}>
              {n === 0 ? 'なし' : `${n}回`}
            </option>
          ))}
        </select>
      </m.div>
      {s.gmPick === 'random' && connected.length >= 3 && (
        <m.p className="muted" variants={variants}>
          3人以上のときは、直前のGMは抽選から外れます
        </m.p>
      )}
    </>
  );
}
