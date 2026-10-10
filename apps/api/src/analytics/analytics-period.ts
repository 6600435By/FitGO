import { BadRequestException } from '@nestjs/common';
import type { AnalyticsCompareMode } from '@fitgo/shared-types';

const TZ = 'Europe/Minsk';

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function minskParts(d = new Date()): {
  year: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day') };
}

export function rangeBounds(from: string, to: string): { start: Date; end: Date } {
  return {
    start: new Date(`${from}T00:00:00+03:00`),
    end: new Date(`${to}T23:59:59.999+03:00`),
  };
}

export function daysInclusive(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00Z`);
  const b = new Date(`${to}T12:00:00Z`);
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000) + 1);
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

export function resolveCompareRange(
  from: string,
  to: string,
  mode: AnalyticsCompareMode,
  cmpFrom?: string,
  cmpTo?: string,
): { compareFrom: string; compareTo: string } {
  if (mode === 'custom' && cmpFrom && cmpTo) {
    return { compareFrom: cmpFrom, compareTo: cmpTo };
  }
  const len = daysInclusive(from, to);
  if (mode === 'yoy') {
    const fromD = new Date(`${from}T12:00:00Z`);
    const toD = new Date(`${to}T12:00:00Z`);
    fromD.setUTCFullYear(fromD.getUTCFullYear() - 1);
    toD.setUTCFullYear(toD.getUTCFullYear() - 1);
    return { compareFrom: isoDate(fromD), compareTo: isoDate(toD) };
  }
  // prev: equal-length window ending the day before `from`
  const compareTo = addDaysIso(from, -1);
  const compareFrom = addDaysIso(compareTo, -(len - 1));
  return { compareFrom, compareTo };
}

export function deltaPct(current: number, previous: number | null | undefined): number | null {
  if (previous == null || previous === 0) {
    return current === 0 ? 0 : null;
  }
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export function metric(
  value: number,
  compareValue?: number | null,
  opts?: { unit?: 'count' | 'money' | 'percent' | 'hours'; trend?: number[]; hint?: string },
) {
  return {
    value,
    compareValue: compareValue ?? null,
    deltaPct: deltaPct(value, compareValue),
    unit: opts?.unit,
    trend: opts?.trend,
    hint: opts?.hint,
  };
}

export function assertPeriod(from: string, to: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new BadRequestException('from/to must be YYYY-MM-DD');
  }
  if (from > to) {
    throw new BadRequestException('from must be ≤ to');
  }
}

export function weekBuckets(from: string, to: string, valuesByDay: Map<string, number>): number[] {
  const out: number[] = [];
  let cursor = from;
  let bucket = 0;
  let daysInBucket = 0;
  while (cursor <= to) {
    bucket += valuesByDay.get(cursor) ?? 0;
    daysInBucket++;
    const next = addDaysIso(cursor, 1);
    if (daysInBucket >= 7 || next > to) {
      out.push(bucket);
      bucket = 0;
      daysInBucket = 0;
    }
    cursor = next;
  }
  return out.slice(-12);
}
