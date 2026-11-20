import { useCallback, useState } from 'react';

const SOUND_KEY = 'ito:sound';
const CHIME_NOTES_HZ = [880, 1320];
const CHIME_NOTE_S = 0.12;
const CHIME_GAIN = 0.08;

// ブラウザは操作前の自動再生を止めるので、最初の操作があるまでは鳴らさない
let hasInteracted = false;
let audio: AudioContext | null = null;
const markInteracted = () => {
  hasInteracted = true;
};
window.addEventListener('pointerdown', markInteracted, { once: true, capture: true });
window.addEventListener('keydown', markInteracted, { once: true, capture: true });

function loadSoundOn(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** 通知音の「鳴らす / 消す」。設定はブラウザに残す */
export function useSoundSetting(): [boolean, (on: boolean) => void] {
  const [isOn, setIsOn] = useState(loadSoundOn);
  const update = useCallback((on: boolean) => {
    setIsOn(on);
    try {
      localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
    } catch {
      // 保存できなくても、このタブの間は切替が効く
    }
  }, []);
  return [isOn, update];
}

/** 短い2音のチャイム。音源ファイルを持たず、WebAudioで鳴らす */
export function playChime(): void {
  if (!hasInteracted || !loadSoundOn()) return;
  try {
    audio ??= new AudioContext();
    const start = audio.currentTime;
    CHIME_NOTES_HZ.forEach((hz, i) => {
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      const at = start + i * CHIME_NOTE_S;
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(CHIME_GAIN, at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + CHIME_NOTE_S * 1.8);
      osc.connect(gain).connect(audio!.destination);
      osc.start(at);
      osc.stop(at + CHIME_NOTE_S * 2);
    });
  } catch {
    // 音は飾り。鳴らせなくても進行は止めない
  }
}
