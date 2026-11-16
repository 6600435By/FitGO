'use client';

import { Button } from '@fitgo/forma-ui';
import {
  addMonths,
  format,
  parse,
  startOfMonth,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';

function monthKey(d: Date) {
  return format(d, 'yyyy-MM');
}

/** Forma Coach period control: ‹ · месяц ▾ · › · Сегодня — same look on schedule / shifts. */
export function FormaMonthNav({
  value,
  onChange,
  showToday = true,
  className,
}: {
  value: Date;
  onChange: (next: Date) => void;
  showToday?: boolean;
  className?: string;
}) {
  const cursor = startOfMonth(value);
  const key = monthKey(cursor);

  const options = useMemo(() => {
    const base = startOfMonth(new Date());
    return Array.from({ length: 24 }, (_, i) => {
      const d = addMonths(base, i - 12);
      return {
        value: monthKey(d),
        /** Year only in the native list — visible chip shows month alone. */
        label: format(d, 'LLLL yyyy', { locale: ru }),
      };
    });
  }, []);

  const label = format(cursor, 'LLLL', { locale: ru });

  const pick = (nextKey: string) => {
    const parsed = parse(`${nextKey}-01`, 'yyyy-MM-dd', new Date());
    // Keep day-of-month when possible (e.g. strip focus), clamp via date-fns month start + day.
    const day = Math.min(
      value.getDate(),
      new Date(parsed.getFullYear(), parsed.getMonth() + 1, 0).getDate(),
    );
    onChange(
      new Date(parsed.getFullYear(), parsed.getMonth(), day, 12, 0, 0, 0),
    );
  };

  return (
    <div
      className={[
        'flex min-w-0 items-center gap-1.5',
        className ?? '',
      ].join(' ')}
    >
      <Button
        size="sm"
        variant="secondary"
        className="h-10 w-10 shrink-0 !rounded-xl !p-0"
        aria-label="Предыдущий месяц"
        onClick={() => onChange(addMonths(value, -1))}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <div className="relative min-w-0 flex-1 sm:max-w-[9.5rem]">
        <div
          className="pointer-events-none flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-ink-raised px-3 text-sm font-medium capitalize text-white"
          aria-hidden
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-forma-400" />
        </div>
        <select
          aria-label="Месяц"
          title="Выбрать месяц"
          value={options.some((o) => o.value === key) ? key : ''}
          onChange={(e) => {
            if (e.target.value) pick(e.target.value);
          }}
          className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
          style={{ colorScheme: 'dark' }}
        >
          {!options.some((o) => o.value === key) ? (
            <option value={key}>{format(cursor, 'LLLL yyyy', { locale: ru })}</option>
          ) : null}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <Button
        size="sm"
        variant="secondary"
        className="h-10 w-10 shrink-0 !rounded-xl !p-0"
        aria-label="Следующий месяц"
        onClick={() => onChange(addMonths(value, 1))}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>

      {showToday ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-10 shrink-0 !rounded-xl px-3"
          onClick={() => onChange(new Date())}
        >
          Сегодня
        </Button>
      ) : null}
    </div>
  );
}
