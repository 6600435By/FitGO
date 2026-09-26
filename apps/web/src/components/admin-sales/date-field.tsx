'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

type Props = {
  label: string;
  value: string; // YYYY-MM-DD
  onChange: (next: string) => void;
  className?: string;
};

function toIsoDate(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

export function DateField({ label, value, onChange, className }: Props) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = value ? parseISO(value) : new Date();
  const [cursor, setCursor] = useState(startOfMonth(selected));

  useEffect(() => {
    if (open) setCursor(startOfMonth(selected));
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const monthStart = startOfMonth(cursor);
  const days = eachDayOfInterval({
    start: startOfWeek(monthStart, { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(monthStart), { weekStartsOn: 1 }),
  });

  const display = value
    ? format(parseISO(value), 'dd.MM.yyyy', { locale: ru })
    : '—';

  return (
    <div ref={rootRef} className={`relative text-sm ${className ?? ''}`}>
      <span className="mb-1 block h-4 text-slate-400">{label}</span>
      <button
        type="button"
        id={id}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`input flex items-center justify-between gap-2 text-left tabular-nums ${
          open ? 'ring-2 ring-fitgo-500' : ''
        }`}
      >
        <span className={value ? 'text-slate-100' : 'text-slate-500'}>
          {display}
        </span>
        <CalendarDays className="h-4 w-4 shrink-0 text-fitgo-400" aria-hidden />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={`Календарь: ${label}`}
          className="absolute left-0 top-[calc(100%+0.35rem)] z-40 w-[17.5rem] rounded-2xl border border-slate-700 bg-slate-900 p-3 shadow-2xl shadow-black/50"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              aria-label="Предыдущий месяц"
              onClick={() => setCursor((c) => addMonths(c, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="text-sm font-medium capitalize text-slate-100">
              {format(cursor, 'LLLL yyyy', { locale: ru })}
            </div>
            <button
              type="button"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              aria-label="Следующий месяц"
              onClick={() => setCursor((c) => addMonths(c, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[10px] uppercase tracking-wide text-slate-500">
            {['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map((d) => (
              <div key={d} className="py-1">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {days.map((day) => {
              const inMonth = isSameMonth(day, cursor);
              const selectedDay = value ? isSameDay(day, selected) : false;
              const today = isToday(day);
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => {
                    onChange(toIsoDate(day));
                    setOpen(false);
                  }}
                  className={[
                    'relative h-8 rounded-lg text-sm tabular-nums transition',
                    inMonth ? 'text-slate-100' : 'text-slate-600',
                    selectedDay
                      ? 'bg-fitgo-500 font-semibold text-white shadow-md shadow-fitgo-500/30'
                      : today
                        ? 'ring-1 ring-fitgo-400/70 hover:bg-slate-800'
                        : 'hover:bg-slate-800',
                  ].join(' ')}
                >
                  {format(day, 'd')}
                  {selectedDay ? (
                    <span className="absolute inset-x-1 bottom-0.5 mx-auto h-0.5 rounded-full bg-white/80" />
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-slate-800 pt-2 text-[11px] text-slate-500">
            <span>
              Выбрано:{' '}
              <span className="font-medium text-fitgo-300">{display}</span>
            </span>
            <button
              type="button"
              className="text-fitgo-400 hover:underline"
              onClick={() => {
                onChange(toIsoDate(new Date()));
                setOpen(false);
              }}
            >
              Сегодня
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
