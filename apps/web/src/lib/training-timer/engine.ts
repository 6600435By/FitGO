import type {
  TimerEvent,
  TimerPersistedState,
  TimerPhase,
  TimerSessionMeta,
  TimerSnapshot,
  SoundPackId,
} from './types';

export function createSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createIdleState(
  phases: TimerPhase[],
  opts: {
    presetId: string;
    presetName: string;
    meta?: TimerSessionMeta;
    soundPack?: SoundPackId;
    sessionId?: string;
  },
): TimerPersistedState {
  return {
    version: 1,
    sessionId: opts.sessionId ?? createSessionId(),
    presetId: opts.presetId,
    presetName: opts.presetName,
    phases,
    phaseIndex: 0,
    status: 'idle',
    segmentStartedAt: null,
    phaseElapsedMs: 0,
    amrapRounds: 0,
    soundPack: opts.soundPack ?? 'classic',
    voiceEnabled: true,
    vibrateEnabled: true,
    soundEnabled: true,
    volume: 0.8,
    meta: opts.meta ?? { kind: 'pt' },
    updatedAt: Date.now(),
  };
}

function phaseElapsedAt(state: TimerPersistedState, now: number): number {
  let elapsed = state.phaseElapsedMs;
  if (state.status === 'running' && state.segmentStartedAt != null) {
    elapsed += Math.max(0, now - state.segmentStartedAt);
  }
  return elapsed;
}

function totalElapsedAt(state: TimerPersistedState, now: number): number {
  let total = 0;
  for (let i = 0; i < state.phaseIndex; i++) {
    const p = state.phases[i];
    if (p?.durationSec != null) total += p.durationSec * 1000;
  }
  total += phaseElapsedAt(state, now);
  return total;
}

export function getSnapshot(
  state: TimerPersistedState,
  now = Date.now(),
): TimerSnapshot {
  const phase = state.phases[state.phaseIndex] ?? null;
  const nextPhase = state.phases[state.phaseIndex + 1] ?? null;
  const elapsedMs = phaseElapsedAt(state, now);
  const isOpenPhase = phase?.durationSec == null;
  let remainingMs: number | null = null;
  let phaseProgress = 0;
  if (phase && phase.durationSec != null) {
    const dur = phase.durationSec * 1000;
    remainingMs = Math.max(0, dur - elapsedMs);
    phaseProgress = dur <= 0 ? 1 : Math.min(1, elapsedMs / dur);
  } else if (phase) {
    phaseProgress = 0;
  }
  const isLastThreeSec =
    remainingMs != null && remainingMs > 0 && remainingMs <= 3000;

  return {
    phaseIndex: state.phaseIndex,
    phase,
    nextPhase,
    status: state.status,
    remainingMs,
    elapsedMs,
    phaseProgress,
    totalElapsedMs: totalElapsedAt(state, now),
    amrapRounds: state.amrapRounds,
    isOpenPhase,
    isLastThreeSec,
  };
}

function withUpdated(state: TimerPersistedState): TimerPersistedState {
  return { ...state, updatedAt: Date.now() };
}

export function startTimer(
  state: TimerPersistedState,
  now = Date.now(),
): { state: TimerPersistedState; events: TimerEvent[] } {
  if (state.status === 'complete' || state.phases.length === 0) {
    return { state, events: [] };
  }
  if (state.status === 'running') return { state, events: [] };

  const phase = state.phases[state.phaseIndex];
  const events: TimerEvent[] = [];
  if (state.status === 'idle' && phase) {
    events.push({ kind: 'phase_start', phaseIndex: state.phaseIndex, phase });
  }

  return {
    state: withUpdated({
      ...state,
      status: 'running',
      segmentStartedAt: now,
    }),
    events,
  };
}

export function pauseTimer(
  state: TimerPersistedState,
  now = Date.now(),
): TimerPersistedState {
  if (state.status !== 'running') return state;
  return withUpdated({
    ...state,
    status: 'paused',
    phaseElapsedMs: phaseElapsedAt(state, now),
    segmentStartedAt: null,
  });
}

export function resumeTimer(
  state: TimerPersistedState,
  now = Date.now(),
): TimerPersistedState {
  if (state.status !== 'paused') return state;
  return withUpdated({
    ...state,
    status: 'running',
    segmentStartedAt: now,
  });
}

export function toggleTimer(
  state: TimerPersistedState,
  now = Date.now(),
): { state: TimerPersistedState; events: TimerEvent[] } {
  if (state.status === 'running') {
    return { state: pauseTimer(state, now), events: [] };
  }
  if (state.status === 'paused') {
    return { state: resumeTimer(state, now), events: [] };
  }
  return startTimer(state, now);
}

function advancePhase(
  state: TimerPersistedState,
  now: number,
): { state: TimerPersistedState; events: TimerEvent[] } {
  const phase = state.phases[state.phaseIndex];
  const endedElapsedMs = phaseElapsedAt(state, now);
  const events: TimerEvent[] = [];
  if (phase) {
    events.push({
      kind: 'phase_end',
      phaseIndex: state.phaseIndex,
      phase,
      elapsedMs: endedElapsedMs,
    });
  }
  const nextIndex = state.phaseIndex + 1;
  if (nextIndex >= state.phases.length) {
    return {
      state: withUpdated({
        ...state,
        status: 'complete',
        phaseIndex: Math.max(0, state.phases.length - 1),
        phaseElapsedMs:
          phase?.durationSec != null ? phase.durationSec * 1000 : endedElapsedMs,
        segmentStartedAt: null,
      }),
      events: [
        ...events,
        ...(phase
          ? [
              {
                kind: 'complete' as const,
                phaseIndex: state.phaseIndex,
                phase,
                elapsedMs: endedElapsedMs,
              },
            ]
          : []),
      ],
    };
  }
  const next = state.phases[nextIndex]!;
  events.push({ kind: 'phase_start', phaseIndex: nextIndex, phase: next });
  return {
    state: withUpdated({
      ...state,
      phaseIndex: nextIndex,
      phaseElapsedMs: 0,
      segmentStartedAt: state.status === 'running' ? now : null,
      status: state.status === 'complete' ? 'idle' : state.status,
    }),
    events,
  };
}

export function skipPhase(
  state: TimerPersistedState,
  now = Date.now(),
): { state: TimerPersistedState; events: TimerEvent[] } {
  if (state.status === 'complete' || state.phases.length === 0) {
    return { state, events: [] };
  }
  const frozen =
    state.status === 'running'
      ? {
          ...state,
          phaseElapsedMs: phaseElapsedAt(state, now),
          segmentStartedAt: null,
        }
      : state;
  const advanced = advancePhase(
    { ...frozen, status: state.status === 'idle' ? 'running' : state.status },
    now,
  );
  if (advanced.state.status === 'complete') return advanced;
  return {
    state: withUpdated({
      ...advanced.state,
      status: 'running',
      segmentStartedAt: now,
    }),
    events: advanced.events,
  };
}

/** Go to previous phase (or restart current when already on the first). */
export function previousPhase(
  state: TimerPersistedState,
  now = Date.now(),
): { state: TimerPersistedState; events: TimerEvent[] } {
  if (state.phases.length === 0) return { state, events: [] };

  const targetIndex = state.phaseIndex > 0 ? state.phaseIndex - 1 : 0;
  const phase = state.phases[targetIndex];
  if (!phase) return { state, events: [] };

  const running =
    state.status === 'running' ||
    state.status === 'complete' ||
    state.status === 'paused';

  const next = withUpdated({
    ...state,
    phaseIndex: targetIndex,
    phaseElapsedMs: 0,
    segmentStartedAt: running && state.status !== 'paused' ? now : null,
    status:
      state.status === 'complete'
        ? 'running'
        : state.status === 'idle'
          ? 'idle'
          : state.status === 'paused'
            ? 'paused'
            : 'running',
  });

  return {
    state: next,
    events:
      targetIndex !== state.phaseIndex || state.phaseElapsedMs > 0
        ? [{ kind: 'phase_start', phaseIndex: targetIndex, phase }]
        : [],
  };
}

export function resetTimer(
  state: TimerPersistedState,
  keepMeta = true,
): TimerPersistedState {
  return withUpdated({
    ...createIdleState(state.phases, {
      presetId: state.presetId,
      presetName: state.presetName,
      soundPack: state.soundPack,
      sessionId: state.sessionId,
      meta: keepMeta ? state.meta : { kind: 'pt' },
    }),
    voiceEnabled: state.voiceEnabled,
    vibrateEnabled: state.vibrateEnabled,
    soundEnabled: state.soundEnabled,
    volume: state.volume,
  });
}

export function bumpAmrapRound(
  state: TimerPersistedState,
): { state: TimerPersistedState; events: TimerEvent[] } {
  const phase = state.phases[state.phaseIndex];
  if (!phase || state.presetId !== 'amrap') {
    return { state, events: [] };
  }
  const next = withUpdated({
    ...state,
    amrapRounds: state.amrapRounds + 1,
  });
  return {
    state: next,
    events: phase
      ? [{ kind: 'amrap_round', phaseIndex: state.phaseIndex, phase }]
      : [],
  };
}

export function adjustOpenElapsed(
  state: TimerPersistedState,
  deltaSec: number,
  now = Date.now(),
): TimerPersistedState {
  const phase = state.phases[state.phaseIndex];
  if (!phase) return state;
  const base = phaseElapsedAt(state, now);
  const nextElapsed = Math.max(0, base + deltaSec * 1000);
  return withUpdated({
    ...state,
    phaseElapsedMs: nextElapsed,
    segmentStartedAt: state.status === 'running' ? now : null,
  });
}

export function adjustRestDuration(
  state: TimerPersistedState,
  deltaSec: number,
  now = Date.now(),
): TimerPersistedState {
  const phase = state.phases[state.phaseIndex];
  if (!phase || phase.durationSec == null) return state;
  if (phase.kind !== 'rest' && phase.kind !== 'roundRest' && state.presetId !== 'rest') {
    return state;
  }
  const elapsed = phaseElapsedAt(state, now);
  const newDur = Math.max(5, phase.durationSec + deltaSec);
  const phases = state.phases.map((p, i) =>
    i === state.phaseIndex ? { ...p, durationSec: newDur } : p,
  );
  return withUpdated({
    ...state,
    phases,
    phaseElapsedMs: Math.min(elapsed, newDur * 1000),
    segmentStartedAt: state.status === 'running' ? now : null,
  });
}

/**
 * Advance wall-clock time. Emits countdown / half / phase_end events once
 * based on crossed thresholds since last tick (caller should pass prior snapshot).
 */
export function advanceClock(
  state: TimerPersistedState,
  now: number,
  prev?: TimerSnapshot,
): { state: TimerPersistedState; events: TimerEvent[]; snapshot: TimerSnapshot } {
  if (state.status !== 'running') {
    const snapshot = getSnapshot(state, now);
    return { state, events: [], snapshot };
  }

  const phase = state.phases[state.phaseIndex];
  if (!phase) {
    const done = withUpdated({
      ...state,
      status: 'complete',
      segmentStartedAt: null,
    });
    return { state: done, events: [], snapshot: getSnapshot(done, now) };
  }

  if (phase.durationSec == null) {
    const snapshot = getSnapshot(state, now);
    return { state, events: [], snapshot };
  }

  const durMs = phase.durationSec * 1000;
  const elapsed = phaseElapsedAt(state, now);
  const events: TimerEvent[] = [];

  if (prev) {
    const prevRem = prev.remainingMs;
    const rem = Math.max(0, durMs - elapsed);
    if (prevRem != null) {
      for (const sec of [3, 2, 1] as const) {
        const threshold = sec * 1000;
        if (prevRem > threshold && rem <= threshold) {
          events.push({
            kind: 'countdown_tick',
            phaseIndex: state.phaseIndex,
            phase,
            countdown: sec,
          });
        }
      }
      const half = durMs / 2;
      if (prev.elapsedMs < half && elapsed >= half && durMs >= 20000) {
        events.push({ kind: 'half', phaseIndex: state.phaseIndex, phase });
      }
    }
  }

  if (elapsed < durMs) {
    const snapshot = getSnapshot(state, now);
    return { state, events, snapshot };
  }

  const advanced = advancePhase(
    {
      ...state,
      phaseElapsedMs: durMs,
      segmentStartedAt: null,
    },
    now,
  );
  const mergedEvents = [...events, ...advanced.events];
  let nextState = advanced.state;
  if (nextState.status !== 'complete') {
    nextState = withUpdated({
      ...nextState,
      status: 'running',
      segmentStartedAt: now,
    });
  }
  return {
    state: nextState,
    events: mergedEvents,
    snapshot: getSnapshot(nextState, now),
  };
}

export function formatTimerMs(ms: number, showHours = false): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (showHours || h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function phaseAccent(
  kind: TimerPhase['kind'] | undefined,
): 'work' | 'rest' | 'prep' {
  if (kind === 'work') return 'work';
  if (kind === 'prep' || kind === 'cooldown') return 'prep';
  return 'rest';
}
