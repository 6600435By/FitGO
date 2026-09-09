import { MembershipStatus, SessionType, VISIT_KIND_LABELS, type Visit } from '@fitgo/shared-types';
import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatDate(date: string) {
  return new Date(date).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function formatDateTime(date: string) {
  return new Date(date).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function membershipStatusLabel(status: MembershipStatus) {
  const labels: Record<MembershipStatus, string> = {
    [MembershipStatus.ACTIVE]: 'Активен',
    [MembershipStatus.EXPIRED]: 'Истёк',
    [MembershipStatus.FROZEN]: 'Заморожен',
    [MembershipStatus.PENDING]: 'Ожидает',
  };
  return labels[status] ?? status;
}

export function sessionTypeLabel(type: SessionType) {
  return type === SessionType.GROUP ? 'Групповое' : 'Персональное';
}

export function sessionStatusLabel(
  status: 'SCHEDULED' | 'AWAITING_CONFIRMATION' | 'COMPLETED' | 'CANCELLED',
) {
  const labels = {
    SCHEDULED: 'Запланирована',
    AWAITING_CONFIRMATION: 'Ожидает подтверждения',
    COMPLETED: 'Проведена',
    CANCELLED: 'Отменена',
  };
  return labels[status];
}

export function sessionStatusColor(
  status: 'SCHEDULED' | 'AWAITING_CONFIRMATION' | 'COMPLETED' | 'CANCELLED',
) {
  const colors = {
    SCHEDULED: 'text-blue-400 bg-blue-400/10',
    AWAITING_CONFIRMATION: 'text-amber-400 bg-amber-400/10',
    COMPLETED: 'text-emerald-400 bg-emerald-400/10',
    CANCELLED: 'text-red-400 bg-red-400/10',
  };
  return colors[status];
}

export function formatCurrency(amount: number, currency = 'BYN') {
  const symbols: Record<string, string> = { BYN: 'Br', RUB: '₽', USD: '$' };
  return `${amount} ${symbols[currency] ?? currency}`;
}

export function membershipProgress(validFrom: string, validUntil: string) {
  const start = new Date(validFrom).getTime();
  const end = new Date(validUntil).getTime();
  const now = Date.now();
  const total = end - start;
  const elapsed = now - start;
  const percent = Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
  const daysLeft = Math.max(0, Math.ceil((end - now) / 86400000));
  return { percent, daysLeft };
}

export function membershipStatusColor(status: MembershipStatus) {
  const colors: Record<MembershipStatus, string> = {
    [MembershipStatus.ACTIVE]: 'text-emerald-400 bg-emerald-400/10',
    [MembershipStatus.EXPIRED]: 'text-red-400 bg-red-400/10',
    [MembershipStatus.FROZEN]: 'text-blue-400 bg-blue-400/10',
    [MembershipStatus.PENDING]: 'text-amber-400 bg-amber-400/10',
  };
  return colors[status] ?? 'text-slate-400 bg-slate-400/10';
}

export function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setHours(0, 0, 0, 0);
  return new Date(d.setDate(diff));
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function getWeekRange(weekOffset: number): { from: string; to: string; label: string } {
  const monday = getMonday(new Date());
  monday.setDate(monday.getDate() + weekOffset * 7);
  const sunday = addDays(monday, 6);
  sunday.setHours(23, 59, 59, 999);

  const from = `${monday.toLocaleDateString('fr-CA')} 00:00`;
  const to = `${addDays(monday, 7).toLocaleDateString('fr-CA')} 00:00`;
  const label = `${monday.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} — ${sunday.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`;

  return { from, to, label };
}

/** HH:mm from "17:00" or ISO "2026-09-09T13:46:58". */
export function formatVisitClock(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    const [h, m] = trimmed.split(':');
    return `${h.padStart(2, '0')}:${m}`;
  }
  const isoTime = trimmed.match(/T(\d{2}):(\d{2})/);
  if (isoTime) return `${isoTime[1]}:${isoTime[2]}`;
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
  return undefined;
}

export function formatShortVisitDate(date: string): string {
  const raw = date.includes('T') ? date : `${date}T12:00:00`;
  return new Date(raw).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  });
}

/** Compact visit title: kind, or short PT/group name (not raw 1C membership docs). */
export function visitHeadline(visit: Visit): string {
  const kindLabel = visit.kind ? VISIT_KIND_LABELS[visit.kind] : 'Посещение';
  const title = visit.title?.trim();
  if (!title) return kindLabel;
  if (/^членство/i.test(title) || /\b\d{5,}\b.*\bот\s+\d{2}\.\d{2}/i.test(title)) {
    return kindLabel;
  }
  if (title.length > 42) return `${title.slice(0, 40)}…`;
  return title;
}

