'use client';

import type { CircuitWorkout, WorkoutSheet } from '@fitgo/shared-types';
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
import type { WorkoutTimerMode } from './workout-timer-apply';
import type { TimerMeasureKind } from './workout-timer-apply';
import {
  WorkoutTimerSettings,
  type WorkoutTimerSessionState,
} from './workout-timer-settings';
import type { TimerDockBlockOption } from './workout-timer-apply';

export type { WorkoutTimerMode } from './workout-timer-apply';

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

interface WorkoutTimerProps {
  open: boolean;
  onClose: () => void;
  mode: WorkoutTimerMode;
  circuit?: CircuitWorkout;
  /** Стартовый отдых для режима rest (сек) */
  defaultRestSec?: number;
  /** Обратный отсчёт 3-2-1 перед работой */
  countdownEnabled?: boolean;
  activeBlockLabel?: string;
  measureLabel?: string;
  autoStart?: boolean;
  session?: WorkoutTimerSessionState;
  onSessionChange?: (session: WorkoutTimerSessionState) => void;
  blockOptions?: TimerDockBlockOption[];
  sheet?: WorkoutSheet;
  measureOptions?: TimerMeasureKind[];
  onApply?: (sec: number, auto: boolean) => void;
  applyLabel?: string;
  onApplyHr?: (hr: number) => void;
  hrApplyLabel?: string | null;
  onRoundComplete?: (round: number) => void;
  /** Завершение круга: время работы + опционально ЧСС */
  onRoundLapComplete?: (round: number, workSec: number, hr?: number) => void;
  /** Фактический отдых между кругами (сек) */
  onRoundRestComplete?: (round: number, restSec: number) => void;
  /** Фактический отдых по окончании countdown rest */
  onRestComplete?: (elapsedSec: number) => void;
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
  activeBlockLabel,
  measureLabel,
  autoStart = false,
  session,
  onSessionChange,
  blockOptions,
  sheet,
  measureOptions = [],
  onApply,
  applyLabel,
  onApplyHr,
  hrApplyLabel,
  onRoundComplete,
  onRoundLapComplete,
  onRoundRestComplete,
  onRestComplete,
}: WorkoutTimerProps) {
  type LapPhase = 'work' | 'rest' | 'complete';

  const [phaseIndex, setPhaseIndex] = useState(0);
  const [remainingSec, setRemainingSec] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [running, setRunning] = useState(false);
  const [lapPhase, setLapPhase] = useState<LapPhase>('work');
  const [currentRound, setCurrentRound] = useState(1);
  const [blockIntervalRest, setBlockIntervalRest] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [vibrateEnabled, setVibrateEnabled] = useState(true);
  const [wakeLockEnabled, setWakeLockEnabled] = useState(true);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [wakeLockHint, setWakeLockHint] = useState<string | null>(null);
  const wakeLockSupported =
    typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [countdownEnabled, setCountdownEnabled] = useState(initialCountdown);
  const [restDuration, setRestDuration] = useState(defaultRestSec);
  const [elapsedTotal, setElapsedTotal] = useState(0);
  const restStartedSec = useRef(defaultRestSec);

  useEffect(() => {
    restStartedSec.current = restDuration;
  }, [restDuration]);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const lastRoundRef = useRef(0);
  const currentRoundRef = useRef(currentRound);
  currentRoundRef.current = currentRound;

  const totalRounds = circuit?.rounds ?? 1;
  const roundRestSec =
    circuit?.restBetweenRoundsSec ?? session?.restSec ?? defaultRestSec;

  const phases = useMemo(() => {
    if (mode === 'circuit' && circuit) {
      return buildCircuitPhases(circuit, countdownEnabled);
    }
    return [];
  }, [mode, circuit, countdownEnabled]);

  const currentPhase = phases[phaseIndex];
  const nextPhase = phases[phaseIndex + 1];
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    if (!open || mode !== 'circuit' || !onSessionChange) return;
    const phase = phases[phaseIndex];
    if (!phase || phase.stationIndex <= 0) return;
    const circuitRound = phase.round;
    const circuitStationIndex = phase.stationIndex - 1;
    const prev = sessionRef.current;
    if (
      prev?.circuitRound === circuitRound &&
      prev.circuitStationIndex === circuitStationIndex
    ) {
      return;
    }
    onSessionChange({
      ...(prev ?? {
        activeBlock: 'circuit',
        measureKind: 'circuit',
        exerciseIndex: 0,
        setIndex: 0,
        rowIndex: 0,
        activityIndex: 0,
        restSec: 90,
        circuitRound: 1,
        circuitStationIndex: 0,
      }),
      circuitRound,
      circuitStationIndex,
    });
  }, [open, mode, phaseIndex, phases, onSessionChange]);

  const reset = useCallback(() => {
    setPhaseIndex(0);
    setRunning(false);
    setElapsedTotal(0);
    setElapsedSec(0);
    setBlockIntervalRest(false);
    lastRoundRef.current = 0;
    if (mode === 'round_lap') {
      const startRound = session?.circuitRound ?? 1;
      setCurrentRound(startRound);
      setLapPhase('work');
      setRemainingSec(0);
      return;
    }
    if (mode === 'rest') {
      setRemainingSec(restDuration);
    } else if (mode === 'block') {
      setRemainingSec(0);
    } else if (phases[0] && phases[0].kind !== 'complete') {
      setRemainingSec(phases[0].durationSec);
    } else {
      setRemainingSec(0);
    }
  }, [mode, phases, restDuration, session?.circuitRound]);

  useEffect(() => {
    if (!open) return;
    reset();
  }, [open, reset]);

  useEffect(() => {
    if (!open || !running) return;

    const tick = window.setInterval(() => {
      if (mode === 'round_lap') {
        if (lapPhase === 'work') {
          setElapsedSec((e) => e + 1);
        } else if (lapPhase === 'rest') {
          setRemainingSec((prev) => {
            if (prev <= 1) return 0;
            if (prev <= 4 && vibrateEnabled) navigator.vibrate?.(30);
            return prev - 1;
          });
        }
        setElapsedTotal((t) => t + 1);
        return;
      }
      if (mode === 'block' && blockIntervalRest) {
        setRemainingSec((prev) => {
          if (prev <= 1) return 0;
          if (prev <= 4 && vibrateEnabled) navigator.vibrate?.(30);
          return prev - 1;
        });
        setElapsedTotal((t) => t + 1);
        return;
      }
      if (mode === 'block') {
        setElapsedSec((e) => e + 1);
        setElapsedTotal((t) => t + 1);
        return;
      }
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
  }, [open, running, vibrateEnabled, mode, lapPhase, blockIntervalRest]);

  useEffect(() => {
    if (!open || !running || remainingSec > 0) return;

    if (mode === 'round_lap' && lapPhase === 'rest') {
      signalPhaseChange('round_rest', soundEnabled, vibrateEnabled, audioCtxRef.current);
      const round = currentRoundRef.current;
      const restElapsed = restStartedSec.current;
      onRoundRestComplete?.(round, restElapsed);
      const nextRound = round + 1;
      if (nextRound > totalRounds) {
        setLapPhase('complete');
        setRunning(false);
        return;
      }
      setCurrentRound(nextRound);
      if (session && onSessionChange) {
        onSessionChange({ ...session, circuitRound: nextRound });
      }
      setLapPhase('work');
      setElapsedSec(0);
      setRunning(true);
      return;
    }

    if (mode === 'block' && blockIntervalRest) {
      setBlockIntervalRest(false);
      setElapsedSec(0);
      setRunning(true);
      return;
    }

    if (mode === 'rest') {
      signalPhaseChange('complete', soundEnabled, vibrateEnabled, audioCtxRef.current);
      onRestComplete?.(restStartedSec.current);
      setRunning(false);
      return;
    }

    const phase = phases[phaseIndex];
    if (!phase) return;

    if (phase.kind === 'round_rest') {
      onRoundRestComplete?.(phase.round, phase.durationSec);
    }

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
    onRoundRestComplete,
    onRestComplete,
    lapPhase,
    blockIntervalRest,
    totalRounds,
    session,
    onSessionChange,
  ]);

  useEffect(() => {
    if (!open || !running || !wakeLockEnabled || !wakeLockSupported) {
      setWakeLockActive(false);
      return;
    }
    let cancelled = false;

    const acquire = async () => {
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (!cancelled) {
          wakeLockRef.current = lock;
          setWakeLockActive(true);
          lock.addEventListener('release', () => {
            if (!cancelled) setWakeLockActive(false);
          });
        } else {
          await lock.release();
        }
      } catch {
        if (!cancelled) setWakeLockActive(false);
      }
    };

    void acquire();
    return () => {
      cancelled = true;
      setWakeLockActive(false);
      void wakeLockRef.current?.release();
      wakeLockRef.current = null;
    };
  }, [open, running, wakeLockEnabled, wakeLockSupported]);

  const toggleWakeLock = () => {
    setWakeLockEnabled((v) => {
      const next = !v;
      setWakeLockHint(
        next
          ? running
            ? 'Экран не погаснет, пока идёт таймер'
            : 'Включится при старте таймера'
          : 'Экран может погаснуть по таймауту системы',
      );
      window.setTimeout(() => setWakeLockHint(null), 2500);
      return next;
    });
  };

  const ensureAudio = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    void audioCtxRef.current.resume();
  };

  const start = useCallback(() => {
    ensureAudio();
    const completed =
      mode === 'round_lap'
        ? lapPhase === 'complete'
        : mode === 'rest'
          ? !running && remainingSec === 0 && elapsedTotal > 0
          : mode === 'block'
            ? false
            : phases[phaseIndex]?.kind === 'complete';

    if (completed) {
      if (mode === 'round_lap') {
        setCurrentRound(1);
        setLapPhase('work');
        setElapsedSec(0);
        setElapsedTotal(0);
        if (session && onSessionChange) {
          onSessionChange({ ...session, circuitRound: 1 });
        }
      } else {
        setPhaseIndex(0);
        setElapsedTotal(0);
        lastRoundRef.current = 0;
      }
    }

    if (mode === 'round_lap') {
      if (lapPhase === 'work') {
        setElapsedSec(completed ? 0 : elapsedSec);
      }
      setRunning(true);
      return;
    }

    if (mode === 'rest') {
      setRemainingSec(restDuration);
      restStartedSec.current = restDuration;
    } else if (mode === 'block') {
      setElapsedSec(completed ? 0 : elapsedSec);
      setElapsedTotal(completed ? 0 : elapsedTotal);
    } else if (phases[0] && phases[0].kind !== 'complete') {
      setRemainingSec(phases[completed ? 0 : phaseIndex]?.durationSec ?? phases[0].durationSec);
    }
    setRunning(true);
  }, [
    mode,
    lapPhase,
    running,
    remainingSec,
    elapsedTotal,
    elapsedSec,
    phases,
    phaseIndex,
    restDuration,
    session,
    onSessionChange,
  ]);

  const startRef = useRef(start);
  startRef.current = start;

  useEffect(() => {
    if (!open || !autoStart) return;
    const id = window.setTimeout(() => startRef.current(), 50);
    return () => window.clearTimeout(id);
  }, [open, autoStart]);

  useEffect(() => {
    if (session?.restSec != null) {
      setRestDuration(session.restSec);
      if (!running && mode === 'rest') {
        setRemainingSec(session.restSec);
        restStartedSec.current = session.restSec;
      }
    }
  }, [session?.restSec, running, mode]);

  const pause = () => setRunning(false);

  const skip = () => {
    if (mode === 'round_lap' && lapPhase === 'rest') {
      setRemainingSec(0);
      return;
    }
    if (mode === 'block' && blockIntervalRest) {
      setRemainingSec(0);
      return;
    }
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
      : (mode === 'rest' ||
          (mode === 'round_lap' && lapPhase === 'rest') ||
          (mode === 'block' && blockIntervalRest)) &&
          restDuration > 0
        ? 1 - remainingSec / restDuration
        : 0;

  const displaySec =
    mode === 'block' && !blockIntervalRest
      ? elapsedSec
      : mode === 'round_lap' && lapPhase === 'work'
        ? elapsedSec
        : remainingSec;

  const handleApply = () => {
    if (!onApply) return;
    if (mode === 'block') {
      onApply(elapsedSec, false);
      return;
    }
    if (mode === 'rest') {
      const sec = Math.max(0, restStartedSec.current - remainingSec);
      onApply(sec > 0 ? sec : restStartedSec.current, false);
    }
  };

  const handleApplyHr = () => {
    if (!onApplyHr || !session?.heartRate || session.heartRate <= 0) return;
    onApplyHr(session.heartRate);
  };

  const completeLap = () => {
    ensureAudio();
    if (mode === 'round_lap' && lapPhase === 'work') {
      const workSec = elapsedSec;
      if (workSec <= 0) return;
      const hr = session?.heartRate;
      onRoundLapComplete?.(currentRound, workSec, hr);
      if (session && onSessionChange) {
        onSessionChange({
          ...session,
          circuitRound: currentRound,
          heartRate: undefined,
        });
      }
      if (currentRound >= totalRounds) {
        signalPhaseChange('complete', soundEnabled, vibrateEnabled, audioCtxRef.current);
        setLapPhase('complete');
        setRunning(false);
        return;
      }
      setRestDuration(roundRestSec);
      setRemainingSec(roundRestSec);
      restStartedSec.current = roundRestSec;
      setLapPhase('rest');
      setElapsedSec(0);
      setRunning(true);
      signalPhaseChange('round_rest', soundEnabled, vibrateEnabled, audioCtxRef.current);
      return;
    }

    if (mode === 'block' && !blockIntervalRest) {
      if (elapsedSec <= 0) return;
      onApply?.(elapsedSec, false);
      const rest = session?.restSec ?? restDuration;
      setRestDuration(rest);
      setRemainingSec(rest);
      restStartedSec.current = rest;
      setBlockIntervalRest(true);
      setElapsedSec(0);
      setRunning(true);
    }
  };

  if (!open) return null;

  const isComplete =
    mode === 'round_lap'
      ? lapPhase === 'complete'
      : mode === 'rest'
        ? !running && remainingSec === 0 && elapsedTotal > 0
        : mode === 'block'
          ? false
          : currentPhase?.kind === 'complete';

  const timerTitle =
    mode === 'round_lap'
      ? 'Круговая'
      : mode === 'circuit'
        ? 'Таймер круговой'
        : mode === 'rest'
          ? 'Таймер отдыха'
          : 'Таймер';

  const showLapButton =
    (mode === 'round_lap' && lapPhase === 'work' && !isComplete) ||
    (mode === 'block' && !blockIntervalRest && !isComplete);

  const lapButtonLabel =
    mode === 'round_lap'
      ? `Круг ${currentRound}/${totalRounds}`
      : 'Интервал';

  return (
    <div className="fixed inset-0 z-[70] flex justify-center bg-black/50">
      <div className="flex h-full w-full max-w-lg flex-col bg-slate-950">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Timer className="h-5 w-5 text-fitgo-400" />
          <span className="font-semibold">{timerTitle}</span>
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

      {session && onSessionChange && blockOptions && sheet && (
        <WorkoutTimerSettings
          session={session}
          blockOptions={blockOptions}
          sheet={sheet}
          measureOptions={measureOptions}
          onChange={onSessionChange}
        />
      )}

      <div className="flex flex-1 flex-col items-center justify-center px-4 pb-8">
        {(activeBlockLabel || measureLabel) && (
          <p className="mb-4 text-center text-sm text-slate-400">
            {activeBlockLabel}
            {measureLabel ? ` · ${measureLabel}` : ''}
          </p>
        )}

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

        {mode === 'round_lap' && (
          <p
            className={`mb-6 text-sm font-medium uppercase tracking-wide ${
              lapPhase === 'rest' ? 'text-violet-400' : 'text-fitgo-400'
            }`}
          >
            {lapPhase === 'rest'
              ? `Отдых после круга ${currentRound}`
              : lapPhase === 'complete'
                ? 'Все круги выполнены'
                : `Круг ${currentRound} из ${totalRounds}`}
          </p>
        )}

        {mode === 'block' && blockIntervalRest && (
          <p className="mb-6 text-sm font-medium uppercase tracking-wide text-violet-400">
            Отдых между интервалами
          </p>
        )}

        {mode === 'block' && !blockIntervalRest && (
          <p className="mb-6 text-sm font-medium uppercase tracking-wide text-fitgo-400">
            Секундомер
          </p>
        )}

        <p
          className={`font-mono text-6xl font-bold tabular-nums ${
            displaySec <= 3 &&
            running &&
            (mode === 'rest' ||
              (mode === 'round_lap' && lapPhase === 'rest') ||
              blockIntervalRest)
              ? 'text-amber-400'
              : 'text-white'
          }`}
        >
          {formatTime(displaySec)}
        </p>

        {mode !== 'block' &&
          !(mode === 'round_lap' && lapPhase === 'work') && (
          <div className="mt-6 h-2 w-full max-w-xs overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-fitgo-500 transition-all duration-1000 ease-linear"
              style={{ width: `${Math.min(100, progress * 100)}%` }}
            />
          </div>
        )}

        {mode === 'circuit' && nextPhase && nextPhase.kind !== 'complete' && running && (
          <p className="mt-4 text-center text-sm text-slate-500">
            Далее: {nextPhase.label}
            {nextPhase.stationName ? ` — ${nextPhase.stationName}` : ''}
          </p>
        )}

        {isComplete && (
          <p className="mt-4 text-lg font-medium text-emerald-400">
            {mode === 'rest'
              ? 'Отдых окончен'
              : mode === 'round_lap'
                ? 'Круговая завершена'
                : 'Отличная работа!'}
          </p>
        )}

        <p className="mt-2 text-xs text-slate-600">
          Всего: {formatTime(elapsedTotal)}
        </p>
      </div>

      <div className="border-t border-slate-800 px-3 py-3 space-y-2">
        {onApplyHr && session && onSessionChange && (
          <div className="flex flex-wrap items-center justify-center gap-2 pb-1">
            <label className="flex items-center gap-1.5 text-sm text-slate-400">
              ЧСС
              <input
                type="number"
                min={40}
                max={220}
                placeholder="уд/мин"
                className="input w-20 px-2 py-1 text-center text-sm"
                value={session.heartRate ?? ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  onSessionChange({
                    ...session,
                    heartRate:
                      raw === '' ? undefined : Math.max(0, Number(raw) || 0),
                  });
                }}
              />
            </label>
            <button
              type="button"
              onClick={handleApplyHr}
              disabled={!session.heartRate || !hrApplyLabel}
              className="btn-secondary px-3 py-1.5 text-sm disabled:opacity-40"
              title={hrApplyLabel ?? 'Для выбранного блока ЧСС не записывается'}
            >
              Записать{hrApplyLabel ? ` · ${hrApplyLabel}` : ' ЧСС'}
            </button>
          </div>
        )}

        {((mode === 'rest' && !running && !isComplete) ||
          (mode === 'round_lap' && lapPhase === 'rest' && !running && !isComplete)) && (
          <div className="flex items-center justify-center gap-3">
            <span className="text-sm text-slate-400">Секунд отдыха</span>
            <button
              type="button"
              onClick={() => {
                const next = Math.max(10, restDuration - 15);
                setRestDuration(next);
                setRemainingSec(next);
                if (session && onSessionChange) {
                  onSessionChange({ ...session, restSec: next });
                }
              }}
              className="btn-secondary px-3 py-1"
            >
              −15
            </button>
            <span className="w-12 text-center font-mono">{restDuration}</span>
            <button
              type="button"
              onClick={() => {
                const next = restDuration + 15;
                setRestDuration(next);
                setRemainingSec(next);
                if (session && onSessionChange) {
                  onSessionChange({ ...session, restSec: next });
                }
              }}
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
          {showLapButton && (
            <button
              type="button"
              onClick={completeLap}
              disabled={
                !running ||
                elapsedSec <= 0 ||
                (mode === 'round_lap' && lapPhase !== 'work')
              }
              className="btn-primary px-4 text-sm disabled:opacity-40"
            >
              {lapButtonLabel}
            </button>
          )}

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

          {running &&
            mode !== 'block' &&
            !(mode === 'round_lap' && lapPhase === 'work') && (
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

          {onApply &&
            (mode === 'block' || mode === 'rest') &&
            !blockIntervalRest && (
            <button
              type="button"
              onClick={handleApply}
              disabled={displaySec <= 0 && !isComplete}
              className="btn-secondary px-4 text-sm disabled:opacity-40"
            >
              Записать{applyLabel ? ` · ${applyLabel}` : ''}
            </button>
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

          {wakeLockSupported && (
            <button
              type="button"
              onClick={toggleWakeLock}
              aria-pressed={wakeLockEnabled}
              className={`btn-secondary px-3 text-xs ${
                wakeLockEnabled
                  ? 'bg-fitgo-500/20 text-fitgo-300'
                  : 'text-slate-500'
              }`}
              title={
                wakeLockEnabled
                  ? 'Не гасить экран во время таймера (вкл.)'
                  : 'Разрешить гашение экрана (выкл.)'
              }
            >
              {wakeLockActive ? 'Экран вкл' : wakeLockEnabled ? 'Экран' : 'Экран выкл'}
            </button>
          )}
        </div>
        {wakeLockHint && (
          <p className="text-center text-[11px] text-fitgo-400">{wakeLockHint}</p>
        )}
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
