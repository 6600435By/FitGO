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
  /** Override: show refresh for ops (default: auto from roles). */
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
  return `Через ${min} мин`;
}

/** Bare Forma/WP codes were stored as "1025" before message formatting. */
function formatSyncError(raw: string): string {
  const t = raw.trim();
  if (/^\d{3,5}$/.test(t)) return `Forma/WP ошибка ${t}`;
  if (/^[\w.]+:\s*\d{3,5}$/.test(t)) {
    const [step, code] = t.split(/:\s*/);
    return `${step}: Forma/WP ошибка ${code}`;
  }
  return raw;
}

export function DataFreshness({
  canRefresh: canRefreshProp,
  onSynced,
  className = '',
}: Props) {
  const user = getUser();
  /** Full banner (hint / errors / refresh): only super-admin and manager. */
  const isOps =
    Boolean(
      user?.roles?.some((r) =>
        [UserRole.SUPER_ADMIN, UserRole.MANAGER].includes(r),
      ),
    );
  const canRefresh = canRefreshProp ?? isOps;

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
      if (isOps) {
        setErr(e instanceof Error ? e.message : 'Не удалось загрузить статус');
      }
      return null;
    }
  }, [isOps]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!status?.running || !isOps) return;
    const id = setInterval(() => {
      void (async () => {
        const s = await load();
        if (s && !s.running) {
          onSynced?.();
        }
      })();
    }, 5000);
    return () => clearInterval(id);
  }, [status?.running, load, onSynced, isOps]);

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
            ? 'Ночная выгрузка (03–04)'
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
  const dataLabel = status?.dataAsOf
    ? `Данные на ${status.dataAsOf}`
    : 'Данные ещё не загружены из 1С';

  // Staff (admin / trainer / spa / …): one line only.
  if (!isOps && !canRefreshProp) {
    return (
      <div
        className={`card !px-2 !py-1 text-xs leading-tight ${className}`}
      >
        <span className={`font-medium ${freshnessColor}`}>{dataLabel}</span>
      </div>
    );
  }

  const hint = 'Только сегодня (±1 день). Прошлые дни — ночью 03–04.';

  return (
    <div className={`card !px-2 !py-1.5 text-xs leading-tight ${className}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className={`font-medium ${freshnessColor}`}>{dataLabel}</span>
        {status?.sourceLabel ? (
          <span className="text-[var(--fg-muted)]">· {status.sourceLabel}</span>
        ) : null}
        {status?.running ? (
          <span className="text-sky-700">
            Идёт обновление…
            {status.running.triggeredByName
              ? ` (${status.running.triggeredByName}, ${formatTime(status.running.startedAt)})`
              : status.running.trigger === 'NIGHTLY'
                ? ' (ночь)'
                : ''}
          </span>
        ) : null}
        {canRefresh ? (
          <button
            type="button"
            title={hint}
            disabled={
              busy ||
              Boolean(status?.running) ||
              Boolean(cd) ||
              Boolean(status?.inNightWindow)
            }
            onClick={() => void refresh()}
            className="btn-secondary ml-auto !px-2 !py-0.5 text-[11px]"
          >
            {busy || status?.running
              ? 'Обновление…'
              : status?.inNightWindow
                ? 'Ночная выгрузка'
                : cd
                  ? cd
                  : 'Обновить из 1С'}
          </button>
        ) : null}
      </div>
      {canRefresh ? (
        <p
          className="mt-0.5 text-[10px] leading-snug text-[var(--fg-muted)]"
          title="Нажимайте, если в 1С только что прошла оплата или запись, а здесь её нет."
        >
          {hint}
        </p>
      ) : null}
      {err ? (
        <p className="mt-0.5 text-[11px] text-red-600">{formatSyncError(err)}</p>
      ) : null}
      {status?.lastError && canRefresh ? (
        <p className="mt-0.5 break-words text-[11px] text-red-600">
          Ошибка: {formatSyncError(status.lastError)}
        </p>
      ) : null}
    </div>
  );
}
