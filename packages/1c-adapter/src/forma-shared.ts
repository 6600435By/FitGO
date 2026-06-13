import { SessionType, type ScheduleSlot } from '@fitgo/shared-types';
import type { ScheduleFilters } from './types';

export interface FormaClassItem {
  appointment_id: string;
  start_date: string;
  end_date: string;
  duration?: number;
  capacity?: number;
  web_capacity?: number;
  available_slots?: number;
  canceled?: boolean;
  already_booked?: boolean | null;
  service: { id: string; title: string; color?: string };
  employee: { id: string; name: string };
  room?: { title: string };
}

export interface FormaAuthData {
  user_token?: string;
  client_id?: string;
}

export function toIsoDate(dateStr: string): string {
  return dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T');
}

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

export function mapFormaClass(item: FormaClassItem): ScheduleSlot {
  const capacity = item.capacity ?? item.web_capacity ?? 0;
  const availableSlots = item.available_slots ?? 0;
  const booked = Math.max(0, capacity - availableSlots);

  return {
    id: item.appointment_id,
    title: item.service.title,
    type: SessionType.GROUP,
    serviceId: item.service.id,
    trainerId: item.employee.id,
    trainerName: item.employee.name,
    startAt: toIsoDate(item.start_date),
    endAt: toIsoDate(item.end_date),
    capacity,
    booked,
    available: availableSlots > 0 && !item.canceled,
  };
}

export function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

export function formatFormaDate(date: Date): string {
  return date.toLocaleDateString('fr-CA');
}

export function buildScheduleRange(filters?: ScheduleFilters): {
  startDate: string;
  endDate: string;
} {
  if (filters?.from && filters?.to) {
    return {
      startDate: filters.from.replace('T', ' ').slice(0, 16),
      endDate: filters.to.replace('T', ' ').slice(0, 16),
    };
  }

  const monday = getMonday(new Date());
  const end = new Date();
  end.setDate(end.getDate() + 7);

  return {
    startDate: `${formatFormaDate(monday)} 00:00`,
    endDate: `${formatFormaDate(end)} 00:00`,
  };
}

export function unwrapFormaData<T>(body: { data?: T } | T): T {
  if (body && typeof body === 'object' && 'data' in body && body.data !== undefined) {
    return body.data as T;
  }
  return body as T;
}
