import type { TimerPersistedState } from './types';

const STORAGE_KEY = 'fitgo.trainingTimer.v1';
const CHANNEL = 'fitgo-training-timer';

export function loadTimerState(): TimerPersistedState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TimerPersistedState;
    if (parsed?.version !== 1 || !Array.isArray(parsed.phases)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveTimerState(state: TimerPersistedState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota / private mode */
  }
}

export function clearTimerState(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export type TimerSyncMessage =
  | { type: 'state'; state: TimerPersistedState }
  | { type: 'control'; action: 'play' | 'pause' | 'skip' | 'reset' | 'amrap' };

export function openTimerChannel(
  onMessage: (msg: TimerSyncMessage) => void,
): {
  post: (msg: TimerSyncMessage) => void;
  close: () => void;
} | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (ev: MessageEvent<TimerSyncMessage>) => {
    if (ev.data && typeof ev.data === 'object' && 'type' in ev.data) {
      onMessage(ev.data);
    }
  };
  return {
    post: (msg) => {
      try {
        channel.postMessage(msg);
      } catch {
        /* ignore */
      }
    },
    close: () => channel.close(),
  };
}

export function storageKeyForMeta(meta: {
  kind: string;
  bookingId?: string;
  sessionKey?: string;
}): string {
  if (meta.kind === 'pt' && meta.bookingId) return `pt:${meta.bookingId}`;
  if (meta.kind === 'gp' && meta.sessionKey) return `gp:${meta.sessionKey}`;
  return meta.kind;
}
