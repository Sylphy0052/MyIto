import { m, type Variants } from 'motion/react';
import {
  DOORS_AI_MODELS,
  DOORS_AI_MODEL_LABEL,
  DOORS_TIME_LIMITS,
  DOORS_TURN_LIMITS,
  LIMITS,
  type DoorsAiModel,
  type GameMode,
  type GmPick,
  type RoomView,
} from '../../shared/types';
import type { Act } from './RoomScreen';
import { RadioGroup } from './RadioGroup';

export const MODE_LABEL: Record<GameMode, string> = { ito: 'ito', doors: '10の扉' };

const AI_UNAVAILABLE = 'サーバにASK APIの設定 (ASK_API_KEY / ASK_PROJECT_ID) が無いため、AIはGMを務められません';

const GM_PICK_LABEL: Record<GmPick, string> = { random: 'ランダム', named: '指名', ai: 'AI' };

/** 開始に要る接続中の人数。AIがGMなら全員が回答者なので1人でよい */
export function minPlayers(view: RoomView): number {
  return view.mode === 'doors' && view.doorsSettings.gmPick === 'ai' ? 1 : 2;
}

/** 10の扉の開始を止める理由。開始できるなら空 */
export function doorsStartBlocker(view: RoomView): string {
  const s = view.doorsSettings;
  if (s.gmPick === 'ai') return view.aiAvailable ? '' : AI_UNAVAILABLE;
  if (s.gmPick !== 'named') return '';
  const gm = view.players.find((p) => p.id === s.gmId);
  if (!gm) return 'GMを指名してください';
  if (!gm.connected) return `${gm.name} さんが切断しています。GMを指名し直してください`;
  return '';
}

/** ランダムで引いておいた次のGMの名前。引けていなければ undefined */
function nextGmName(view: RoomView): string | undefined {
  return view.players.find((p) => p.id === view.nextGmId)?.name;
}

/** 設定の一覧に出すGMの決め方。指名なら指名した人、ランダムなら引いておいた次のGMを添える */
function gmPickSummary(view: RoomView): string {
  const s = view.doorsSettings;
  if (s.gmPick === 'named') return `指名 (${view.players.find((p) => p.id === s.gmId)?.name ?? '未指名'})`;
  const drawn = nextGmName(view);
  if (s.gmPick === 'random' && drawn) return `ランダム (次は ${drawn} さん)`;
  return GM_PICK_LABEL[s.gmPick];
}

/** 参加者の画面に出す、10の扉の設定の一覧 */
export function DoorsSummary({ view }: { view: RoomView }) {
  const s = view.doorsSettings;
  return (
    <ul className="settings-summary">
      <li>GM: {gmPickSummary(view)}</li>
      <li>質問回数: {s.questions} 回</li>
      <li>嘘の上限: {s.maxLies === 0 ? 'なし' : `最大 ${s.maxLies} 回`}</li>
      <li>制限時間: {s.timeLimitMin === 0 ? 'なし' : `${s.timeLimitMin} 分`}</li>
      <li>1手番: {s.turnLimitSec === 0 ? 'なし' : `${s.turnLimitSec} 秒`}</li>
      {s.gmPick === 'ai' && <li>AIのモデル: {DOORS_AI_MODEL_LABEL[s.aiModel]}</li>}
    </ul>
  );
}

export function ModeToggle({ view, act }: { view: RoomView; act: Act }) {
  return (
    <RadioGroup
      label="ゲームの種類"
      className="kind-toggle mode-toggle"
      options={['ito', 'doors'] as const}
      value={view.mode}
      getLabel={(mode) => MODE_LABEL[mode]}
      onChange={(mode) => void act('mode', { mode })}
      disabled={view.aiBusy}
    />
  );
}

/** ホストが決める10の扉の設定 */
export function DoorsSettingsForm({ view, act, variants }: { view: RoomView; act: Act; variants: Variants }) {
  const s = view.doorsSettings;
  const connected = view.players.filter((p) => p.connected);
  const drawn = nextGmName(view);
  return (
    <>
      <m.div className="field-row" variants={variants}>
        <span className="label">GMの決め方</span>
        <select value={s.gmPick} onChange={(e) => act('doors:settings', { gmPick: e.target.value })}>
          <option value="random">ランダム (ロビーで抽選)</option>
          <option value="named">プレイヤー指名</option>
          <option value="ai" disabled={!view.aiAvailable}>
            AI (全員が回答者)
          </option>
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
        {s.gmPick === 'random' && drawn && (
          <>
            <span>次のGM: {drawn} さん</span>
            {connected.length >= 2 && (
              <button type="button" className="small" onClick={() => act('doors:reroll-gm')}>
                引き直す
              </button>
            )}
          </>
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
        <span className="label">制限時間</span>
        <select value={s.timeLimitMin} onChange={(e) => act('doors:settings', { timeLimitMin: Number(e.target.value) })}>
          {DOORS_TIME_LIMITS.map((n) => (
            <option key={n} value={n}>
              {n === 0 ? 'なし' : `${n}分`}
            </option>
          ))}
        </select>
      </m.div>
      <m.div className="field-row" variants={variants}>
        <span className="label">1手番</span>
        <select value={s.turnLimitSec} onChange={(e) => act('doors:settings', { turnLimitSec: Number(e.target.value) })}>
          {DOORS_TURN_LIMITS.map((n) => (
            <option key={n} value={n}>
              {n === 0 ? 'なし' : `${n}秒`}
            </option>
          ))}
        </select>
      </m.div>
      {!view.aiAvailable && (
        <m.p className="muted" variants={variants}>
          {AI_UNAVAILABLE}
        </m.p>
      )}
      {s.gmPick === 'ai' && view.aiAvailable && (
        <m.div className="field-row" variants={variants}>
          <span className="label">AIのモデル</span>
          <select value={s.aiModel} onChange={(e) => act('doors:settings', { aiModel: e.target.value as DoorsAiModel })}>
            {DOORS_AI_MODELS.map((model) => (
              <option key={model} value={model}>
                {DOORS_AI_MODEL_LABEL[model]}
              </option>
            ))}
          </select>
        </m.div>
      )}
      {s.gmPick === 'ai' && view.aiAvailable && (
        <m.p className="muted" variants={variants}>
          AIがテーマから答えを決め、質問と解答に答えます。1人でも遊べます
        </m.p>
      )}
      {s.gmPick === 'random' && connected.length >= 3 && (
        <m.p className="muted" variants={variants}>
          3人以上のときは、直前のGMは抽選から外れます
        </m.p>
      )}
    </>
  );
}
