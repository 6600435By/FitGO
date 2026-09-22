/** Club working hours + staff shift roster calendar. */

export type StaffShiftTrack = 'ADMIN' | 'TRAINER' | 'TECH';

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

export type ClubWorkingHours = Partial<Record<DayOfWeekKey, ClubDayHours>>;

export const DEFAULT_CLUB_WORKING_HOURS: ClubWorkingHours = {
  monday: { open: '08:00', close: '22:00' },
  tuesday: { open: '08:00', close: '22:00' },
  wednesday: { open: '08:00', close: '22:00' },
  thursday: { open: '08:00', close: '22:00' },
  friday: { open: '08:00', close: '22:00' },
  saturday: { open: '09:00', close: '21:00' },
  sunday: { open: '09:00', close: '21:00' },
};

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
  minutes: number;
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
