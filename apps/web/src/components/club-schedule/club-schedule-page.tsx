'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format, addDays, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { ClubScheduleEvent } from '@fitgo/shared-types';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

const TYPE_LABEL: Record<string, string> = {
  GROUP: 'ГП',
  PT: 'ПТ',
  SPA: 'SPA',
  DUTY: 'Дежурство',
};

const TYPE_CLASS: Record<string, string> = {
  GROUP: 'border-l-fitgo-500',
  PT: 'border-l-violet-500',
  SPA: 'border-l-amber-500',
  DUTY: 'border-l-slate-500',
};

function isPendingPhase(phase: string | undefined): boolean {
  return (
    phase === 'PENDING_ADMIN' ||
    phase === 'PENDING_TRAINER' ||
    phase === 'PENDING_PERFORMER'
  );
}

export function ClubSchedulePage({
  apiBase,
}: {
  apiBase: 'admin' | 'super-admin';
}) {
  const router = useRouter();
  const [day, setDay] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [types, setTypes] = useState('GROUP,PT,SPA');
  const [events, setEvents] = useState<ClubScheduleEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingOnly, setPendingOnly] = useState(false);

  const maxDay = useMemo(
    () => format(addDays(new Date(), 31), 'yyyy-MM-dd'),
    [],
  );
  const minDay = useMemo(
    () => format(addDays(new Date(), -31), 'yyyy-MM-dd'),
    [],
  );

  const load = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const list = await api.adminClubSchedule(token, apiBase, {
        from: day,
        to: day,
        types,
      });
      setEvents(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [apiBase, day, types]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingCount = events.filter((e) =>
    isPendingPhase(e.approvalPhase),
  ).length;

  const sorted = useMemo(() => {
    const base = [...events].sort(
      (a, b) =>
        new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
    );
    if (!pendingOnly) return base;
    return base.filter((e) => isPendingPhase(e.approvalPhase));
  }, [events, pendingOnly]);

  const openEvent = (ev: ClubScheduleEvent) => {
    if (!ev.sessionKey) return;
    const eventDay = format(parseISO(ev.startAt), 'yyyy-MM-dd');
    const q = new URLSearchParams({
      sessionKey: ev.sessionKey,
      from: eventDay,
      to: eventDay,
    });
    router.push(`/${apiBase}/booking-control?${q.toString()}`);
  };

  const shiftDay = (delta: number) => {
    const next = format(addDays(parseISO(day), delta), 'yyyy-MM-dd');
    if (next < minDay || next > maxDay) return;
    setDay(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <h1 className="text-xl font-semibold text-slate-100">Расписание</h1>
        <div className="flex gap-2 items-center">
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => shiftDay(-1)}
            disabled={day <= minDay}
          >
            ‹
          </button>
          <input
            type="date"
            className="input date-field text-sm"
            value={day}
            min={minDay}
            max={maxDay}
            onChange={(e) => {
              const v = e.target.value;
              if (v >= minDay && v <= maxDay) setDay(v);
            }}
          />
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => setDay(format(new Date(), 'yyyy-MM-dd'))}
          >
            Сегодня
          </button>
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => shiftDay(1)}
            disabled={day >= maxDay}
          >
            ›
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['GROUP,PT,SPA', 'Все'],
            ['GROUP', 'ГП'],
            ['PT', 'ПТ'],
            ['SPA', 'SPA'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={
              types === value
                ? 'btn-primary text-xs'
                : 'btn-secondary text-xs'
            }
            onClick={() => setTypes(value)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className={
            pendingOnly ? 'btn-primary text-xs' : 'btn-secondary text-xs'
          }
          onClick={() => setPendingOnly((v) => !v)}
        >
          Ждут подтверждения{pendingCount ? ` ${pendingCount}` : ''}
        </button>
      </div>

      <p className="text-sm text-slate-400">
        {format(parseISO(`${day}T12:00:00`), 'EEEE, d MMMM yyyy', {
          locale: ru,
        })}
        <span className="ml-2 text-slate-600">
          · можно листать до {format(parseISO(`${maxDay}T12:00:00`), 'd MMM', { locale: ru })}
        </span>
      </p>

      {error && (
        <p className="text-sm text-red-400 bg-red-950/40 rounded-xl px-3 py-2">
          {error}
        </p>
      )}
      {loading && <p className="text-sm text-slate-500">Загрузка…</p>}
      {!loading && !sorted.length && (
        <p className="card text-sm text-slate-500">Нет событий за день</p>
      )}

      <ul className="space-y-2">
        {sorted.map((ev) => {
          const clickable = Boolean(ev.sessionKey);
          return (
            <li key={`${ev.type}-${ev.id}`}>
              <button
                type="button"
                disabled={!clickable}
                onClick={() => openEvent(ev)}
                className={`card border-l-4 w-full text-left transition ${
                  TYPE_CLASS[ev.type] ?? 'border-l-slate-600'
                } ${
                  clickable
                    ? 'hover:border-fitgo-500/50 hover:bg-slate-900/60 cursor-pointer'
                    : 'cursor-default opacity-90'
                }`}
              >
                <div className="flex justify-between gap-2">
                  <div>
                    <p className="text-xs text-slate-500">
                      {TYPE_LABEL[ev.type] ?? ev.type}
                      {ev.staffName ? ` · ${ev.staffName}` : ''}
                    </p>
                    <p className="font-medium text-slate-100 mt-0.5">
                      {format(parseISO(ev.startAt), 'HH:mm')}–
                      {format(parseISO(ev.endAt), 'HH:mm')} · {ev.title}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      {ev.clientName ? `${ev.clientName} · ` : ''}
                      {ev.booked != null
                        ? `записано ${ev.booked}${ev.capacity ? `/${ev.capacity}` : ''} · `
                        : ''}
                      {ev.approvalLabel || ev.status}
                      {ev.payrollLocked ? ' · ЗП закрыт' : ''}
                      {clickable ? ' · открыть →' : ''}
                    </p>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
