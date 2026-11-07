/** Pure rules for Forma Coach «Помощник» (unit-tested). */

export const MS_DAY = 24 * 60 * 60_000;

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

export function daysUntilYmd(ymd?: string | null, now = new Date()): number | null {
  if (!ymd || ymd.length < 10) return null;
  const t = Date.parse(`${ymd.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - now.getTime()) / MS_DAY);
}

/** Parse YYYY-MM-DD or DD.MM.YYYY / DD.MM.YY from free-text goal target. */
export function parseGoalDeadlineYmd(raw?: string | null): string | null {
  if (!raw?.trim()) return null;
  const s = raw.trim();
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ru = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (!ru) return null;
  const d = Number(ru[1]);
  const m = Number(ru[2]);
  let y = Number(ru[3]);
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export function isBirthdayThisWeek(
  dob: Date | null | undefined,
  now = new Date(),
): boolean {
  if (!dob) return false;
  const m = dob.getUTCMonth() + 1;
  const d = dob.getUTCDate();
  for (let i = 0; i < 7; i++) {
    const day = new Date(now);
    day.setHours(12, 0, 0, 0);
    day.setDate(now.getDate() + i);
    if (day.getMonth() + 1 === m && day.getDate() === d) return true;
  }
  return false;
}

export function hasWorkoutPlan(sheet: unknown): boolean {
  if (!sheet || typeof sheet !== 'object') return false;
  const s = sheet as {
    strength?: { exercises?: unknown[] };
    circuit?: { stations?: unknown[] };
    cardio?: unknown;
    exercises?: unknown[];
  };
  if (Array.isArray(s.strength?.exercises) && s.strength!.exercises!.length > 0)
    return true;
  if (Array.isArray(s.circuit?.stations) && s.circuit!.stations!.length > 0)
    return true;
  if (Array.isArray(s.exercises) && s.exercises.length > 0) return true;
  if (s.cardio) return true;
  return false;
}

export function rangesOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Membership / club package ending soon. */
export function matchesPackageExpiring(input: {
  sessionsRemaining?: number | null;
  membershipValidUntil?: string | null;
  now?: Date;
}): boolean {
  const lowSessions =
    input.sessionsRemaining != null && input.sessionsRemaining <= 2;
  const daysLeft = daysUntilYmd(input.membershipValidUntil, input.now);
  return lowSessions || (daysLeft != null && daysLeft >= 0 && daysLeft <= 7);
}

/** No hall/PT visit for 14+ days. */
export function matchesClientGhosting(input: {
  lastVisitYmd?: string | null;
  now?: Date;
}): boolean {
  const visitDays = daysUntilYmd(input.lastVisitYmd, input.now);
  return visitDays != null && visitDays <= -14;
}

/** Goal deadline within next 14 days (inclusive today). */
export function matchesGoalDeadline(input: {
  target?: string | null;
  now?: Date;
}): boolean {
  const ymd = parseGoalDeadlineYmd(input.target);
  const daysLeft = daysUntilYmd(ymd, input.now);
  return daysLeft != null && daysLeft >= 0 && daysLeft <= 14;
}

/**
 * Recent 14d visits vs prior 28d: drop if recent ≤ half of expected (prior/2),
 * and not already in full ghosting.
 */
export function matchesVisitFrequencyDrop(input: {
  prior28dCount: number;
  recent14dCount: number;
  lastVisitYmd?: string | null;
  now?: Date;
}): boolean {
  if (input.prior28dCount < 2) return false;
  const expected = input.prior28dCount / 2;
  if (input.recent14dCount > expected * 0.5) return false;
  if (matchesClientGhosting({ lastVisitYmd: input.lastVisitYmd, now: input.now })) {
    return false;
  }
  return true;
}

/** Cancelled PT window overlaps an active client hold → offer the slot. */
export function matchesHoldSlotFreed(input: {
  cancelledStart: Date;
  cancelledEnd: Date;
  holdStart: Date;
  holdEnd: Date;
  holdExpiresAt?: Date | null;
  now?: Date;
}): boolean {
  if (!rangesOverlap(
    input.cancelledStart,
    input.cancelledEnd,
    input.holdStart,
    input.holdEnd,
  )) {
    return false;
  }
  const now = input.now ?? new Date();
  if (input.holdExpiresAt && input.holdExpiresAt <= now) return false;
  if (input.holdEnd <= now) return false;
  return true;
}

/** Staff PT sitting in PENDING_ADMIN longer than 2 days (by session start). */
export function matchesControlPendingOverdue(input: {
  sessionStartAt: Date;
  performerConfirmed: boolean;
  adminApproved: boolean;
  overrideApproved: boolean;
  now?: Date;
}): boolean {
  if (!input.performerConfirmed) return false;
  if (input.adminApproved || input.overrideApproved) return false;
  const now = input.now ?? new Date();
  return input.sessionStartAt.getTime() <= now.getTime() - 2 * MS_DAY;
}
