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
  /** Override: show refresh (default: admin / manager / super-admin). */
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

const REFRESH_ROLES: ReadonlySet<UserRole> = new Set([
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
  UserRole.MANAGER,
]);

const OPS_ROLES: ReadonlySet<UserRole> = new Set([
  UserRole.SUPER_ADMIN,
  UserRole.MANAGER,
]);

/** Compact refresh control — same height as the «Данные на …» line. */
function RefreshButton({
  busy,
  running,
  inNightWindow,
  cd,
  hint,
  onClick,
}: {
  busy: boolean;
  running: boolean;
  inNightWindow: boolean;
  cd: string | null;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={hint}
      disabled={busy || running || Boolean(cd) || inNightWindow}
      onClick={onClick}
      className="btn-secondary ml-auto inline-flex h-5 shrink-0 items-center !px-2 !py-0 text-[11px] leading-none"
    >
      {busy || running
        ? 'Обновление…'
        : inNightWindow
          ? 'Ночная выгрузка'
          : cd
            ? cd
            : 'Обновить из 1С'}
    </button>
  );
}

export function DataFreshness({
  canRefresh: canRefreshProp,
  onSynced,
  className = '',
}: Props) {
  const user = getUser();
  /** Hint / lastError / sourceLabel: super-admin and manager only. */
  const isOps = Boolean(user?.roles?.some((r) => OPS_ROLES.has(r)));
  const canRefresh =
    canRefreshProp ??
    Boolean(user?.roles?.some((r) => REFRESH_ROLES.has(r)));

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
      if (isOps || canRefresh) {
        setErr(e instanceof Error ? e.message : 'Не удалось загрузить статус');
      }
      return null;
    }
  }, [isOps, canRefresh]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!status?.running || !canRefresh) return;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void (async () => {
        const s = await load();
        if (s && !s.running) {
          onSynced?.();
        }
      })();
    }, 5000);
    return () => clearInterval(id);
  }, [status?.running, load, onSynced, canRefresh]);

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
  const hint = 'Только сегодня (±1 день). Прошлые дни — ночью 03–04.';

  // Trainer / specialist / tech: date only.
  if (!canRefresh && !isOps) {
    return (
      <div className={`card !px-2 !py-1 text-xs leading-tight ${className}`}>
        <span className={`font-medium ${freshnessColor}`}>{dataLabel}</span>
      </div>
    );
  }

  // Desk admin: same compact date line + refresh button (no hint / no lastError).
  if (canRefresh && !isOps) {
    return (
      <div
        className={`card !px-2 !py-1 text-xs leading-tight ${className}`}
      >
        <div className="flex items-center gap-2">
          <span className={`min-w-0 font-medium ${freshnessColor}`}>
            {dataLabel}
          </span>
          {status?.running ? (
            <span className="text-sky-700">Идёт обновление…</span>
          ) : null}
          <RefreshButton
            busy={busy}
            running={Boolean(status?.running)}
            inNightWindow={Boolean(status?.inNightWindow)}
            cd={cd}
            hint={hint}
            onClick={() => void refresh()}
          />
        </div>
        {err ? (
          <p className="mt-0.5 text-[11px] text-red-600">
            {formatSyncError(err)}
          </p>
        ) : null}
      </div>
    );
  }

  // Super-admin / manager: date + ops details + compact button.
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
          <RefreshButton
            busy={busy}
            running={Boolean(status?.running)}
            inNightWindow={Boolean(status?.inNightWindow)}
            cd={cd}
            hint={hint}
            onClick={() => void refresh()}
          />
        ) : null}
      </div>
      <p
        className="mt-0.5 text-[10px] leading-snug text-[var(--fg-muted)]"
        title="Нажимайте, если в 1С только что прошла оплата или запись, а здесь её нет."
      >
        {hint}
      </p>
      {err ? (
        <p className="mt-0.5 text-[11px] text-red-600">{formatSyncError(err)}</p>
      ) : null}
      {status?.lastError ? (
        <p className="mt-0.5 break-words text-[11px] text-red-600">
          Ошибка: {formatSyncError(status.lastError)}
        </p>
      ) : null}
    </div>
  );
}
