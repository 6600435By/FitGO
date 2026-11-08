'use client';

import { useCallback, useEffect, useState } from 'react';

/** v2: default work mode is timer (basic live timer must be visible). */
const KEY = 'fitgo.trainer.liveMode.v2';

export type LiveWorkMode = 'free' | 'timer';

export type LiveModePrefs = {
  mode: LiveWorkMode;
  autoRest: boolean;
};

const DEFAULTS: LiveModePrefs = {
  mode: 'timer',
  autoRest: true,
};

function loadPrefs(): LiveModePrefs {
  if (typeof window === 'undefined') return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<LiveModePrefs>;
    return {
      mode: parsed.mode === 'timer' ? 'timer' : 'free',
      autoRest:
        typeof parsed.autoRest === 'boolean'
          ? parsed.autoRest
          : DEFAULTS.autoRest,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function savePrefs(prefs: LiveModePrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

/** Persisted free/timer work mode + auto-rest preference for Forma live. */
export function useLiveMode() {
  const [prefs, setPrefs] = useState<LiveModePrefs>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setPrefs(loadPrefs());
    setHydrated(true);
  }, []);

  const setMode = useCallback((mode: LiveWorkMode) => {
    setPrefs((prev) => {
      const next = { ...prev, mode };
      savePrefs(next);
      return next;
    });
  }, []);

  const setAutoRest = useCallback((autoRest: boolean) => {
    setPrefs((prev) => {
      const next = { ...prev, autoRest };
      savePrefs(next);
      return next;
    });
  }, []);

  return {
    mode: prefs.mode,
    autoRest: prefs.autoRest,
    hydrated,
    setMode,
    setAutoRest,
  };
}
