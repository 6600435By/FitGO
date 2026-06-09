import { MembershipStatus, SessionType } from '@fitgo/shared-types';
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
