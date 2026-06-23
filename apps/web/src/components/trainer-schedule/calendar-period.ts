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
import type { View } from 'react-big-calendar';

export function getCalendarPeriod(
  date: Date,
  view: View,
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

  const periodStart = startOfDay(date);
  let periodEnd: Date;
  if (view === 'month') {
    periodEnd = endOfMonth(date);
  } else if (view === 'day') {
    periodEnd = endOfDay(date);
  } else {
    periodEnd = endOfWeek(date, { weekStartsOn: 1 });
  }

  return {
    from: rangeStart.toISOString(),
    to: addDays(rangeEnd, 1).toISOString(),
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
  };
}

export function defaultCalendarDate(): Date {
  return new Date();
}

export function useMobileDefaultView(): View {
  if (typeof window === 'undefined') return 'week';
  return window.innerWidth < 640 ? 'day' : 'week';
}

export function addMonthsSafe(date: Date, amount: number): Date {
  return addMonths(date, amount);
}
