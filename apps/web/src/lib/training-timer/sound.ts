import type { SoundPackId, TimerEvent } from './types';

type AudioCtx = AudioContext;

let sharedCtx: AudioCtx | null = null;
let unlocked = false;

function getCtx(): AudioCtx | null {
  if (typeof window === 'undefined') return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return null;
  if (!sharedCtx) sharedCtx = new AC();
  return sharedCtx;
}

/** Call from first user gesture (Start) for iOS. */
export async function unlockAudio(): Promise<void> {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') await ctx.resume();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    unlocked = true;
  } catch {
    unlocked = false;
  }
}

export function isAudioUnlocked(): boolean {
  return unlocked;
}

function beep(
  ctx: AudioCtx,
  freq: number,
  durationSec: number,
  volume: number,
  type: OscillatorType = 'sine',
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.value = 0;
  osc.connect(gain);
  gain.connect(ctx.destination);
  const now = ctx.currentTime;
  gain.gain.linearRampToValueAtTime(volume, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);
  osc.start(now);
  osc.stop(now + durationSec + 0.02);
}

const FILE_MAP: Record<
  Exclude<SoundPackId, 'classic'>,
  Record<'start' | 'phase' | 'end' | 'countdown' | 'half', string>
> = {
  gong: {
    start: '/sounds/gong-start.wav',
    phase: '/sounds/gong-phase.wav',
    end: '/sounds/gong-end.wav',
    countdown: '/sounds/countdown.wav',
    half: '/sounds/half.wav',
  },
  whistle: {
    start: '/sounds/whistle-start.wav',
    phase: '/sounds/whistle-phase.wav',
    end: '/sounds/whistle-end.wav',
    countdown: '/sounds/countdown.wav',
    half: '/sounds/half.wav',
  },
};

const audioCache = new Map<string, HTMLAudioElement>();

function playFile(src: string, volume: number) {
  try {
    let el = audioCache.get(src);
    if (!el) {
      el = new Audio(src);
      audioCache.set(src, el);
    }
    el.volume = Math.min(1, Math.max(0, volume));
    el.currentTime = 0;
    void el.play().catch(() => undefined);
  } catch {
    /* ignore */
  }
}

function playClassic(
  kind: 'start' | 'phase' | 'end' | 'countdown' | 'half',
  volume: number,
) {
  const ctx = getCtx();
  if (!ctx) return;
  const v = volume * 0.35;
  switch (kind) {
    case 'start':
      beep(ctx, 660, 0.18, v);
      setTimeout(() => beep(ctx, 880, 0.22, v), 120);
      break;
    case 'phase':
      beep(ctx, 520, 0.25, v, 'triangle');
      break;
    case 'end':
      beep(ctx, 440, 0.2, v);
      setTimeout(() => beep(ctx, 550, 0.2, v), 160);
      setTimeout(() => beep(ctx, 660, 0.35, v), 320);
      break;
    case 'countdown':
      beep(ctx, 880, 0.1, v * 0.9);
      break;
    case 'half':
      beep(ctx, 400, 0.15, v * 0.7);
      break;
  }
}

function playCue(
  pack: SoundPackId,
  kind: 'start' | 'phase' | 'end' | 'countdown' | 'half',
  volume: number,
) {
  if (pack === 'classic') {
    playClassic(kind, volume);
    return;
  }
  const map = FILE_MAP[pack];
  playFile(map[kind], volume);
}

const VOICE_RU: Record<number, string> = {
  3: 'три',
  2: 'два',
  1: 'один',
};

export function speakCountdown(n: number, enabled: boolean) {
  if (!enabled || typeof window === 'undefined' || !window.speechSynthesis) {
    return;
  }
  const text = n === 0 ? 'старт' : VOICE_RU[n];
  if (!text) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ru-RU';
    u.rate = 1.05;
    u.volume = 1;
    window.speechSynthesis.speak(u);
  } catch {
    /* ignore */
  }
}

export function handleTimerSoundEvents(
  events: TimerEvent[],
  opts: {
    pack: SoundPackId;
    volume: number;
    soundEnabled: boolean;
    voiceEnabled: boolean;
    vibrateEnabled: boolean;
  },
) {
  if (!opts.soundEnabled && !opts.voiceEnabled && !opts.vibrateEnabled) return;

  for (const ev of events) {
    if (ev.kind === 'countdown_tick' && ev.countdown != null) {
      if (opts.soundEnabled) playCue(opts.pack, 'countdown', opts.volume);
      if (opts.voiceEnabled) speakCountdown(ev.countdown, true);
      if (opts.vibrateEnabled && typeof navigator !== 'undefined') {
        navigator.vibrate?.(40);
      }
      continue;
    }
    if (!opts.soundEnabled) continue;
    if (ev.kind === 'phase_start') {
      if (ev.phase.kind === 'work') playCue(opts.pack, 'start', opts.volume);
      else playCue(opts.pack, 'phase', opts.volume);
      if (opts.voiceEnabled && ev.phase.kind === 'work' && ev.phaseIndex === 0) {
        speakCountdown(0, true);
      }
    } else if (ev.kind === 'phase_end') {
      playCue(opts.pack, 'phase', opts.volume);
    } else if (ev.kind === 'half') {
      playCue(opts.pack, 'half', opts.volume);
    } else if (ev.kind === 'complete') {
      playCue(opts.pack, 'end', opts.volume);
      if (opts.vibrateEnabled && typeof navigator !== 'undefined') {
        navigator.vibrate?.([80, 40, 80]);
      }
    } else if (ev.kind === 'amrap_round') {
      playCue(opts.pack, 'phase', opts.volume * 0.7);
      if (opts.vibrateEnabled && typeof navigator !== 'undefined') {
        navigator.vibrate?.(30);
      }
    }
  }
}
