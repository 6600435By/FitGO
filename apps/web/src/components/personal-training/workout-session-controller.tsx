'use client';

import type { WorkoutSheet } from '@fitgo/shared-types';
import {
  buildWorkoutSessionPlan,
  markWorkoutSessionStarted,
} from '@fitgo/shared-types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkoutSession } from './use-workout-session';
import { WorkoutSessionBar } from './workout-session-bar';
import { WorkoutSessionOverlay } from './workout-session-overlay';
import { applyTimerFieldDefaults } from './workout-session-field-config';

interface WorkoutSessionControllerProps {
  sheet: WorkoutSheet;
  canStart: boolean;
  onChange: (sheet: WorkoutSheet) => void;
}

export function WorkoutSessionController({
  sheet,
  canStart,
  onChange,
}: WorkoutSessionControllerProps) {
  const [sessionActive, setSessionActive] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [localSheet, setLocalSheet] = useState(sheet);
  const sessionStartedRef = useRef(false);

  const steps = useMemo(() => buildWorkoutSessionPlan(localSheet), [localSheet]);
  const session = useWorkoutSession({ steps, sheet: localSheet });

  useEffect(() => {
    if (!sessionActive) {
      setLocalSheet(sheet);
    }
  }, [sheet, sessionActive]);

  const handleStart = () => {
    const withDefaults = applyTimerFieldDefaults(sheet);
    const started = markWorkoutSessionStarted(withDefaults);
    setLocalSheet(started);
    onChange(started);
    setSessionActive(true);
    setOverlayOpen(true);
  };

  useEffect(() => {
    if (!sessionActive || sessionStartedRef.current) return;
    sessionStartedRef.current = true;
    session.startSession();
  }, [sessionActive, session]);

  const handleMinimize = () => {
    setOverlayOpen(false);
  };

  const handleExpand = () => {
    setOverlayOpen(true);
  };

  const handleSheetChange = (next: WorkoutSheet) => {
    setLocalSheet(next);
    onChange(next);
  };

  const handleSessionEnd = () => {
    setSessionActive(false);
    setOverlayOpen(false);
    sessionStartedRef.current = false;
  };

  const barMode = !canStart && !sessionActive
    ? 'hidden'
    : overlayOpen
      ? 'hidden'
      : sessionActive
        ? 'minimized'
        : 'start';

  return (
    <>
      <WorkoutSessionBar
        mode={barMode}
        session={sessionActive ? session : null}
        onStart={handleStart}
        onExpand={handleExpand}
      />
      {sessionActive && (
        <WorkoutSessionOverlay
          open={overlayOpen}
          sheet={localSheet}
          session={session}
          steps={steps}
          onMinimize={handleMinimize}
          onChange={handleSheetChange}
          onSessionEnd={handleSessionEnd}
        />
      )}
    </>
  );
}
