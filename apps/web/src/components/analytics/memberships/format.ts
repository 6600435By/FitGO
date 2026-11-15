import type { MembershipUtilizationSegment } from '@fitgo/shared-types';

export function money(minor: number, currency: string): string {
  return `${(minor / 100).toLocaleString('ru-RU', {
    maximumFractionDigits: 0,
  })}\u00a0${currency}`;
}

export function moneyOrDash(
  minor: number | null | undefined,
  currency: string,
): string {
  return minor == null ? '—' : money(minor, currency);
}

export function pct(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${v}%`;
}

/** Coverage in 0..1 → "85%". */
export function cov(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${Math.round(v * 100)}%`;
}

export function num(v: number | null | undefined, digits = 1): string {
  if (v == null) return '—';
  return v.toLocaleString('ru-RU', { maximumFractionDigits: digits });
}

export const SEGMENT_LABEL: Record<MembershipUtilizationSegment, string> = {
  max: 'Максимум',
  normal: 'Норма',
  under: 'Недогруз',
  sleeping: 'Спящие',
};

export const STATUS_DOT: Record<'green' | 'yellow' | 'red', string> = {
  green: 'bg-emerald-400',
  yellow: 'bg-amber-400',
  red: 'bg-rose-400',
};

export function errMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}
