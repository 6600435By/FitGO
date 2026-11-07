'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  advanceClock,
  bumpAmrapRound,
  createIdleState,
  getSnapshot,
  pauseTimer,
  previousPhase,
  resetTimer,
  skipPhase,
  startTimer,
  toggleTimer,
  adjustRestDuration,
  adjustOpenElapsed,
} from './engine';
import {
  clearTimerState,
  loadTimerState,
  openTimerChannel,
  saveTimerState,
  type TimerSyncMessage,
} from './persistence';
import { handleTimerSoundEvents, unlockAudio } from './sound';
import type {
  BuiltPreset,
  SoundPackId,
  TimerEvent,
  TimerPersistedState,
  TimerSessionMeta,
  TimerSnapshot,
} from './types';
import { loadTrainerTimerPrefs, saveTrainerTimerPrefs } from '@/lib/trainer-timer-prefs';

const TICK_MS = 200;

function idleWithPrefs(
  phases: TimerPersistedState['phases'],
  opts: {
    presetId: string;
    presetName: string;
    meta: TimerSessionMeta;
  },
): TimerPersistedState {
  const prefs = loadTrainerTimerPrefs();
  const next = createIdleState(phases, {
    ...opts,
    soundPack: prefs.soundPack,
  });
  next.voiceEnabled = prefs.voiceEnabled;
  next.vibrateEnabled = prefs.vibrateEnabled;
  next.soundEnabled = prefs.soundEnabled;
  next.volume = prefs.volume;
  return next;
}

export function useTrainingTimer(opts: {
  meta: TimerSessionMeta;
  initialPreset: BuiltPreset;
  /** When true, this window only mirrors state (hall display). */
  mirrorOnly?: boolean;
  /** Fired after local control / tick emits timer events (not remote mirror). */
  onEvents?: (events: TimerEvent[], state: TimerPersistedState) => void;
}) {
  const { meta, initialPreset, mirrorOnly = false, onEvents } = opts;
  const onEventsRef = useRef(onEvents);
  onEventsRef.current = onEvents;
  const [state, setState] = useState<TimerPersistedState>(() =>
    idleWithPrefs(initialPreset.phases, {
      presetId: initialPreset.id,
      presetName: initialPreset.name,
      meta,
    }),
  );
  const [snapshot, setSnapshot] = useState<TimerSnapshot>(() =>
    getSnapshot(
      idleWithPrefs(initialPreset.phases, {
        presetId: initialPreset.id,
        presetName: initialPreset.name,
        meta,
      }),
    ),
  );
  const [flash, setFlash] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const snapRef = useRef(snapshot);
  snapRef.current = snapshot;
  const channelRef = useRef<ReturnType<typeof openTimerChannel>>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const applyRemoteRef = useRef(false);

  const commit = useCallback(
    (next: TimerPersistedState, events: Parameters<typeof handleTimerSoundEvents>[0] = []) => {
      stateRef.current = next;
      setState(next);
      const snap = getSnapshot(next);
      snapRef.current = snap;
      setSnapshot(snap);
      if (!mirrorOnly) {
        saveTimerState(next);
        channelRef.current?.post({ type: 'state', state: next });
      }
      if (events.length && !applyRemoteRef.current) {
        handleTimerSoundEvents(events, {
          pack: next.soundPack,
          volume: next.volume,
          soundEnabled: next.soundEnabled,
          voiceEnabled: next.voiceEnabled,
          vibrateEnabled: next.vibrateEnabled,
        });
        if (events.some((e) => e.kind === 'phase_start' || e.kind === 'complete')) {
          setFlash(true);
          window.setTimeout(() => setFlash(false), 280);
        }
        onEventsRef.current?.(events, next);
      }
    },
    [mirrorOnly],
  );

  // Restore from localStorage when meta matches / first mount
  useEffect(() => {
    const saved = loadTimerState();
    if (!saved) return;
    const sameSession =
      (meta.kind === 'pt' && saved.meta.bookingId === meta.bookingId) ||
      (meta.kind === 'gp' && saved.meta.sessionKey === meta.sessionKey) ||
      meta.kind === 'hall' ||
      mirrorOnly;
    if (!sameSession && !mirrorOnly) return;
    const hydrated = {
      ...saved,
      meta: mirrorOnly || meta.kind === 'hall' ? saved.meta : { ...saved.meta, ...meta },
    };
    commit(hydrated);
  }, [meta.bookingId, meta.sessionKey, meta.kind, mirrorOnly, commit]);

  // BroadcastChannel
  useEffect(() => {
    const ch = openTimerChannel((msg: TimerSyncMessage) => {
      if (msg.type === 'state') {
        applyRemoteRef.current = true;
        commit(msg.state);
        applyRemoteRef.current = false;
        return;
      }
      if (mirrorOnly) return;
      // Hall cannot send controls in this pass; reserved for later phone sync.
    });
    channelRef.current = ch;
    return () => ch?.close();
  }, [commit, mirrorOnly]);

  // Wall-clock tick
  useEffect(() => {
    if (state.status !== 'running') return;
    const id = window.setInterval(() => {
      const now = Date.now();
      const { state: next, events, snapshot: snap } = advanceClock(
        stateRef.current,
        now,
        snapRef.current,
      );
      if (next !== stateRef.current || events.length) {
        commit(next, events);
      } else {
        snapRef.current = snap;
        setSnapshot(snap);
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [state.status, commit]);

  // Visibility: recompute on return
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      const { state: next, events, snapshot: snap } = advanceClock(
        stateRef.current,
        Date.now(),
        snapRef.current,
      );
      commit(next, events);
      setSnapshot(snap);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [commit]);

  // Wake lock while running
  useEffect(() => {
    let cancelled = false;
    async function acquire() {
      if (mirrorOnly) return;
      if (state.status !== 'running') {
        await wakeLockRef.current?.release().catch(() => undefined);
        wakeLockRef.current = null;
        if (!cancelled) setWakeLockActive(false);
        return;
      }
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> };
        };
        if (!nav.wakeLock) return;
        const lock = await nav.wakeLock.request('screen');
        if (cancelled) {
          await lock.release();
          return;
        }
        wakeLockRef.current = lock;
        setWakeLockActive(true);
      } catch {
        if (!cancelled) setWakeLockActive(false);
      }
    }
    void acquire();
    return () => {
      cancelled = true;
    };
  }, [state.status, mirrorOnly]);

  const applyPreset = useCallback(
    (preset: BuiltPreset) => {
      if (mirrorOnly) return;
      const next = createIdleState(preset.phases, {
        presetId: preset.id,
        presetName: preset.name,
        meta: { ...stateRef.current.meta, ...meta },
        soundPack: stateRef.current.soundPack,
      });
      next.voiceEnabled = stateRef.current.voiceEnabled;
      next.vibrateEnabled = stateRef.current.vibrateEnabled;
      next.soundEnabled = stateRef.current.soundEnabled;
      next.volume = stateRef.current.volume;
      commit(next);
    },
    [commit, meta, mirrorOnly],
  );

  const play = useCallback(async () => {
    if (mirrorOnly) return;
    await unlockAudio();
    const { state: next, events } = startTimer(stateRef.current);
    commit(next, events);
  }, [commit, mirrorOnly]);

  const toggle = useCallback(async () => {
    if (mirrorOnly) return;
    await unlockAudio();
    const { state: next, events } = toggleTimer(stateRef.current);
    commit(next, events);
  }, [commit, mirrorOnly]);

  const pause = useCallback(() => {
    if (mirrorOnly) return;
    commit(pauseTimer(stateRef.current));
  }, [commit, mirrorOnly]);

  const skip = useCallback(() => {
    if (mirrorOnly) return;
    const { state: next, events } = skipPhase(stateRef.current);
    commit(next, events);
  }, [commit, mirrorOnly]);

  const prev = useCallback(() => {
    if (mirrorOnly) return;
    const { state: next, events } = previousPhase(stateRef.current);
    commit(next, events);
  }, [commit, mirrorOnly]);

  const reset = useCallback(() => {
    if (mirrorOnly) return;
    commit(resetTimer(stateRef.current));
  }, [commit, mirrorOnly]);

  const amrapPlus = useCallback(() => {
    if (mirrorOnly) return;
    const { state: next, events } = bumpAmrapRound(stateRef.current);
    commit(next, events);
  }, [commit, mirrorOnly]);

  const bumpRest = useCallback(
    (deltaSec: number) => {
      if (mirrorOnly) return;
      commit(adjustRestDuration(stateRef.current, deltaSec));
    },
    [commit, mirrorOnly],
  );

  const bumpOpen = useCallback(
    (deltaSec: number) => {
      if (mirrorOnly) return;
      commit(adjustOpenElapsed(stateRef.current, deltaSec));
    },
    [commit, mirrorOnly],
  );

  const patchPrefs = useCallback(
    (
      patch: Partial<
        Pick<
          TimerPersistedState,
          | 'soundPack'
          | 'voiceEnabled'
          | 'vibrateEnabled'
          | 'soundEnabled'
          | 'volume'
        >
      >,
    ) => {
      if (mirrorOnly) return;
      const next = { ...stateRef.current, ...patch, updatedAt: Date.now() };
      saveTrainerTimerPrefs({
        soundPack: next.soundPack,
        soundEnabled: next.soundEnabled,
        voiceEnabled: next.voiceEnabled,
        vibrateEnabled: next.vibrateEnabled,
        volume: next.volume,
      });
      commit(next);
    },
    [commit, mirrorOnly],
  );

  const endAndClear = useCallback(() => {
    if (mirrorOnly) return;
    clearTimerState();
    channelRef.current?.post({
      type: 'state',
      state: resetTimer(stateRef.current),
    });
  }, [mirrorOnly]);

  return {
    state,
    snapshot,
    flash,
    wakeLockActive,
    applyPreset,
    play,
    toggle,
    pause,
    skip,
    prev,
    reset,
    amrapPlus,
    bumpRest,
    bumpOpen,
    patchPrefs,
    endAndClear,
    setSoundPack: (pack: SoundPackId) => patchPrefs({ soundPack: pack }),
  };
}
