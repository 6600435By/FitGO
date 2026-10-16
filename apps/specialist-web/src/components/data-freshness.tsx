'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

type ClubSyncStatus = {
  dataAsOf: string | null;
  freshness: 'green' | 'yellow' | 'red';
  sourceLabel: string | null;
  running: {
    startedAt: string;
    triggeredByName: string | null;
    trigger: string;
  } | null;
};

export function DataFreshness({ className = '' }: { className?: string }) {
  const [status, setStatus] = useState<ClubSyncStatus | null>(null);

  const load = useCallback(async () => {
    const token = getToken();
    if (!token) return null;
    try {
      const s = await api.getStaffSyncStatus(token);
      setStatus(s);
      return s;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll for all roles: 5s while sync runs, 20s idle. Refresh on tab focus.
  useEffect(() => {
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void load();
    };
    const intervalMs = status?.running ? 5000 : 20_000;
    const id = setInterval(tick, intervalMs);
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        tick();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [status?.running, load]);

  const color =
    status?.freshness === 'green'
      ? 'text-emerald-700'
      : status?.freshness === 'yellow'
        ? 'text-amber-700'
        : 'text-red-700';

  return (
    <div className={`panel !p-3 text-sm ${className}`}>
      <span className={`font-medium ${color}`}>
        {status?.dataAsOf
          ? `Данные на ${status.dataAsOf}`
          : 'Данные ещё не загружены из 1С'}
      </span>
      {status?.sourceLabel ? (
        <span className="ml-2" style={{ color: 'var(--muted)' }}>
          · {status.sourceLabel}
        </span>
      ) : null}
      {status?.running ? (
        <span className="ml-2 text-sky-700">Идёт обновление…</span>
      ) : null}
    </div>
  );
}
