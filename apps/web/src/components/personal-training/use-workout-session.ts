'use client';

import type { WorkoutSessionStep } from '@fitgo/shared-types';
import {
  parseDurationTextToSec,
  type SessionStepTiming,
  sessionStepTimingFromSheet,
} from '@fitgo/shared-types';
import type { WorkoutSheet } from '@fitgo/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getStepPlannedRestSec,
  getStepPlannedWorkSec,
} from './workout-session-step-context';

export type WorkoutSessionPhase =
  | 'work'
  | 'rest'
  | 'block_rest'
  | 'block_summary'
  | 'summary';

export interface UseWorkoutSessionOptions {
  steps: WorkoutSessionStep[];
  sheet: WorkoutSheet;
}

export function useWorkoutSession({ steps, sheet }: UseWorkoutSessionOptions) {
  const [stepIndex, setStepIndex] = useState(0);
  const [phase, setPhase] = useState<WorkoutSessionPhase>('work');
  const [running, setRunning] = useState(false);
  const [workElapsed, setWorkElapsed] = useState(0);
  const [planBonusSec, setPlanBonusSec] = useState(0);
  const [restElapsed, setRestElapsed] = useState(0);
  const [restRemaining, setRestRemaining] = useState(0);
  const [restCountdown, setRestCountdown] = useState(false);
  const [blockRestElapsed, setBlockRestElapsed] = useState(0);
  const [blockRests, setBlockRests] = useState<
    Partial<Record<string, number>>
  >({});
  const [timings, setTimings] = useState<SessionStepTiming[]>(() =>
    steps.map((s) => sessionStepTimingFromSheet(s, sheet)),
  );
  const autoAdvanced = useRef(false);

  const stepCount = steps.length;
  const current = steps[stepIndex];
  const isLastStep = stepIndex >= stepCount - 1;
  const plannedWorkSec = current
    ? getStepPlannedWorkSec(sheet, current) ??
      parseDurationTextToSec(
        current.plannedWorkSec != null
          ? String(current.plannedWorkSec)
          : undefined,
      ) ??
      current.plannedWorkSec
    : undefined;

  const effectivePlanSec =
    plannedWorkSec != null ? plannedWorkSec + planBonusSec : undefined;

  const planReached =
    effectivePlanSec != null && workElapsed >= effectivePlanSec;

  const nextBlockLabel = (() => {
    if (!current || phase !== 'block_rest') return null;
    const next = steps[stepIndex + 1];
    return next?.blockLabel ?? null;
  })();

  useEffect(() => {
    setTimings((prev) => {
      if (prev.length === steps.length) return prev;
      return steps.map((s, i) => prev[i] ?? sessionStepTimingFromSheet(s, sheet));
    });
  }, [steps, sheet]);

  const beginWork = useCallback((index: number) => {
    setStepIndex(index);
    setPhase('work');
    setWorkElapsed(0);
    setPlanBonusSec(0);
    setRestElapsed(0);
    setRestRemaining(0);
    setRestCountdown(false);
    setRunning(true);
    autoAdvanced.current = false;
  }, []);

  const startSession = useCallback(() => {
    if (steps.length === 0) return;
    setTimings(steps.map((s) => sessionStepTimingFromSheet(s, sheet)));
    setBlockRests({});
    setBlockRestElapsed(0);
    beginWork(0);
  }, [beginWork, sheet, steps]);

  const finishWork = useCallback(
    (elapsed: number) => {
      setTimings((prev) => {
        const next = [...prev];
        next[stepIndex] = {
          ...next[stepIndex],
          actualWorkSec: elapsed,
          skipped: elapsed <= 0,
        };
        return next;
      });

      const step = steps[stepIndex];
      if (!step) return;

      if (step.isLastInBlock) {
        setPhase('block_summary');
        setRunning(false);
        return;
      }

      const restPlan = getStepPlannedRestSec(sheet, step) ?? step.plannedRestSec;
      if (restPlan != null && restPlan > 0) {
        setPhase('rest');
        setRestElapsed(0);
        setRestRemaining(restPlan);
        setRestCountdown(true);
        setRunning(true);
      } else {
        setPhase('rest');
        setRestElapsed(0);
        setRestCountdown(false);
        setRunning(true);
      }
    },
    [stepIndex, steps, sheet],
  );

  const continueFromBlockSummary = useCallback(() => {
    const step = steps[stepIndex];
    if (!step) return;
    if (step.isLastInWorkout) {
      setPhase('summary');
      setRunning(false);
      return;
    }
    setPhase('block_rest');
    setBlockRestElapsed(0);
    setRunning(true);
    autoAdvanced.current = false;
  }, [stepIndex, steps]);

  const commitRest = useCallback(() => {
    setTimings((prev) => {
      const next = [...prev];
      next[stepIndex] = {
        ...next[stepIndex],
        actualRestAfterSec: restElapsed,
      };
      return next;
    });
  }, [restElapsed, stepIndex]);

  const goNextStep = useCallback(() => {
    commitRest();
    beginWork(stepIndex + 1);
  }, [beginWork, commitRest, stepIndex]);

  const goNextBlock = useCallback(() => {
    const step = steps[stepIndex];
    if (step) {
      setBlockRests((prev) => ({
        ...prev,
        [step.blockId]: blockRestElapsed,
      }));
    }
    beginWork(stepIndex + 1);
  }, [beginWork, blockRestElapsed, stepIndex, steps]);

  const togglePause = useCallback(() => {
    setRunning((prev) => !prev);
  }, []);

  const primaryAction = useCallback(() => {
    if (phase === 'work') {
      finishWork(Math.max(workElapsed, 1));
    } else if (phase === 'rest') {
      goNextStep();
    } else if (phase === 'block_rest') {
      goNextBlock();
    } else if (phase === 'block_summary') {
      continueFromBlockSummary();
    }
  }, [
    continueFromBlockSummary,
    finishWork,
    goNextBlock,
    goNextStep,
    phase,
    workElapsed,
  ]);

  const openSummary = useCallback(() => {
    if (phase === 'rest') commitRest();
    if (phase === 'work') finishWork(Math.max(workElapsed, 0));
    if (phase === 'block_rest') {
      const step = steps[stepIndex];
      if (step) {
        setBlockRests((prev) => ({
          ...prev,
          [step.blockId]: blockRestElapsed,
        }));
      }
    }
    setPhase('summary');
    setRunning(false);
  }, [
    blockRestElapsed,
    commitRest,
    finishWork,
    phase,
    stepIndex,
    steps,
    workElapsed,
  ]);

  const extendPlan = useCallback(
    (delta: number) => {
      if (phase !== 'work' || effectivePlanSec == null) return;
      setPlanBonusSec((v) => v + delta);
    },
    [effectivePlanSec, phase],
  );

  useEffect(() => {
    if (!running || phase !== 'rest' || !restCountdown || restRemaining > 0) return;
    if (autoAdvanced.current) return;
    autoAdvanced.current = true;
    goNextStep();
  }, [goNextStep, phase, restCountdown, restRemaining, running]);

  useEffect(() => {
    if (!running) return;

    const id = window.setInterval(() => {
      if (phase === 'work') {
        setWorkElapsed((v) => v + 1);
      } else if (phase === 'rest') {
        if (restCountdown) {
          setRestRemaining((prev) => (prev > 0 ? prev - 1 : 0));
        }
        setRestElapsed((v) => v + 1);
      } else if (phase === 'block_rest') {
        setBlockRestElapsed((v) => v + 1);
      }
    }, 1000);

    return () => window.clearInterval(id);
  }, [phase, restCountdown, running]);

  const displaySec =
    phase === 'work'
      ? effectivePlanSec != null && !planReached
        ? effectivePlanSec - workElapsed
        : workElapsed
      : phase === 'rest'
        ? restCountdown
          ? restRemaining
          : restElapsed
        : phase === 'block_rest'
          ? blockRestElapsed
          : 0;

  const primaryLabel =
    phase === 'work'
      ? 'Готово'
      : phase === 'rest'
        ? 'Далее'
        : phase === 'block_rest'
          ? nextBlockLabel
            ? `Следующий блок: ${nextBlockLabel}`
            : 'Следующий блок'
          : phase === 'block_summary'
            ? current?.isLastInWorkout
              ? 'К итогу тренировки'
              : 'К отдыху между блоками'
            : '';

  return {
    stepIndex,
    stepCount,
    current,
    phase,
    running,
    displaySec,
    workElapsed,
    effectivePlanSec,
    planReached,
    isLastStep,
    timings,
    blockRestElapsed,
    blockRests,
    primaryLabel,
    restCountdown,
    startSession,
    togglePause,
    primaryAction,
    openSummary,
    extendPlan,
    continueFromBlockSummary,
    setSummaryTimings: setTimings,
    setBlockRests,
  };
}
