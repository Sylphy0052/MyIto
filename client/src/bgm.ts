import { useCallback, useEffect, useState } from 'react';
import type { RoomView } from '../../shared/types';
import { isDoorsPhase } from '../../shared/types';

export type BgmCategory = 'lobby' | 'ito' | 'doors' | 'win' | 'lose';
export type BgmVolume = 'off' | 'low' | 'mid' | 'high';

export const BGM_VOLUMES: readonly BgmVolume[] = ['off', 'low', 'mid', 'high'];
export const BGM_VOLUME_LABEL: Record<BgmVolume, string> = { off: 'なし', low: '小', mid: '中', high: '大' };
const BGM_GAIN: Record<BgmVolume, number> = { off: 0, low: 0.15, mid: 0.3, high: 0.6 };
const BGM_KEY = 'ito:bgm';
const BGM_TRACKS = 3;
const FADE_MS = 1500;
const FADE_STEP_MS = 50;

/** itoで全カードが昇順に並んだか */
export function isPerfectOrder(view: RoomView): boolean {
  const values = new Map(view.cards.map((c) => [c.id, c.value ?? 0]));
  return view.order.every((id, i) => i === 0 || values.get(id)! > values.get(view.order[i - 1]!)!);
}

/** 画面の状態から曲の分類を決める。ルームの外 (null) はロビー扱い */
export function bgmCategoryFor(view: RoomView | null): BgmCategory {
  if (!view || view.phase === 'lobby') return 'lobby';
  if (view.phase === 'result') return isPerfectOrder(view) ? 'win' : 'lose';
  if (view.phase === 'doors-result') {
    const outcome = view.doors?.outcome;
    return outcome === 'win' ? 'win' : outcome === 'lose' ? 'lose' : 'lobby';
  }
  if (isDoorsPhase(view.phase)) return 'doors';
  return view.phase === 'playing' || view.phase === 'revealing' ? 'ito' : 'lobby';
}

// ブラウザは操作前の自動再生を止めるので、最初の操作があるまでは鳴らさない (sound.tsと同じ扱い)。
// どのイベントを再生の許可とみなすかはブラウザで違う (タッチはpointerdownでは足りない) ため、複数を拾う。
// 許可の前に呼んだplay()は拒否されるので、以降の操作のたびに、鳴るはずの曲が止まっていれば再生し直す
let hasInteracted = false;
const interactListeners = new Set<() => void>();
const markInteracted = () => {
  if (hasInteracted) {
    resumeIfBlocked();
    return;
  }
  hasInteracted = true;
  interactListeners.forEach((fn) => fn());
};
for (const type of ['pointerdown', 'pointerup', 'click', 'touchend', 'keydown']) {
  window.addEventListener(type, markInteracted, { capture: true });
}

function loadVolume(): BgmVolume {
  try {
    const v = localStorage.getItem(BGM_KEY);
    return BGM_VOLUMES.find((x) => x === v) ?? 'mid';
  } catch {
    return 'mid';
  }
}

/** BGMの音量4段階。設定はブラウザに残す (通知音の`ito:sound`とは別) */
export function useBgmVolume(): [BgmVolume, (v: BgmVolume) => void] {
  const [volume, setVolume] = useState(loadVolume);
  const update = useCallback((v: BgmVolume) => {
    setVolume(v);
    try {
      localStorage.setItem(BGM_KEY, v);
    } catch {
      // 保存できなくても、このタブの間は切替が効く
    }
  }, []);
  return [volume, update];
}

interface Player {
  audio: HTMLAudioElement;
  timer: number | undefined;
}

/** 目標の音量へ少しずつ寄せる。0に届いたら止める */
function fadeTo(p: Player, target: number, onDone?: () => void): void {
  window.clearInterval(p.timer);
  const step = Math.max(Math.abs(target - p.audio.volume) / (FADE_MS / FADE_STEP_MS), 0.001);
  p.timer = window.setInterval(() => {
    const diff = target - p.audio.volume;
    if (Math.abs(diff) <= step) {
      p.audio.volume = target;
      window.clearInterval(p.timer);
      onDone?.();
    } else {
      p.audio.volume = Math.min(1, Math.max(0, p.audio.volume + Math.sign(diff) * step));
    }
  }, FADE_STEP_MS);
}

const state: {
  current: { category: BgmCategory; track: number; player: Player | null } | null;
  lastTrack: Partial<Record<BgmCategory, number>>;
  /** 分類ごとに、次に鳴らす曲を先読みした音声要素 */
  next: Partial<Record<BgmCategory, { track: number; audio: HTMLAudioElement }>>;
  gain: number;
} = { current: null, lastTrack: {}, next: {}, gain: 0 };

const bgmUrl = (category: BgmCategory, track: number) => `/bgm/${category}-${track}.mp3`;

/** 同じ分類の次の曲 (今の曲と別) を1本決め、先に読み込んでおく。なしのときはしない */
function preloadNext(category: BgmCategory, currentTrack: number): void {
  if (state.gain === 0 || state.next[category]) return;
  const track = pickTrack(currentTrack);
  const audio = new Audio();
  audio.preload = 'auto';
  audio.src = bgmUrl(category, track);
  state.next[category] = { track, audio };
}

/** 鳴るはずの曲が (再生の許可前に拒否されて) 止まっていれば、もう一度再生する */
function resumeIfBlocked(): void {
  const current = state.current;
  // 読み込みに失敗した曲 (404など) は、操作のたびに取りに行かない
  if (!current?.player || state.gain === 0 || !current.player.audio.paused || current.player.audio.error) return;
  current.player.audio.play().catch(() => {});
}

/** 分類ごとに3曲からランダムに選び、ループ再生する。分類が変わると1.5秒でフェードして切り替える */
export function useBgm(category: BgmCategory, volume: BgmVolume): void {
  const [isReady, setIsReady] = useState(hasInteracted);
  useEffect(() => {
    if (isReady) return;
    const onInteract = () => setIsReady(true);
    interactListeners.add(onInteract);
    return () => void interactListeners.delete(onInteract);
  }, [isReady]);

  useEffect(() => {
    if (!isReady) return;
    const gain = BGM_GAIN[volume];
    state.gain = gain;
    const current = state.current;
    if (current && current.category === category && current.player) {
      // 分類は同じで音量だけ変わった。なしのときは止め、戻したときは続きから鳴らす
      const { player } = current;
      if (gain === 0) {
        fadeTo(player, 0, () => player.audio.pause());
      } else {
        player.audio.play().catch(() => {});
        fadeTo(player, gain);
        preloadNext(category, current.track);
      }
      return;
    }
    if (current?.player) {
      const old = current.player;
      fadeTo(old, 0, () => old.audio.pause());
    }
    if (gain === 0) {
      // なしの間はAudio要素を作らず、取得もしない。曲は鳴らすときに選ぶ
      state.current = { category, track: 0, player: null };
      return;
    }
    const held = state.next[category];
    delete state.next[category];
    const track = held?.track ?? pickTrack(state.lastTrack[category]);
    state.lastTrack[category] = track;
    const audio = held?.audio ?? new Audio(bgmUrl(category, track));
    audio.loop = true;
    audio.volume = 0;
    const player: Player = { audio, timer: undefined };
    state.current = { category, track, player };
    audio.play().catch(() => {
      // 再生できなくても進行は止めない
    });
    fadeTo(player, gain);
    preloadNext(category, track);
  }, [isReady, category, volume]);
}

/** 直前と同じ曲は避けて、1〜3から選ぶ */
function pickTrack(last: number | undefined): number {
  const candidates = Array.from({ length: BGM_TRACKS }, (_, i) => i + 1).filter((n) => n !== last);
  return candidates[Math.floor(Math.random() * candidates.length)]!;
}
