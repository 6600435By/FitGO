'use client';

import type { AppUsageReport } from '@fitgo/shared-types';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

const ROLE_LABEL: Record<string, string> = {
  TRAINER: 'Тренер',
  SPECIALIST: 'SPA',
  ADMIN: 'Админ',
  MANAGER: 'Управляющий',
  SUPER_ADMIN: 'Супер-админ',
};

function formatMinutes(min: number) {
  if (min <= 0) return '0 мин';
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

function seenLabel(iso: string | null) {
  if (!iso) return 'ещё не входил';
  return formatDateTime(iso);
}

export default function SuperAdminAppUsagePage() {
  const [days, setDays] = useState<7 | 30>(7);
  const [data, setData] = useState<AppUsageReport | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback((period: 7 | 30) => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    setError('');
    api
      .superAdminAppUsage(token, period)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(days);
  }, [days, load]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Приложение</h2>
        <p className="mt-1 hidden text-sm text-slate-400 sm:block">
          Кто из персонала пользуется приложением. Минуты приблизительные: только
          пока вкладка на экране и есть действия за последние 10 минут. Клиенты —
          только счётчики, без списка.
        </p>
      </div>

      <div className="flex gap-2">
        {([7, 30] as const).map((d) => (
          <button
            key={d}
            type="button"
            className={
              days === d
                ? 'rounded-lg bg-fitgo-500/20 px-3 py-1.5 text-sm text-fitgo-300'
                : 'rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:text-white'
            }
            onClick={() => setDays(d)}
          >
            {d} дней
          </button>
        ))}
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {loading && !data ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
        </div>
      ) : null}

      {data ? (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="card !p-3">
              <p className="text-xs text-slate-500">Персонал сейчас</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-fitgo-300">
                {data.staffSummary.onlineNow}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                из {data.staffSummary.total} · сегодня {data.staffSummary.activeToday}
              </p>
            </div>
            <div className="card !p-3">
              <p className="text-xs text-slate-500">Молчат &gt; 7 дней</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-300">
                {data.staffSummary.silent7d}
              </p>
            </div>
            <div className="card !p-3">
              <p className="text-xs text-slate-500">Клиенты</p>
              <p className="mt-1 text-sm text-slate-200">
                Вход:{' '}
                <span className="tabular-nums font-semibold">
                  {data.clients.activeAccounts}
                </span>
              </p>
              <p className="text-sm text-slate-400">
                Ещё не вошли:{' '}
                <span className="tabular-nums">{data.clients.shadowAccounts}</span>
              </p>
              <p className="text-sm text-slate-400">
                Уведомления:{' '}
                <span className="tabular-nums">{data.clients.withPush}</span>
              </p>
            </div>
          </div>

          <ul className="space-y-2">
            {data.staff.map((row) => (
              <li key={row.userId} className="card text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-white">
                    {row.online ? (
                      <span
                        className="mr-2 inline-block h-2 w-2 rounded-full bg-emerald-400"
                        title="Сейчас в приложении"
                      />
                    ) : null}
                    {row.name}
                  </p>
                  <p className="tabular-nums text-fitgo-300">
                    {formatMinutes(row.activeMinutes)}
                  </p>
                </div>
                <p className="mt-1 text-slate-400">
                  {ROLE_LABEL[row.role] ?? row.role}
                  {!row.loginEnabled ? ' · вход закрыт' : null}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Последняя активность: {seenLabel(row.lastSeenAt)}
                </p>
                <p className="text-xs text-slate-500">
                  Последний вход:{' '}
                  {row.lastLoginAt ? formatDateTime(row.lastLoginAt) : '—'}
                </p>
              </li>
            ))}
          </ul>

          {data.staff.length === 0 ? (
            <p className="text-sm text-slate-400">Нет персонала с входом в приложение</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
