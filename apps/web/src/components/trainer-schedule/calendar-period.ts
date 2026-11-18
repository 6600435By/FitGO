'use client';

import {
  addDays,
  addMonths,
  endOfDay,
  endOfMonth,
  endOfWeek,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import type { ScheduleView } from './schedule-grid';

export function getCalendarPeriod(
  date: Date,
  view: ScheduleView,
): { from: string; to: string; periodStart: string; periodEnd: string } {
  let rangeStart: Date;
  let rangeEnd: Date;

  if (view === 'month') {
    rangeStart = startOfWeek(startOfMonth(date), { weekStartsOn: 1 });
    rangeEnd = endOfWeek(endOfMonth(date), { weekStartsOn: 1 });
  } else if (view === 'day') {
    rangeStart = startOfDay(date);
    rangeEnd = endOfDay(date);
  } else {
    rangeStart = startOfWeek(date, { weekStartsOn: 1 });
    rangeEnd = endOfWeek(date, { weekStartsOn: 1 });
  }

  // period bounds match the loaded calendar range so draft replace
  // does not drop/dupe blocks outside the selected day.
  return {
    from: rangeStart.toISOString(),
    to: addDays(rangeEnd, 1).toISOString(),
    periodStart: startOfDay(rangeStart).toISOString(),
    periodEnd: endOfDay(rangeEnd).toISOString(),
  };
}

export function defaultCalendarDate(): Date {
  return new Date();
}

export function useMobileDefaultView(): ScheduleView {
  if (typeof window === 'undefined') return 'week';
  return window.innerWidth < 640 ? 'day' : 'week';
}

export function addMonthsSafe(date: Date, amount: number): Date {
  return addMonths(date, amount);
}
