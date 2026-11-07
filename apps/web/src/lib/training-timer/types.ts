/** Wall-clock training timer (Forma Coach modes 1–2). */

export type PhaseKind = 'prep' | 'work' | 'rest' | 'roundRest' | 'cooldown';

export type SoundPackId = 'classic' | 'gong' | 'whistle';

export type BuiltinPresetId =
  | 'stopwatch'
  | 'countdown'
  | 'intervals'
  | 'tabata'
  | 'emom'
  | 'amrap'
  | 'rest'
  | 'custom';

export interface TimerPhase {
  kind: PhaseKind;
  /** null = open (stopwatch / free work until skip). */
  durationSec: number | null;
  label: string;
}

export type TimerRunStatus = 'idle' | 'running' | 'paused' | 'complete';

export interface TimerSessionMeta {
  kind: 'pt' | 'gp' | 'hall';
  bookingId?: string;
  sessionKey?: string;
  clientId?: string;
  title?: string;
  /** Link back to plan / journal. */
  planHref?: string;
}

export interface TimerPersistedState {
  version: 1;
  sessionId: string;
  presetId: string;
  presetName: string;
  phases: TimerPhase[];
  phaseIndex: number;
  status: TimerRunStatus;
  /** Wall ms when the current running segment started. */
  segmentStartedAt: number | null;
  /** Elapsed ms in the current phase before the current segment. */
  phaseElapsedMs: number;
  /** Completed AMRAP rounds (tap). */
  amrapRounds: number;
  soundPack: SoundPackId;
  voiceEnabled: boolean;
  vibrateEnabled: boolean;
  soundEnabled: boolean;
  volume: number;
  meta: TimerSessionMeta;
  updatedAt: number;
}

export type TimerEventKind =
  | 'phase_start'
  | 'countdown_tick'
  | 'half'
  | 'phase_end'
  | 'complete'
  | 'amrap_round';

export interface TimerEvent {
  kind: TimerEventKind;
  phaseIndex: number;
  phase: TimerPhase;
  /** For countdown_tick: 3, 2, 1. */
  countdown?: number;
}

export interface TimerSnapshot {
  phaseIndex: number;
  phase: TimerPhase | null;
  nextPhase: TimerPhase | null;
  status: TimerRunStatus;
  /** Remaining in current phase; null when open. */
  remainingMs: number | null;
  elapsedMs: number;
  phaseProgress: number;
  totalElapsedMs: number;
  amrapRounds: number;
  isOpenPhase: boolean;
  isLastThreeSec: boolean;
}

export interface IntervalPresetParams {
  workSec: number;
  restSec: number;
  rounds: number;
  prepSec?: number;
}

export interface EmomPresetParams {
  minutes: number;
  prepSec?: number;
}

export interface AmrapPresetParams {
  totalSec: number;
  prepSec?: number;
}

export interface CountdownPresetParams {
  durationSec: number;
}

export interface RestPresetParams {
  durationSec: number;
}

export interface CustomPresetParams {
  phases: TimerPhase[];
  name?: string;
}

export type PresetBuildInput =
  | { id: 'stopwatch' }
  | { id: 'countdown'; params: CountdownPresetParams }
  | { id: 'intervals'; params: IntervalPresetParams }
  | { id: 'tabata'; params?: Partial<IntervalPresetParams> }
  | { id: 'emom'; params: EmomPresetParams }
  | { id: 'amrap'; params: AmrapPresetParams }
  | { id: 'rest'; params: RestPresetParams }
  | { id: 'custom'; params: CustomPresetParams };

export interface BuiltPreset {
  id: string;
  name: string;
  phases: TimerPhase[];
}
