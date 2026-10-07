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

/** Forma `club_id` — UUID справочника «Структурные единицы», не seed `1c-club-001`. */
const FORMA_CLUB_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isFormaClubUuid(value: string | null | undefined): boolean {
  return FORMA_CLUB_UUID.test(value?.trim() ?? '');
}

export interface FormaClubRef {
  id: string;
  title?: string;
  current?: boolean | null;
}

/**
 * Pick the structural unit Forma will accept as `club_id`.
 * Prefer `preferredId` when it is one of the returned clubs; otherwise the
 * club marked current, otherwise the only club. Several clubs and no match → ''.
 */
export function pickFormaClubId(
  clubs: FormaClubRef[],
  preferredId?: string | null,
): string {
  const rows = clubs.filter((c) => isFormaClubUuid(c.id));
  const preferred = preferredId?.trim().toLowerCase() ?? '';
  const match = preferred
    ? rows.find((c) => c.id.toLowerCase() === preferred)
    : undefined;
  if (match) return match.id;
  const current = rows.find((c) => c.current === true);
  if (current) return current.id;
  if (rows.length === 1 && rows[0]) return rows[0].id;
  return '';
}

export function mapFormaClass(item: FormaClassItem): ScheduleSlot {
  const capacity = item.capacity ?? item.web_capacity ?? 0;
  const availableSlots = item.available_slots ?? 0;
  const booked = Math.max(0, capacity - availableSlots);

  return {
    id: item.appointment_id ?? '',
    title: item.service?.title ?? '',
    type: SessionType.GROUP,
    serviceId: item.service?.id ?? '',
    trainerId: item.employee?.id ?? '',
    trainerName: item.employee?.name,
    startAt: item.start_date ? toIsoDate(item.start_date) : '',
    endAt: item.end_date ? toIsoDate(item.end_date) : '',
    capacity,
    booked,
    available: availableSlots > 0 && !item.canceled,
    roomTitle: item.room?.title,
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

/**
 * Forma / planvueplugin often returns `{ result: false, error: 1025 }` with no
 * `error_message`. Passing a bare number into `new Error()` yields just "1025".
 */
export function formatFormaProxyError(
  body: {
    error?: unknown;
    error_message?: unknown;
    message?: unknown;
  },
  fallbackLabel = 'Forma/WP',
): string {
  const code =
    typeof body.error === 'number' || typeof body.error === 'string'
      ? body.error
      : null;
  const detailCandidates = [body.error_message, body.message];
  const detail = detailCandidates.find(
    (v): v is string => typeof v === 'string' && v.trim().length > 0,
  );
  if (detail && code != null && String(code) !== detail) {
    return `${fallbackLabel} ${code}: ${detail}`;
  }
  if (detail) return detail;
  if (code != null) return `${fallbackLabel} ошибка ${code}`;
  return `Ошибка ${fallbackLabel}`;
}
