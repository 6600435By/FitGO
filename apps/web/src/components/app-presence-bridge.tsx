'use client';

import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

const PING_MS = 15 * 60 * 1000;
const IDLE_MS = 10 * 60 * 1000;
const CHECK_MS = 60 * 1000;

/**
 * Staff-only presence: pings /auth/presence at most every 15 min when
 * the tab is visible AND the user interacted within the last 10 min.
 * Idle open tabs do not hit the server. Does not log out / revoke JWT.
 */
export function AppPresenceBridge() {
  const lastInteractAt = useRef(Date.now());
  const lastPingAt = useRef(0);

  useEffect(() => {
    const mark = () => {
      lastInteractAt.current = Date.now();
    };
    const opts: AddEventListenerOptions = { passive: true };
    window.addEventListener('pointerdown', mark, opts);
    window.addEventListener('keydown', mark, opts);
    window.addEventListener('scroll', mark, opts);
    window.addEventListener('touchstart', mark, opts);

    const maybePing = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      const now = Date.now();
      if (now - lastInteractAt.current > IDLE_MS) return;
      if (now - lastPingAt.current < PING_MS) return;
      const token = getToken();
      if (!token) return;
      lastPingAt.current = now;
      void api.authPresence(token).catch(() => {
        // Presence must never break the app shell.
      });
    };

    maybePing();
    const timer = window.setInterval(maybePing, CHECK_MS);
    const onVis = () => {
      if (document.visibilityState === 'visible') maybePing();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointerdown', mark);
      window.removeEventListener('keydown', mark);
      window.removeEventListener('scroll', mark);
      window.removeEventListener('touchstart', mark);
    };
  }, []);

  return null;
}
