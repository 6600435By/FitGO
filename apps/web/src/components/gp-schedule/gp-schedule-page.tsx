'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { format, addDays, startOfWeek, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { GpScheduleEvent } from '@fitgo/shared-types';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

function dayKey(iso: string) {
  return format(parseISO(iso), 'yyyy-MM-dd');
}

function statusChip(ev: GpScheduleEvent) {
  if (ev.status === 'cancelled') {
    return (
      <span className="text-xs text-slate-500 line-through">Отменено</span>
    );
  }
  if (ev.payrollLocked) {
    return (
      <span className="text-xs text-emerald-400 border border-emerald-700 rounded-lg px-2 py-0.5">
        В ЗП
      </span>
    );
  }
  if (ev.approvalPhase === 'PENDING_TRAINER') {
    return (
      <span className="text-xs text-amber-300 border border-amber-700 rounded-lg px-2 py-0.5">
        Ждёт вас
      </span>
    );
  }
  if (ev.approvalPhase === 'PENDING_ADMIN') {
    return (
      <span className="text-xs text-sky-300 border border-sky-700 rounded-lg px-2 py-0.5">
        У админа
      </span>
    );
  }
  if (ev.approvalPhase === 'APPROVED') {
    return (
      <span className="text-xs text-emerald-300 border border-emerald-800 rounded-lg px-2 py-0.5">
        Подтверждено
      </span>
    );
  }
  return (
    <span className="text-xs text-slate-400">
      {ev.status === 'done' ? 'Выполнено' : 'Запланировано'}
    </span>
  );
}

export function GpSchedulePage() {
  const [anchor, setAnchor] = useState(() => new Date());
  const [events, setEvents] = useState<GpScheduleEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const from = format(addDays(anchor, -7), 'yyyy-MM-dd');
  const to = format(addDays(anchor, 21), 'yyyy-MM-dd');

  const load = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setEvents(await api.trainerGpSchedule(token, from, to));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const byDay = useMemo(() => {
    const map = new Map<string, GpScheduleEvent[]>();
    for (const ev of events) {
      const k = dayKey(ev.startAt);
      const list = map.get(k) ?? [];
      list.push(ev);
      map.set(k, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [events]);

  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <h1 className="text-xl font-semibold text-slate-100">Мое расписание</h1>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => setAnchor(addDays(weekStart, -7))}
          >
            ‹ Неделя
          </button>
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => setAnchor(new Date())}
          >
            Сегодня
          </button>
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => setAnchor(addDays(weekStart, 7))}
          >
            Неделя ›
          </button>
        </div>
      </div>
      <p className="text-sm text-slate-400">
        Занятия ГП из 1С · {from} — {to}
      </p>

      {error && (
        <p className="text-sm text-red-400 bg-red-950/40 rounded-xl px-3 py-2">
          {error}
        </p>
      )}
      {loading && <p className="text-sm text-slate-500">Загрузка…</p>}
      {!loading && !byDay.length && (
        <p className="text-sm text-slate-500 card">Нет занятий за период</p>
      )}

      <div className="space-y-4">
        {byDay.map(([day, list]) => (
          <section key={day} className="space-y-2">
            <h2 className="text-sm font-medium text-slate-300 sticky top-0 bg-slate-950/90 py-1">
              {format(parseISO(day), 'EEEE, d MMMM', { locale: ru })}
            </h2>
            <ul className="space-y-2">
              {list.map((ev) => {
                const href = ev.sessionKey
                  ? `/trainer/my-sessions?session=${encodeURIComponent(ev.sessionKey)}`
                  : '/trainer/my-sessions';
                return (
                  <li key={ev.id}>
                    <Link
                      href={href}
                      className="card block hover:border-fitgo-600/50 transition-colors"
                    >
                      <div className="flex justify-between gap-2 items-start">
                        <div>
                          <p className="font-medium text-slate-100">
                            {format(parseISO(ev.startAt), 'HH:mm')}–
                            {format(parseISO(ev.endAt), 'HH:mm')} · {ev.title}
                          </p>
                          <p className="text-xs text-slate-400 mt-1">
                            Записано {ev.booked}
                            {ev.capacity ? ` / ${ev.capacity}` : ''}
                            {ev.attended
                              ? ` · пришло ${ev.attended}`
                              : ''}
                            {ev.approvalLabel ? ` · ${ev.approvalLabel}` : ''}
                          </p>
                        </div>
                        {statusChip(ev)}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
