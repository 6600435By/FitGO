'use client';

import { addDays, format } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { ScheduleView } from './schedule-grid';
import { dateKey, formatDateTitle, shiftDateKey } from './schedule-grid';

const VIEW_LABELS: Record<ScheduleView, string> = {
  day: 'День',
  week: 'Неделя',
  month: 'Месяц',
};

export function ScheduleToolbar({
  date,
  view,
  onDateChange,
  onViewChange,
  onPrev,
  onNext,
}: {
  date: Date;
  view: ScheduleView;
  onDateChange: (date: Date) => void;
  onViewChange: (view: ScheduleView) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const dateStr = dateKey(date);
  const todayStr = dateKey(new Date());

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onPrev}
              className="min-h-[44px] rounded-xl border border-slate-700 px-3 py-2 text-slate-300 hover:bg-slate-800"
              aria-label="Назад"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => onDateChange(new Date())}
              className={`min-h-[44px] rounded-xl border px-3 py-2 text-sm transition ${
                dateStr === todayStr
                  ? 'border-fitgo-500/50 bg-fitgo-500/15 text-fitgo-300'
                  : 'border-slate-700 text-slate-300 hover:bg-slate-800'
              }`}
            >
              Сегодня
            </button>
            <button
              type="button"
              onClick={onNext}
              className="min-h-[44px] rounded-xl border border-slate-700 px-3 py-2 text-slate-300 hover:bg-slate-800"
              aria-label="Вперёд"
            >
              ›
            </button>
          </div>

          <input
            type="date"
            value={dateStr}
            onChange={(e) => {
              if (!e.target.value) return;
              onDateChange(new Date(`${e.target.value}T12:00:00`));
            }}
            className="input min-h-[44px] w-full sm:w-auto"
          />

          <div className="flex rounded-xl border border-slate-700 p-0.5">
            {(Object.keys(VIEW_LABELS) as ScheduleView[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onViewChange(v)}
                className={`rounded-lg px-3 py-2 text-sm transition ${
                  view === v
                    ? 'bg-fitgo-500 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {VIEW_LABELS[v]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="text-sm text-slate-400">
        {view === 'day' && formatDateTitle(dateStr)}
        {view === 'week' &&
          `${format(addDays(date, -((date.getDay() + 6) % 7)), 'd MMM', { locale: ru })} — ${format(
            addDays(date, 6 - ((date.getDay() + 6) % 7)),
            'd MMM yyyy',
            { locale: ru },
          )}`}
        {view === 'month' && format(date, 'LLLL yyyy', { locale: ru })}
      </p>
    </div>
  );
}

export function shiftDateByView(date: Date, view: ScheduleView, direction: -1 | 1): Date {
  const d = new Date(date);
  if (view === 'day') {
    d.setDate(d.getDate() + direction);
  } else if (view === 'week') {
    d.setDate(d.getDate() + direction * 7);
  } else {
    d.setMonth(d.getMonth() + direction);
  }
  return d;
}
