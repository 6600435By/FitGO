'use client';

import type { CircuitWorkout } from '@fitgo/shared-types';
import {
  Minus,
  Pause,
  Play,
  Plus,
  SkipForward,
  Timer,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TrainerTip } from './trainer-tip';

type TimerPhaseKind =
  | 'prep'
  | 'work'
  | 'station_rest'
  | 'round_rest'
  | 'complete';

interface TimerPhase {
  kind: TimerPhaseKind;
  durationSec: number;
  round: number;
  totalRounds: number;
  stationIndex: number;
  totalStations: number;
  stationName: string;
  label: string;
}

export type WorkoutTimerMode = 'circuit' | 'rest';

interface WorkoutTimerProps {
  open: boolean;
  onClose: () => void;
  mode: WorkoutTimerMode;
  circuit?: CircuitWorkout;
  /** Стартовый отдых для режима rest (сек) */
  defaultRestSec?: number;
  /** Обратный отсчёт 3-2-1 перед работой */
  countdownEnabled?: boolean;
  onRoundComplete?: (round: number) => void;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function buildCircuitPhases(
  circuit: CircuitWorkout,
  countdownEnabled: boolean,
): TimerPhase[] {
  const phases: TimerPhase[] = [];
  const stationCount = circuit.stations.length;
  const rounds = circuit.rounds;

  for (let r = 0; r < rounds; r++) {
    for (let s = 0; s < stationCount; s++) {
      const station = circuit.stations[s];
      const name = station.name?.trim() || `Станция ${s + 1}`;
      const workSec = station.workSec ?? 45;

      if (countdownEnabled) {
        phases.push({
          kind: 'prep',
          durationSec: 3,
          round: r + 1,
          totalRounds: rounds,
          stationIndex: s + 1,
          totalStations: stationCount,
          stationName: name,
          label: 'Приготовьтесь',
        });
      }

      phases.push({
        kind: 'work',
        durationSec: workSec,
        round: r + 1,
        totalRounds: rounds,
        stationIndex: s + 1,
        totalStations: stationCount,
        stationName: name,
        label: 'Работа',
      });

      const isLastStation = s === stationCount - 1;
      if (!isLastStation) {
        const restSec = station.restSec ?? circuit.transitionSec ?? 15;
        phases.push({
          kind: 'station_rest',
          durationSec: restSec,
          round: r + 1,
          totalRounds: rounds,
          stationIndex: s + 1,
          totalStations: stationCount,
          stationName: name,
          label: 'Переход / отдых',
        });
      }
    }

    const isLastRound = r === rounds - 1;
    if (!isLastRound) {
      phases.push({
        kind: 'round_rest',
        durationSec: circuit.restBetweenRoundsSec ?? 60,
        round: r + 1,
        totalRounds: rounds,
        stationIndex: 0,
        totalStations: stationCount,
        stationName: '',
        label: 'Отдых между кругами',
      });
    }
  }

  phases.push({
    kind: 'complete',
    durationSec: 0,
    round: rounds,
    totalRounds: rounds,
    stationIndex: 0,
    totalStations: stationCount,
    stationName: '',
    label: 'Тренировка завершена',
  });

  return phases;
}

function playBeep(
  audioCtx: AudioContext,
  frequency: number,
  durationMs: number,
  volume = 0.3,
) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.frequency.value = frequency;
  gain.gain.value = volume;
  osc.start();
  osc.stop(audioCtx.currentTime + durationMs / 1000);
}

function signalPhaseChange(
  kind: TimerPhaseKind,
  soundEnabled: boolean,
  vibrateEnabled: boolean,
  audioCtx: AudioContext | null,
) {
  if (vibrateEnabled && typeof navigator !== 'undefined' && navigator.vibrate) {
    if (kind === 'complete') {
      navigator.vibrate([200, 100, 200, 100, 400]);
    } else if (kind === 'round_rest') {
      navigator.vibrate([250, 80, 250]);
    } else if (kind === 'work') {
      navigator.vibrate([150, 60, 150]);
    } else {
      navigator.vibrate(100);
    }
  }

  if (!soundEnabled || !audioCtx) return;

  if (kind === 'complete') {
    playBeep(audioCtx, 880, 200);
    setTimeout(() => playBeep(audioCtx, 1100, 300), 220);
    setTimeout(() => playBeep(audioCtx, 1320, 400), 550);
  } else if (kind === 'prep') {
    playBeep(audioCtx, 440, 80, 0.2);
  } else if (kind === 'work') {
    playBeep(audioCtx, 660, 150);
  } else if (kind === 'round_rest') {
    playBeep(audioCtx, 520, 200);
    setTimeout(() => playBeep(audioCtx, 520, 200), 250);
  } else {
    playBeep(audioCtx, 480, 120);
  }
}

const PHASE_COLORS: Record<TimerPhaseKind, string> = {
  prep: 'text-amber-400',
  work: 'text-fitgo-400',
  station_rest: 'text-sky-400',
  round_rest: 'text-violet-400',
  complete: 'text-emerald-400',
};

export function WorkoutTimer({
  open,
  onClose,
  mode,
  circuit,
  defaultRestSec = 90,
  countdownEnabled: initialCountdown = true,
  onRoundComplete,
}: WorkoutTimerProps) {
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [remainingSec, setRemainingSec] = useState(0);
  const [running, setRunning] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [vibrateEnabled, setVibrateEnabled] = useState(true);
  const [wakeLockEnabled, setWakeLockEnabled] = useState(true);
  const [countdownEnabled, setCountdownEnabled] = useState(initialCountdown);
  const [restDuration, setRestDuration] = useState(defaultRestSec);
  const [elapsedTotal, setElapsedTotal] = useState(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const lastRoundRef = useRef(0);

  const phases = useMemo(() => {
    if (mode === 'circuit' && circuit) {
      return buildCircuitPhases(circuit, countdownEnabled);
    }
    return [];
  }, [mode, circuit, countdownEnabled]);

  const currentPhase = phases[phaseIndex];
  const nextPhase = phases[phaseIndex + 1];

  const reset = useCallback(() => {
    setPhaseIndex(0);
    setRunning(false);
    setElapsedTotal(0);
    lastRoundRef.current = 0;
    if (mode === 'rest') {
      setRemainingSec(restDuration);
    } else if (phases[0] && phases[0].kind !== 'complete') {
      setRemainingSec(phases[0].durationSec);
    } else {
      setRemainingSec(0);
    }
  }, [mode, phases, restDuration]);

  useEffect(() => {
    if (!open) return;
    reset();
  }, [open, reset]);

  useEffect(() => {
    if (!open || !running) return;

    const tick = window.setInterval(() => {
      setRemainingSec((prev) => {
        if (prev <= 1) return 0;
        if (prev <= 4 && vibrateEnabled) {
          navigator.vibrate?.(30);
        }
        return prev - 1;
      });
      setElapsedTotal((e) => e + 1);
    }, 1000);

    return () => window.clearInterval(tick);
  }, [open, running, vibrateEnabled]);

  useEffect(() => {
    if (!open || !running || remainingSec > 0) return;

    if (mode === 'rest') {
      signalPhaseChange('complete', soundEnabled, vibrateEnabled, audioCtxRef.current);
      setRunning(false);
      return;
    }

    const phase = phases[phaseIndex];
    if (!phase) return;

    if (phase.kind === 'round_rest' && phase.round > lastRoundRef.current) {
      lastRoundRef.current = phase.round;
      onRoundComplete?.(phase.round);
    }

    const nextIndex = phaseIndex + 1;
    const next = phases[nextIndex];

    if (!next || next.kind === 'complete') {
      signalPhaseChange('complete', soundEnabled, vibrateEnabled, audioCtxRef.current);
      setPhaseIndex(nextIndex);
      setRunning(false);
      return;
    }

    signalPhaseChange(next.kind, soundEnabled, vibrateEnabled, audioCtxRef.current);
    setPhaseIndex(nextIndex);
    setRemainingSec(next.durationSec);
  }, [
    remainingSec,
    running,
    open,
    mode,
    phases,
    phaseIndex,
    soundEnabled,
    vibrateEnabled,
    onRoundComplete,
  ]);

  useEffect(() => {
    if (!open || !running || !wakeLockEnabled) return;
    let cancelled = false;

    const acquire = async () => {
      try {
        if ('wakeLock' in navigator) {
          const lock = await navigator.wakeLock.request('screen');
          if (!cancelled) wakeLockRef.current = lock;
        }
      } catch {
        /* ignore — не все браузеры поддерживают */
      }
    };

    void acquire();
    return () => {
      cancelled = true;
      void wakeLockRef.current?.release();
      wakeLockRef.current = null;
    };
  }, [open, running, wakeLockEnabled]);

  const ensureAudio = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    void audioCtxRef.current.resume();
  };

  const start = () => {
    ensureAudio();
    const completed =
      mode === 'rest'
        ? !running && remainingSec === 0 && elapsedTotal > 0
        : phases[phaseIndex]?.kind === 'complete';

    if (completed) {
      setPhaseIndex(0);
      setElapsedTotal(0);
      lastRoundRef.current = 0;
    }

    if (mode === 'rest') {
      setRemainingSec(restDuration);
    } else if (phases[0] && phases[0].kind !== 'complete') {
      setRemainingSec(phases[completed ? 0 : phaseIndex]?.durationSec ?? phases[0].durationSec);
    }
    setRunning(true);
  };

  const pause = () => setRunning(false);

  const skip = () => {
    if (mode === 'rest') {
      setRemainingSec(0);
      return;
    }
    setRemainingSec(0);
  };

  const adjustTime = (delta: number) => {
    setRemainingSec((s) => Math.max(0, s + delta));
  };

  const progress =
    mode === 'circuit' && currentPhase && currentPhase.durationSec > 0
      ? 1 - remainingSec / currentPhase.durationSec
      : mode === 'rest' && restDuration > 0
        ? 1 - remainingSec / restDuration
        : 0;

  if (!open) return null;

  const isComplete =
    mode === 'rest'
      ? !running && remainingSec === 0 && elapsedTotal > 0
      : currentPhase?.kind === 'complete';

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-slate-950">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <Timer className="h-5 w-5 text-fitgo-400" />
          <span className="font-semibold">
            {mode === 'circuit' ? 'Таймер круговой' : 'Таймер отдыха'}
          </span>
          <TrainerTip tipId="timer" />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-slate-400 hover:bg-slate-800"
          aria-label="Закрыть таймер"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-4 pb-8">
        {mode === 'circuit' && currentPhase && (
          <>
            <p
              className={`mb-1 text-sm font-medium uppercase tracking-wide ${PHASE_COLORS[currentPhase.kind]}`}
            >
              {currentPhase.label}
            </p>
            {currentPhase.kind !== 'complete' && currentPhase.kind !== 'round_rest' && (
              <p className="mb-2 text-center text-xl font-semibold text-slate-100">
                {currentPhase.stationName}
              </p>
            )}
            {currentPhase.kind !== 'complete' && (
              <p className="mb-6 text-sm text-slate-500">
                Круг {currentPhase.round}/{currentPhase.totalRounds}
                {currentPhase.stationIndex > 0 && (
                  <> · Станция {currentPhase.stationIndex}/{currentPhase.totalStations}</>
                )}
              </p>
            )}
          </>
        )}

        {mode === 'rest' && (
          <p className="mb-6 text-sm font-medium uppercase tracking-wide text-sky-400">
            Отдых между подходами
          </p>
        )}

        <p
          className={`font-mono text-7xl font-bold tabular-nums sm:text-8xl ${
            remainingSec <= 3 && running ? 'text-amber-400' : 'text-white'
          }`}
        >
          {formatTime(remainingSec)}
        </p>

        <div className="mt-6 h-2 w-full max-w-xs overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-fitgo-500 transition-all duration-1000 ease-linear"
            style={{ width: `${Math.min(100, progress * 100)}%` }}
          />
        </div>

        {mode === 'circuit' && nextPhase && nextPhase.kind !== 'complete' && running && (
          <p className="mt-4 text-center text-sm text-slate-500">
            Далее: {nextPhase.label}
            {nextPhase.stationName ? ` — ${nextPhase.stationName}` : ''}
          </p>
        )}

        {isComplete && (
          <p className="mt-4 text-lg font-medium text-emerald-400">
            {mode === 'rest' ? 'Отдых окончен' : 'Отличная работа!'}
          </p>
        )}

        <p className="mt-2 text-xs text-slate-600">
          Всего: {formatTime(elapsedTotal)}
        </p>
      </div>

      <div className="border-t border-slate-800 px-4 py-4 space-y-3">
        {!running && !isComplete && mode === 'rest' && (
          <div className="flex items-center justify-center gap-3">
            <span className="text-sm text-slate-400">Секунд отдыха</span>
            <button
              type="button"
              onClick={() => setRestDuration((d) => Math.max(10, d - 15))}
              className="btn-secondary px-3 py-1"
            >
              −15
            </button>
            <span className="w-12 text-center font-mono">{restDuration}</span>
            <button
              type="button"
              onClick={() => setRestDuration((d) => d + 15)}
              className="btn-secondary px-3 py-1"
            >
              +15
            </button>
          </div>
        )}

        {mode === 'circuit' && !running && !isComplete && (
          <label className="flex items-center justify-center gap-2 text-sm text-slate-400">
            <input
              type="checkbox"
              checked={countdownEnabled}
              onChange={(e) => setCountdownEnabled(e.target.checked)}
              className="rounded"
            />
            Обратный отсчёт 3-2-1 перед работой
          </label>
        )}

        <div className="flex flex-wrap items-center justify-center gap-2">
          {!running ? (
            <button type="button" onClick={start} className="btn-primary flex items-center gap-2 px-6">
              <Play className="h-5 w-5" />
              {isComplete ? 'Заново' : 'Старт'}
            </button>
          ) : (
            <button type="button" onClick={pause} className="btn-secondary flex items-center gap-2 px-6">
              <Pause className="h-5 w-5" />
              Пауза
            </button>
          )}

          {running && (
            <>
              <button
                type="button"
                onClick={() => adjustTime(-10)}
                className="btn-secondary flex items-center gap-1 px-3"
                title="−10 сек"
              >
                <Minus className="h-4 w-4" />
                10
              </button>
              <button
                type="button"
                onClick={skip}
                className="btn-secondary flex items-center gap-1 px-3"
                title="Пропустить фазу"
              >
                <SkipForward className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => adjustTime(10)}
                className="btn-secondary flex items-center gap-1 px-3"
                title="+10 сек"
              >
                <Plus className="h-4 w-4" />
                10
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setSoundEnabled((v) => !v)}
            className="btn-secondary p-2"
            title={soundEnabled ? 'Выключить звук' : 'Включить звук'}
          >
            {soundEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          </button>

          <button
            type="button"
            onClick={() => setVibrateEnabled((v) => !v)}
            className={`btn-secondary px-3 text-xs ${vibrateEnabled ? 'text-fitgo-400' : 'text-slate-500'}`}
            title="Вибрация"
          >
            Вибр.
          </button>

          <button
            type="button"
            onClick={() => setWakeLockEnabled((v) => !v)}
            className={`btn-secondary px-3 text-xs ${wakeLockEnabled ? 'text-fitgo-400' : 'text-slate-500'}`}
            title="Не гасить экран"
          >
            Экран
          </button>
        </div>
      </div>
    </div>
  );
}

interface WorkoutTimerLauncherProps {
  circuit?: CircuitWorkout;
  canUseCircuit: boolean;
  canUseRest: boolean;
  defaultRestSec?: number;
  onRoundComplete?: (round: number) => void;
}

export function WorkoutTimerLauncher({
  circuit,
  canUseCircuit,
  canUseRest,
  defaultRestSec = 90,
  onRoundComplete,
}: WorkoutTimerLauncherProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<WorkoutTimerMode>('circuit');

  const openTimer = (m: WorkoutTimerMode) => {
    setMode(m);
    setOpen(true);
  };

  if (!canUseCircuit && !canUseRest) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canUseCircuit && circuit && (
          <button
            type="button"
            onClick={() => openTimer('circuit')}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <Timer className="h-4 w-4" />
            Таймер круговой
          </button>
        )}
        {canUseRest && (
          <button
            type="button"
            onClick={() => openTimer('rest')}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            <Timer className="h-4 w-4" />
            Отдых между подходами
          </button>
        )}
      </div>

      <WorkoutTimer
        open={open}
        onClose={() => setOpen(false)}
        mode={mode}
        circuit={circuit}
        defaultRestSec={defaultRestSec}
        onRoundComplete={onRoundComplete}
      />
    </>
  );
}
