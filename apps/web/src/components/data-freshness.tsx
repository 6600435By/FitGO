'use client';

import { useCallback, useEffect, useState } from 'react';
import { UserRole } from '@fitgo/shared-types';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';

export type ClubSyncStatus = {
  dataAsOf: string | null;
  dataAsOfIso: string | null;
  freshness: 'green' | 'yellow' | 'red';
  sourceLabel: string | null;
  running: {
    runId: string;
    startedAt: string;
    triggeredByName: string | null;
    trigger: string;
  } | null;
  cooldownUntil: string | null;
  inNightWindow: boolean;
  lastError: string | null;
};

type Props = {
  /** Override: show refresh for admins (default: auto from roles). */
  canRefresh?: boolean;
  onSynced?: () => void;
  className?: string;
};

function formatTime(iso: string) {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

function cooldownLeft(until: string | null): string | null {
  if (!until) return null;
  const ms = new Date(until).getTime() - Date.now();
  if (ms <= 0) return null;
  const min = Math.ceil(ms / 60_000);
  return `Можно через ${min} мин`;
}

export function DataFreshness({
  canRefresh: canRefreshProp,
  onSynced,
  className = '',
}: Props) {
  const user = getUser();
  const canRefresh =
    canRefreshProp ??
    Boolean(
      user?.roles?.some((r) =>
        [UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER].includes(r),
      ),
    );

  const [status, setStatus] = useState<ClubSyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = getToken();
    if (!token) return null;
    try {
      const s = await api.getStaffSyncStatus(token);
      setStatus(s);
      setErr(null);
      return s;
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось загрузить статус');
      return null;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!status?.running) return;
    const id = setInterval(() => {
      void (async () => {
        const s = await load();
        if (s && !s.running) {
          onSynced?.();
        }
      })();
    }, 5000);
    return () => clearInterval(id);
  }, [status?.running, load, onSynced]);

  const refresh = async () => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await api.postStaffSyncRefresh(token);
      setStatus(res);
      if (res.status === 'cooldown') {
        setErr(
          res.reason === 'night_window'
            ? 'Идёт ночная выгрузка (03:00–04:00)'
            : cooldownLeft(res.cooldownUntil) ||
                'Подождите перед следующим обновлением',
        );
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка обновления');
    } finally {
      setBusy(false);
      void load();
    }
  };

  const freshnessColor =
    status?.freshness === 'green'
      ? 'text-emerald-700'
      : status?.freshness === 'yellow'
        ? 'text-amber-700'
        : 'text-red-700';

  const cd = cooldownLeft(status?.cooldownUntil ?? null);

  return (
    <div className={`card !p-3 text-sm ${className}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`font-medium ${freshnessColor}`}>
          {status?.dataAsOf
            ? `Данные на ${status.dataAsOf}`
            : 'Данные ещё не загружены из 1С'}
        </span>
        {status?.sourceLabel ? (
          <span className="text-[var(--fg-muted)]">· {status.sourceLabel}</span>
        ) : null}
        {status?.running ? (
          <span className="text-sky-700">
            Идёт обновление…
            {status.running.triggeredByName
              ? ` (начал ${status.running.triggeredByName} в ${formatTime(status.running.startedAt)})`
              : status.running.trigger === 'NIGHTLY'
                ? ' (ночная выгрузка)'
                : ''}
          </span>
        ) : null}
        {canRefresh ? (
          <button
            type="button"
            disabled={
              busy ||
              Boolean(status?.running) ||
              Boolean(cd) ||
              Boolean(status?.inNightWindow)
            }
            onClick={() => void refresh()}
            className="btn-secondary ml-auto !px-3 !py-1 text-xs"
          >
            {busy || status?.running
              ? 'Обновление…'
              : status?.inNightWindow
                ? 'Идёт ночная выгрузка'
                : cd
                  ? cd
                  : 'Обновить из 1С'}
          </button>
        ) : null}
      </div>
      {canRefresh ? (
        <p className="mt-1 text-xs text-[var(--fg-muted)]">
          Нажимайте, только если в 1С за стойкой только что прошла оплата, запись
          или посещение, а здесь его нет. Записи и отметки, сделанные в FitGO,
          видны сразу.
        </p>
      ) : null}
      {err ? <p className="mt-1 text-xs text-red-600">{err}</p> : null}
      {status?.lastError && canRefresh ? (
        <p className="mt-1 text-xs text-red-600">
          Последняя ошибка: {status.lastError}
        </p>
      ) : null}
    </div>
  );
}
