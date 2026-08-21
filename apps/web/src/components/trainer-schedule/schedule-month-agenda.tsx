'use client';

import type { TrainerAvailabilityBlock, TrainerCalendarEvent } from '@fitgo/shared-types';
import {
  endOfMonth,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  addDays,
  isSameDay,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { useMemo } from 'react';
import {
  eventBlockClass,
  eventDotClass,
  eventKindLabel,
} from './event-kind-styles';
import { dateKey, getDayWorkBounds } from './schedule-grid';

function loadLevel(count: number): 'none' | 'low' | 'medium' | 'high' {
  if (count === 0) return 'none';
  if (count <= 2) return 'low';
  if (count <= 4) return 'medium';
  return 'high';
}

function loadBg(level: ReturnType<typeof loadLevel>, isWeekend: boolean, hasWork: boolean): string {
  if (isWeekend) return 'bg-slate-950/70';
  if (!hasWork) return 'bg-slate-950/40';
  switch (level) {
    case 'high':
      return 'bg-fitgo-500/25';
    case 'medium':
      return 'bg-fitgo-500/15';
    case 'low':
      return 'bg-fitgo-500/8';
    default:
      return 'bg-slate-900/20';
  }
}

export function ScheduleMonthAgenda({
  date,
  events,
  availabilityBlocks,
  onSelectEvent,
  onSelectDay,
}: {
  date: Date;
  events: TrainerCalendarEvent[];
  availabilityBlocks: TrainerAvailabilityBlock[];
  onSelectEvent?: (event: TrainerCalendarEvent) => void;
  onSelectDay?: (day: Date) => void;
}) {
  const monthStart = startOfMonth(date);
  const monthEnd = endOfMonth(date);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });

  const monthEvents = useMemo(
    () =>
      events.filter((e) => {
        const d = new Date(e.startAt);
        return d >= monthStart && d <= monthEnd;
      }),
    [events, monthStart, monthEnd],
  );

  const eventsByDay = useMemo(() => {
    const map = new Map<string, TrainerCalendarEvent[]>();
    for (const event of monthEvents) {
      const key = dateKey(new Date(event.startAt));
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    return map;
  }, [monthEvents]);

  const weeks = useMemo(() => {
    const rows: Date[][] = [];
    let cursor = gridStart;
    while (cursor <= monthEnd || rows.length < 6) {
      const week: Date[] = [];
      for (let i = 0; i < 7; i++) {
        week.push(cursor);
        cursor = addDays(cursor, 1);
      }
      rows.push(week);
      if (cursor > monthEnd && week[6].getMonth() !== monthStart.getMonth()) break;
      if (rows.length >= 6) break;
    }
    return rows;
  }, [gridStart, monthEnd, monthStart]);

  const today = new Date();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-fitgo-500/25" /> Высокая загрузка
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-fitgo-500/8" /> Низкая
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-slate-950/70" /> Выходной
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900/40">
        <div className="grid grid-cols-7 border-b border-slate-700/80 bg-slate-900/60 text-center text-[10px] uppercase text-slate-500">
          {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d, i) => (
            <div
              key={d}
              className={`py-2 ${i >= 5 ? 'text-slate-400' : ''}`}
            >
              {d}
            </div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b border-slate-800/60 last:border-b-0">
            {week.map((day) => {
              const key = dateKey(day);
              const dayEvents = eventsByDay.get(key) ?? [];
              const busyCount = dayEvents.filter(
                (e) => e.kind === 'PERSONAL' || e.kind === 'GROUP',
              ).length;
              const inMonth = isSameMonth(day, date);
              const isToday = isSameDay(day, today);
              const isWeekend = day.getDay() === 0 || day.getDay() === 6;
              const hasWork = getDayWorkBounds(key, availabilityBlocks) !== null;
              const level = loadLevel(busyCount);

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelectDay?.(day)}
                  className={`min-h-[72px] border-r border-slate-800/40 p-1 text-left last:border-r-0 sm:min-h-[88px] ${loadBg(
                    level,
                    isWeekend,
                    hasWork,
                  )} ${!inMonth ? 'opacity-40' : ''} ${
                    isToday ? 'ring-1 ring-inset ring-fitgo-500/50' : ''
                  } hover:brightness-110`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                        isToday
                          ? 'bg-fitgo-500 font-semibold text-white'
                          : 'text-slate-300'
                      }`}
                    >
                      {format(day, 'd')}
                    </span>
                    {busyCount > 0 && (
                      <span className="text-[9px] font-medium text-fitgo-300">
                        {busyCount}
                      </span>
                    )}
                  </div>
                  {!hasWork && inMonth && !isWeekend && (
                    <p className="mt-0.5 text-[9px] text-slate-500">нет графика</p>
                  )}
                  <div className="mt-0.5 space-y-0.5">
                    {dayEvents.slice(0, 2).map((ev) => (
                      <div
                        key={ev.id}
                        className={`truncate rounded px-0.5 text-[9px] leading-tight sm:text-[10px] ${eventBlockClass(ev.kind)}`}
                        title={ev.title}
                      >
                        <span
                          className={`mr-0.5 inline-block h-1 w-1 rounded-full ${eventDotClass(ev.kind)}`}
                        />
                        {new Date(ev.startAt).toLocaleTimeString('ru-RU', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        {ev.title}
                      </div>
                    ))}
                    {dayEvents.length > 2 && (
                      <p className="text-[9px] text-slate-500">+{dayEvents.length - 2}</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {monthEvents.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-slate-300">
            События {format(date, 'LLLL', { locale: ru })}
          </h3>
          <ul className="space-y-2">
            {[...monthEvents]
              .sort((a, b) => a.startAt.localeCompare(b.startAt))
              .map((event) => (
                <li key={event.id}>
                  <button
                    type="button"
                    onClick={() => onSelectEvent?.(event)}
                    className={`card w-full text-left ${eventBlockClass(event.kind)} border-l-4`}
                  >
                    <p className="text-sm font-medium">{event.title}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {format(new Date(event.startAt), 'd MMM, HH:mm', { locale: ru })}
                      {' — '}
                      {format(new Date(event.endAt), 'HH:mm', { locale: ru })}
                      {' · '}
                      {eventKindLabel(event.kind)}
                    </p>
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
