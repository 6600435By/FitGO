import type { SoundPackId } from '@/lib/training-timer/types';

const KEY = 'fitgo.trainer.timerPrefs.v1';

export type TrainerTimerPrefs = {
  soundPack: SoundPackId;
  soundEnabled: boolean;
  voiceEnabled: boolean;
  vibrateEnabled: boolean;
  volume: number;
};

const DEFAULTS: TrainerTimerPrefs = {
  soundPack: 'classic',
  soundEnabled: true,
  voiceEnabled: true,
  vibrateEnabled: true,
  volume: 0.8,
};

export function loadTrainerTimerPrefs(): TrainerTimerPrefs {
  if (typeof window === 'undefined') return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<TrainerTimerPrefs>;
    const pack = parsed.soundPack;
    return {
      soundPack:
        pack === 'classic' || pack === 'gong' || pack === 'whistle'
          ? pack
          : DEFAULTS.soundPack,
      soundEnabled:
        typeof parsed.soundEnabled === 'boolean'
          ? parsed.soundEnabled
          : DEFAULTS.soundEnabled,
      voiceEnabled:
        typeof parsed.voiceEnabled === 'boolean'
          ? parsed.voiceEnabled
          : DEFAULTS.voiceEnabled,
      vibrateEnabled:
        typeof parsed.vibrateEnabled === 'boolean'
          ? parsed.vibrateEnabled
          : DEFAULTS.vibrateEnabled,
      volume:
        typeof parsed.volume === 'number' &&
        parsed.volume >= 0 &&
        parsed.volume <= 1
          ? parsed.volume
          : DEFAULTS.volume,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveTrainerTimerPrefs(prefs: TrainerTimerPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}
