'use client';

import type { CircuitWorkout, WorkoutSectionId, WorkoutSheet } from '@fitgo/shared-types';
import { WORKOUT_SECTION_LABELS } from '@fitgo/shared-types';
import { Timer } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  applyTimerElapsed,
  applyTimerHeartRate,
  applyCircuitRoundRest,
  applyCircuitRoundWork,
  formatElapsedField,
  getTimerApplyLabel,
  getTimerHrApplyLabel,
  measureOptionsForBlock,
  resolveFullscreenTimerMode,
  type TimerApplyTarget,
  type TimerDockBlockOption,
} from './workout-timer-apply';
import { WorkoutTimer } from './workout-timer';
import type { WorkoutTimerSessionState } from './workout-timer-settings';
import { emitWorkoutTimerDockChrome } from './workout-timer-chrome';

export type { TimerDockBlockOption } from './workout-timer-apply';

type TimerLaunch = 'timer' | 'rest';

interface WorkoutTimerDockProps {
  sheet: WorkoutSheet;
  readOnly: boolean;
  circuit?: CircuitWorkout;
  blocks: TimerDockBlockOption[];
  onChange: (sheet: WorkoutSheet) => void;
}

function buildApplyTarget(session: WorkoutTimerSessionState): TimerApplyTarget {
  const {
    activeBlock,
    measureKind,
    exerciseIndex,
    setIndex,
    rowIndex,
    activityIndex,
    circuitRound,
    circuitStationIndex,
  } = session;
  if (activeBlock === 'circuit') {
    return {
      block: 'circuit',
      kind: 'circuit',
      circuitRound,
      circuitStationIndex,
    };
  }
  if (activeBlock === 'rest' || measureKind === 'set_rest') {
    return {
      block: 'strength',
      kind: 'set_rest',
      exerciseIndex,
      setIndex,
    };
  }
  if (measureKind === 'activity') {
    return {
      block: activeBlock as 'warmup' | 'cooldown',
      kind: 'activity',
      activityIndex,
    };
  }
  if (measureKind === 'row') {
    return {
      block: activeBlock as 'cardio' | 'mobility',
      kind: 'row',
      rowIndex,
    };
  }
  return { block: activeBlock as WorkoutSectionId, kind: 'block' };
}

function defaultMeasureForBlock(
  block: WorkoutTimerSessionState['activeBlock'],
): WorkoutTimerSessionState['measureKind'] {
  if (block === 'circuit') return 'circuit';
  return 'block';
}

function TimerBar({
  flash,
  stuck,
  onTimer,
  onRest,
}: {
  flash: string | null;
  stuck: boolean;
  onTimer: () => void;
  onRest: () => void;
}) {
  return (
    <div
      className={cn(
        'sticky z-20 -mx-4 border-slate-700 bg-slate-950/95 px-4 p-2.5 backdrop-blur-md',
        stuck
          ? 'top-0 border-x-0 border-b pt-[env(safe-area-inset-top)]'
          : 'top-[var(--app-header-h)] mb-3 rounded-2xl border shadow-lg shadow-black/25',
      )}
    >
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onTimer}
          className="btn-primary flex flex-1 items-center justify-center gap-2 py-2 text-sm"
        >
          <Timer className="h-4 w-4" />
          Таймер
        </button>
        <button
          type="button"
          onClick={onRest}
          className="btn-secondary flex flex-1 items-center justify-center gap-2 py-2 text-sm"
        >
          Отдых
        </button>
      </div>
      {flash && (
        <p className="mt-1.5 truncate text-center text-[11px] text-fitgo-400">
          {flash}
        </p>
      )}
    </div>
  );
}

export function WorkoutTimerDock({
  sheet,
  readOnly,
  circuit,
  blocks,
  onChange,
}: WorkoutTimerDockProps) {
  const [session, setSession] = useState<WorkoutTimerSessionState>(() => ({
    activeBlock: blocks[0]?.id ?? 'strength',
    measureKind: 'block',
    exerciseIndex: 0,
    setIndex: 0,
    rowIndex: 0,
    activityIndex: 0,
    restSec: 90,
    circuitRound: 1,
    circuitStationIndex: 0,
  }));
  const [fullscreen, setFullscreen] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  const [launch, setLaunch] = useState<TimerLaunch>('timer');
  const [flash, setFlash] = useState<string | null>(null);
  const [stuck, setStuck] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const stuckRef = useRef(false);
  const flashTimer = useRef<number | null>(null);

  const applyTarget = useMemo(() => buildApplyTarget(session), [session]);
  const applyLabel = getTimerApplyLabel(applyTarget);
  const hrApplyLabel = getTimerHrApplyLabel(applyTarget);
  const measureOptions = measureOptionsForBlock(session.activeBlock);
  const timerMode =
    launch === 'rest'
      ? 'rest'
      : resolveFullscreenTimerMode(session.activeBlock, session.measureKind);

  const blockLabel =
    session.activeBlock === 'rest'
      ? 'Отдых (силовая)'
      : WORKOUT_SECTION_LABELS[session.activeBlock as WorkoutSectionId] ??
        session.activeBlock;

  const showFlash = useCallback((msg: string) => {
    setFlash(msg);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 2500);
  }, []);

  const applyElapsed = useCallback(
    (sec: number, auto = false) => {
      if (sec <= 0 || readOnly) return;
      const next = applyTimerElapsed(sheet, applyTarget, sec);
      onChange(next);
      showFlash(
        auto
          ? `Авто: ${formatElapsedField(sec)} → ${applyLabel}`
          : `Записано: ${formatElapsedField(sec)} → ${applyLabel}`,
      );
    },
    [applyLabel, applyTarget, onChange, readOnly, sheet, showFlash],
  );

  const applyHeartRate = useCallback(
    (hr: number) => {
      if (hr <= 0 || readOnly || !hrApplyLabel) return;
      const next = applyTimerHeartRate(sheet, applyTarget, hr);
      onChange(next);
      showFlash(`ЧСС ${hr} → ${hrApplyLabel}`);
    },
    [applyTarget, hrApplyLabel, onChange, readOnly, sheet, showFlash],
  );

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const readStuck = (top: number, intersecting: boolean) =>
      intersecting ? false : top < 0;

    const sync = (top: number, intersecting: boolean) => {
      const next = readStuck(top, intersecting);
      if (next === stuckRef.current) return;
      stuckRef.current = next;
      setStuck(next);
    };

    const rect = el.getBoundingClientRect();
    const intersecting =
      rect.top < window.innerHeight && rect.bottom > 0;
    sync(rect.top, intersecting);

    const observer = new IntersectionObserver(
      ([entry]) => sync(entry.boundingClientRect.top, entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    emitWorkoutTimerDockChrome({ atTop: stuck, active: true });
    return () => emitWorkoutTimerDockChrome({ atTop: false, active: false });
  }, [stuck]);

  useEffect(() => {
    const handler = (e: CustomEvent<{ sectionId: WorkoutSectionId }>) => {
      const id = e.detail.sectionId;
      if (!blocks.some((b) => b.id === id)) return;
      setSession((prev) => ({
        ...prev,
        activeBlock: id,
        measureKind: defaultMeasureForBlock(id),
      }));
    };
    window.addEventListener('workout-section-visible', handler as EventListener);
    return () =>
      window.removeEventListener('workout-section-visible', handler as EventListener);
  }, [blocks]);

  const openTimer = () => {
    if (readOnly) return;
    setLaunch('timer');
    setSession((prev) => ({
      ...prev,
      measureKind: defaultMeasureForBlock(prev.activeBlock),
    }));
    setAutoStart(true);
    setFullscreen(true);
  };

  const openRest = () => {
    if (readOnly) return;
    setLaunch('rest');
    setSession((prev) => ({
      ...prev,
      activeBlock: 'rest',
      measureKind: 'set_rest',
    }));
    setAutoStart(true);
    setFullscreen(true);
  };

  const handleClose = () => {
    setFullscreen(false);
    setAutoStart(false);
  };

  const handleRoundRestComplete = (round: number, restElapsed: number) => {
    onChange(applyCircuitRoundRest(sheet, round, restElapsed));
    showFlash(`Отдых круга ${round}: ${restElapsed} сек → журнал`);
  };

  const handleRoundLapComplete = (round: number, workSec: number, hr?: number) => {
    onChange(applyCircuitRoundWork(sheet, round, workSec, hr));
    const hrNote = hr ? `, ЧСС ${hr}` : '';
    showFlash(`Круг ${round}: ${formatElapsedField(workSec)}${hrNote} → журнал`);
    setSession((prev) => ({
      ...prev,
      circuitRound: Math.min(round + 1, circuit?.rounds ?? round + 1),
      heartRate: undefined,
    }));
  };

  if (readOnly || blocks.length === 0) return null;

  return (
    <>
      <div ref={sentinelRef} className="h-px w-full" aria-hidden />
      <TimerBar
        flash={flash}
        stuck={stuck}
        onTimer={openTimer}
        onRest={openRest}
      />

      <WorkoutTimer
        open={fullscreen}
        onClose={handleClose}
        mode={timerMode}
        autoStart={autoStart}
        circuit={circuit}
        defaultRestSec={session.restSec}
        activeBlockLabel={blockLabel}
        measureLabel={applyLabel}
        session={session}
        onSessionChange={setSession}
        blockOptions={blocks}
        sheet={sheet}
        measureOptions={measureOptions}
        onApply={applyElapsed}
        applyLabel={applyLabel}
        onApplyHr={applyHeartRate}
        hrApplyLabel={hrApplyLabel}
        onRoundRestComplete={handleRoundRestComplete}
        onRoundLapComplete={handleRoundLapComplete}
        onRestComplete={(sec) => {
          applyElapsed(sec, true);
        }}
      />
    </>
  );
}

/** Сообщает панели таймера о видимой секции при прокрутке */
export function emitWorkoutSectionVisible(sectionId: WorkoutSectionId) {
  window.dispatchEvent(
    new CustomEvent('workout-section-visible', { detail: { sectionId } }),
  );
}
