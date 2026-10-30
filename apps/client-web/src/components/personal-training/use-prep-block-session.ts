'use client';

import type { PrepActivityRow } from '@fitgo/shared-types';
import {
  parseDurationTextToSec,
  type PrepStepTiming,
  prepStepTimingFromRow,
} from '@fitgo/shared-types';
import { useCallback, useEffect, useState } from 'react';

export type PrepSessionPhase = 'work' | 'rest' | 'block_rest' | 'summary';

export interface UsePrepBlockSessionOptions {
  activities: PrepActivityRow[];
  onActivitiesChange: (activities: PrepActivityRow[]) => void;
}

function emptyTimings(count: number): PrepStepTiming[] {
  return Array.from({ length: count }, () => ({
    actualWorkSec: 0,
    actualRestAfterSec: 0,
  }));
}

export function usePrepBlockSession({
  activities,
  onActivitiesChange,
}: UsePrepBlockSessionOptions) {
  const [stepIndex, setStepIndex] = useState(0);
  const [phase, setPhase] = useState<PrepSessionPhase>('work');
  const [running, setRunning] = useState(false);
  const [workElapsed, setWorkElapsed] = useState(0);
  const [planBonusSec, setPlanBonusSec] = useState(0);
  const [restElapsed, setRestElapsed] = useState(0);
  const [blockRestElapsed, setBlockRestElapsed] = useState(0);
  const [timings, setTimings] = useState<PrepStepTiming[]>(() =>
    activities.map((row) => prepStepTimingFromRow(row)),
  );

  const stepCount = activities.length;
  const current = activities[stepIndex];
  const isLastStep = stepIndex >= stepCount - 1;
  const plannedWorkSec = parseDurationTextToSec(current?.duration);
  const effectivePlanSec =
    plannedWorkSec != null ? plannedWorkSec + planBonusSec : undefined;
  const planReached =
    effectivePlanSec != null && workElapsed >= effectivePlanSec;

  useEffect(() => {
    setTimings((prev) => {
      if (prev.length === activities.length) return prev;
      const next = emptyTimings(activities.length);
      for (let i = 0; i < Math.min(prev.length, activities.length); i++) {
        next[i] = prev[i];
      }
      return next;
    });
  }, [activities.length]);

  const beginWork = useCallback(
    (index: number) => {
      setStepIndex(index);
      setPhase('work');
      setWorkElapsed(0);
      setPlanBonusSec(0);
      setRestElapsed(0);
      setRunning(true);
    },
    [],
  );

  const startSession = useCallback(() => {
    if (activities.length === 0) return;
    setTimings(activities.map((row) => prepStepTimingFromRow(row)));
    setBlockRestElapsed(0);
    beginWork(0);
  }, [activities, beginWork]);

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
      setPhase('rest');
      setRestElapsed(0);
      setRunning(true);
    },
    [stepIndex],
  );

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
    if (isLastStep) {
      setPhase('block_rest');
      setBlockRestElapsed(0);
      setRunning(true);
      return;
    }
    beginWork(stepIndex + 1);
  }, [beginWork, commitRest, isLastStep, stepIndex]);

  const togglePause = useCallback(() => {
    setRunning((prev) => !prev);
  }, []);

  const completeStep = useCallback(() => {
    if (phase === 'work') {
      finishWork(Math.max(workElapsed, 1));
      return;
    }
    if (phase === 'rest') {
      goNextStep();
    }
  }, [finishWork, goNextStep, phase, workElapsed]);

  const openSummary = useCallback(() => {
    if (phase === 'rest') commitRest();
    if (phase === 'work') finishWork(Math.max(workElapsed, 0));
    setPhase('summary');
    setRunning(false);
  }, [commitRest, finishWork, phase, workElapsed]);

  const extendPlan = useCallback(
    (delta: number) => {
      if (phase !== 'work' || effectivePlanSec == null) return;
      setPlanBonusSec((v) => v + delta);
    },
    [effectivePlanSec, phase],
  );

  const addStep = useCallback(() => {
    onActivitiesChange([
      ...activities,
      { type: '', duration: '', zone: '', rpe: '', notes: '' },
    ]);
  }, [activities, onActivitiesChange]);

  const updateStep = useCallback(
    (index: number, patch: Partial<PrepActivityRow>) => {
      onActivitiesChange(
        activities.map((row, i) => (i === index ? { ...row, ...patch } : row)),
      );
    },
    [activities, onActivitiesChange],
  );

  useEffect(() => {
    if (!running) return;

    const id = window.setInterval(() => {
      if (phase === 'work') {
        setWorkElapsed((v) => v + 1);
      } else if (phase === 'rest') {
        setRestElapsed((v) => v + 1);
      } else if (phase === 'block_rest') {
        setBlockRestElapsed((v) => v + 1);
      }
    }, 1000);

    return () => window.clearInterval(id);
  }, [phase, running]);

  const displaySec =
    phase === 'work'
      ? effectivePlanSec != null && !planReached
        ? effectivePlanSec - workElapsed
        : workElapsed
      : phase === 'rest'
        ? restElapsed
        : phase === 'block_rest'
          ? blockRestElapsed
          : 0;

  return {
    stepIndex,
    stepCount,
    current,
    phase,
    running,
    displaySec,
    workElapsed,
    plannedWorkSec,
    effectivePlanSec,
    planReached,
    isLastStep,
    timings,
    blockRestElapsed,
    startSession,
    setRunning,
    setPhase,
    setBlockRestElapsed,
    togglePause,
    completeStep,
    goNextStep,
    openSummary,
    extendPlan,
    addStep,
    updateStep,
    setSummaryTimings: setTimings,
  };
}
