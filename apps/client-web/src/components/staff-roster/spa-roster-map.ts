import type {
  SpaBoardHourBlock,
  SpaBoardResponse,
  SpaBoardStaff,
  StaffShiftDto,
  StaffShiftMonthCell,
} from '@fitgo/shared-types';

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function localDateKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function minutesBetween(startIso: string, endIso: string) {
  return Math.max(
    0,
    Math.round(
      (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000,
    ),
  );
}

function staffName(s: SpaBoardStaff) {
  return `${s.lastName} ${s.firstName}`.trim();
}

/**
 * Map published SPA availability blocks into staff-roster month cells.
 * track field is a placeholder — SPA is not a StaffShiftTrack in Prisma.
 */
export function spaBoardToMonthCells(
  board: SpaBoardResponse,
  year: number,
  month: number,
): StaffShiftMonthCell[] {
  const staffById = new Map(board.staff.map((s) => [s.id, s]));
  const daysInMonth = new Date(year, month, 0).getDate();
  const byDate = new Map<string, StaffShiftDto[]>();
  for (let d = 1; d <= daysInMonth; d++) {
    byDate.set(`${year}-${pad(month)}-${pad(d)}`, []);
  }

  const published = board.hours.filter((h) => h.status === 'PUBLISHED');
  for (const h of published) {
    const key = localDateKey(h.startAt);
    const list = byDate.get(key);
    if (!list) continue;
    const person = staffById.get(h.specialistId);
    list.push(hourBlockToShiftDto(h, person));
  }

  return [...byDate.entries()].map(([date, shifts]) => ({ date, shifts }));
}

export function hourBlockToShiftDto(
  h: SpaBoardHourBlock,
  person?: SpaBoardStaff,
): StaffShiftDto {
  return {
    id: h.id,
    userId: h.specialistId,
    userName: person ? staffName(person) : h.specialistId,
    // Placeholder — never written to StaffShift.
    track: 'ADMIN',
    date: localDateKey(h.startAt),
    startAt: h.startAt,
    endAt: h.endAt,
    status: 'PLANNED',
    minutes: minutesBetween(h.startAt, h.endAt),
    overtimeMinutes: 0,
  };
}

export function spaStaffOptions(board: SpaBoardResponse) {
  return [...board.staff]
    .map((s) => ({ id: s.id, name: staffName(s) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export function monthBoundsIso(year: number, month: number) {
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}
