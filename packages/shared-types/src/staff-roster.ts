/** Club working hours + staff shift roster calendar. */

export type StaffShiftTrack = 'ADMIN' | 'TRAINER' | 'TECH';

/**
 * From this calendar day (Europe/Minsk) of month M, month M−1 is locked for
 * staff-roster edits (after payroll). Older months stay locked; current/future open.
 */
export const ROSTER_LOCK_DAY = 5;
export const ROSTER_LOCK_TZ = 'Europe/Minsk';

/** Club-local Y/M/D parts (Europe/Minsk). */
export function rosterClubDateParts(now: Date = new Date()): {
  year: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ROSTER_LOCK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day') };
}

/**
 * Whether YYYY-MM-DD is closed for ordinary roster edits.
 * Previous month locks on day {@link ROSTER_LOCK_DAY}; months before that always locked.
 */
export function isRosterDateLocked(
  ymd: string,
  now: Date = new Date(),
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [yy, mm] = ymd.split('-').map(Number);
  const { year, month, day } = rosterClubDateParts(now);
  const dateYm = yy! * 12 + mm!;
  const currentYm = year * 12 + month;
  if (dateYm >= currentYm) return false;
  if (dateYm < currentYm - 1) return true;
  return day >= ROSTER_LOCK_DAY;
}

/** Human label for lock banner / API errors. */
export function rosterLockMessage(ymd: string): string {
  const [yy, mm] = ymd.split('-').map(Number);
  const label = new Date(yy!, mm! - 1, 1).toLocaleDateString('ru-RU', {
    month: 'long',
    year: 'numeric',
  });
  return `График за ${label} закрыт с ${ROSTER_LOCK_DAY}-го числа следующего месяца (после выплаты ЗП).`;
}

export type DayOfWeekKey =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export interface ClubDayHours {
  open: string;
  close: string;
  closed?: boolean;
}

export interface ClubWorkingHours {
  monday?: ClubDayHours;
  tuesday?: ClubDayHours;
  wednesday?: ClubDayHours;
  thursday?: ClubDayHours;
  friday?: ClubDayHours;
  saturday?: ClubDayHours;
  sunday?: ClubDayHours;
  /** YYYY-MM-DD. Праздники считаются как выходной: часы клуба и лимит смен. */
  holidayDates?: string[];
  /** Часы клуба на конкретную дату. Имеют приоритет над шаблоном недели и праздником. */
  dayOverrides?: Record<string, ClubDayHours>;
}

/** Будни 07:00–23:00, выходные 09:00–21:00. */
export const DEFAULT_CLUB_WORKING_HOURS: ClubWorkingHours = {
  monday: { open: '07:00', close: '23:00' },
  tuesday: { open: '07:00', close: '23:00' },
  wednesday: { open: '07:00', close: '23:00' },
  thursday: { open: '07:00', close: '23:00' },
  friday: { open: '07:00', close: '23:00' },
  saturday: { open: '09:00', close: '21:00' },
  sunday: { open: '09:00', close: '21:00' },
  holidayDates: [
    '2026-01-01',
    '2026-01-02',
    '2026-01-07',
    '2026-03-08',
    '2026-05-01',
    '2026-05-09',
    '2026-07-03',
    '2026-11-07',
    '2026-12-25',
    '2027-01-01',
    '2027-01-02',
    '2027-01-07',
    '2027-03-08',
    '2027-05-01',
    '2027-05-09',
    '2027-07-03',
    '2027-11-07',
    '2027-12-25',
  ],
};

export type RosterDayKind = 'weekday' | 'weekend';

/**
 * Потолок оплачиваемых часов подразделения за день (минуты).
 * Пересечение смен разных людей входит в сумму целиком.
 * Будни: админы 7–20 + 12–23 = 24ч; тренеры 7–15 + 15–23 = 16ч; тех 7–23 = 16ч.
 * Выходные и праздники: админ 9–21 = 12ч; тренеры 9–15 + 15–21 = 12ч; тех 9–21 = 12ч.
 */
export const TRACK_DAY_MINUTE_CAP: Record<
  StaffShiftTrack,
  Record<RosterDayKind, number>
> = {
  ADMIN: { weekday: 24 * 60, weekend: 12 * 60 },
  TRAINER: { weekday: 16 * 60, weekend: 12 * 60 },
  TECH: { weekday: 16 * 60, weekend: 12 * 60 },
};

export const TRACK_DAY_PATTERN: Record<
  StaffShiftTrack,
  Record<RosterDayKind, string>
> = {
  ADMIN: {
    weekday: '7:00–20:00 и 12:00–23:00',
    weekend: '9:00–21:00, один администратор',
  },
  TRAINER: {
    weekday: '7:00–15:00 и 15:00–23:00',
    weekend: '9:00–15:00 и 15:00–21:00',
  },
  TECH: {
    weekday: '7:00–23:00, один человек',
    weekend: '9:00–21:00, один человек',
  },
};

export function isoDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function rosterDayKind(
  d: Date,
  holidayDates: string[] = [],
): RosterDayKind {
  if (holidayDates.includes(isoDateKey(d))) return 'weekend';
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return 'weekend';
  return 'weekday';
}

export function trackDayCapMinutes(
  track: StaffShiftTrack,
  d: Date,
  holidayDates: string[] = [],
): number {
  return TRACK_DAY_MINUTE_CAP[track][rosterDayKind(d, holidayDates)];
}

export function clubHoursForDate(
  hours: ClubWorkingHours,
  d: Date,
): ClubDayHours | undefined {
  const key = isoDateKey(d);
  const override = hours.dayOverrides?.[key];
  if (override) return override;
  if ((hours.holidayDates ?? []).includes(key)) {
    return hours.saturday ?? { open: '09:00', close: '21:00' };
  }
  return hours[dayKeyFromDate(d)];
}

export const DAY_OF_WEEK_KEYS: DayOfWeekKey[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

export function dayKeyFromDate(d: Date): DayOfWeekKey {
  const map: DayOfWeekKey[] = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ];
  return map[d.getDay()]!;
}

export interface StaffShiftDto {
  id: string;
  userId: string;
  userName: string;
  track: StaffShiftTrack;
  date: string;
  startAt: string;
  endAt: string;
  status: string;
  /** Planned window only. Department day cap uses this. */
  minutes: number;
  /** Paid minutes after the planned end. 0–30 for admins. */
  overtimeMinutes: number;
  note?: string;
}

export interface StaffShiftMonthCell {
  date: string;
  shifts: StaffShiftDto[];
}

export interface StaffHourlySummary {
  userId: string;
  userName: string;
  track: StaffShiftTrack;
  shiftCount: number;
  totalMinutes: number;
  hourlyRateMinor: number;
  payMinor: number;
  currency: string;
  shifts: StaffShiftDto[];
}
