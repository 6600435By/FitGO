import {
  DISCREPANCY_RETENTION_DAYS,
} from '@fitgo/shared-types';
import { BadRequestException } from '@nestjs/common';

const MINSK_OFFSET = '+03:00';
const MINSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Shifts an instant so that its UTC getters return Minsk wall-clock values. */
function toMinskWall(d: Date): Date {
  return new Date(d.getTime() + MINSK_OFFSET_MS);
}

export function retentionDays(): number {
  const raw = process.env.DISCREPANCY_RETENTION_DAYS?.trim();
  const n = raw ? Number(raw) : DISCREPANCY_RETENTION_DAYS;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DISCREPANCY_RETENTION_DAYS;
}

export function parsePeriod(from?: string, to?: string): {
  from: string;
  to: string;
  fromD: Date;
  toD: Date;
} {
  const today = toMinskWall(new Date());
  const defaultTo = today.toISOString().slice(0, 10);
  const weekStart = new Date(today);
  weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
  const defaultFrom = weekStart.toISOString().slice(0, 10);

  const fromStr = (from?.trim() || defaultFrom).slice(0, 10);
  const toStr = (to?.trim() || defaultTo).slice(0, 10);
  const fromD = new Date(`${fromStr}T00:00:00.000${MINSK_OFFSET}`);
  const toD = new Date(`${toStr}T23:59:59.999${MINSK_OFFSET}`);
  if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) {
    throw new BadRequestException('Некорректные даты from/to');
  }
  if (fromD > toD) {
    throw new BadRequestException('from должен быть ≤ to');
  }
  const maxMs = retentionDays() * 86400000;
  if (toD.getTime() - fromD.getTime() > maxMs) {
    throw new BadRequestException(
      `Период не больше ${retentionDays()} дней`,
    );
  }
  const oldest = toMinskWall(new Date());
  oldest.setUTCDate(oldest.getUTCDate() - retentionDays());
  if (fromStr < oldest.toISOString().slice(0, 10)) {
    throw new BadRequestException(
      `Даты старше ${retentionDays()} дней недоступны`,
    );
  }
  return { from: fromStr, to: toStr, fromD, toD };
}

export function fingerprint(...parts: Array<string | number | null | undefined>) {
  const raw = parts.map((p) => String(p ?? '')).join('|');
  let h = 0;
  for (let i = 0; i < raw.length; i += 1) {
    h = (h * 31 + raw.charCodeAt(i)) | 0;
  }
  return `fp${(h >>> 0).toString(16)}`;
}

/** Calendar days between two instants, counted on the Minsk wall clock. */
export function daysBetween(from: Date, to: Date): number {
  const f = toMinskWall(from);
  const t = toMinskWall(to);
  const a = Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate());
  const b = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
  return Math.round((b - a) / 86400000);
}

/** YYYY-MM-DD of the instant in Europe/Minsk (UTC+3, no DST). */
export function minskDay(d: Date): string {
  return toMinskWall(d).toISOString().slice(0, 10);
}

export function parseDateLoose(value: string | null | undefined): Date | null {
  if (!value?.trim()) return null;
  const s = value.trim();
  // YYYY-MM-DD or ISO
  const d = new Date(s.includes('T') ? s : `${s}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
