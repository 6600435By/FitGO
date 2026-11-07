'use client';

import { useCallback, useEffect, useState } from 'react';

const PREFIX = 'fitgo.sessionClock.v1:';

function storageKey(sessionKey: string): string {
  return `${PREFIX}${sessionKey}`;
}

function loadStartedAt(sessionKey: string): number | null {
  if (typeof window === 'undefined' || !sessionKey) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(sessionKey));
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function saveStartedAt(sessionKey: string, startedAt: number): void {
  if (typeof window === 'undefined' || !sessionKey) return;
  try {
    window.localStorage.setItem(storageKey(sessionKey), String(startedAt));
  } catch {
    /* ignore */
  }
}

export function clearSessionClock(sessionKey: string): void {
  if (typeof window === 'undefined' || !sessionKey) return;
  try {
    window.localStorage.removeItem(storageKey(sessionKey));
  } catch {
    /* ignore */
  }
}

/**
 * Background session duration for live workout.
 * Starts on first `markActive()` (set check / timer start), persists by session key.
 */
export function useSessionClock(sessionKey: string) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!sessionKey) return;
    const saved = loadStartedAt(sessionKey);
    setStartedAt(saved);
    setElapsedMs(saved ? Math.max(0, Date.now() - saved) : 0);
  }, [sessionKey]);

  useEffect(() => {
    if (startedAt == null) return;
    const tick = () => setElapsedMs(Math.max(0, Date.now() - startedAt));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  const markActive = useCallback(() => {
    if (!sessionKey) return;
    setStartedAt((prev) => {
      if (prev != null) return prev;
      const now = Date.now();
      saveStartedAt(sessionKey, now);
      return now;
    });
  }, [sessionKey]);

  const clear = useCallback(() => {
    if (sessionKey) clearSessionClock(sessionKey);
    setStartedAt(null);
    setElapsedMs(0);
  }, [sessionKey]);

  return { elapsedMs, startedAt, markActive, clear, isRunning: startedAt != null };
}
