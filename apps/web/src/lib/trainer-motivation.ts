import type { TrainerMonthAnalytics } from '@fitgo/shared-types';

const LADDER_KEY = 'fitgo.trainer.ladderStep.v1';
const JOURNAL_KEY = 'fitgo.trainer.journalSubmitDays.v1';

export type MotivationRecords = {
  ptSessions: number;
  ptPrev: number;
  ptIsRecord: boolean;
  fillPct: number | null;
  fillPrev: number | null;
  fillIsRecord: boolean;
  journalWeekStreak: number;
  ladderPercent: number | null;
  ladderRemaining: number | null;
  ladderIsTop: boolean;
};

export function buildMotivationRecords(
  a: TrainerMonthAnalytics | null | undefined,
  journalWeekStreak: number,
): MotivationRecords | null {
  if (!a) return null;
  const ptIsRecord = a.pt.count > 0 && a.pt.count > a.pt.previous;
  const fillPct = a.group.avgFillPct;
  const fillPrev = a.group.previousAvgFillPct;
  const fillIsRecord =
    fillPct != null && fillPrev != null && fillPct > fillPrev;
  return {
    ptSessions: a.pt.count,
    ptPrev: a.pt.previous,
    ptIsRecord,
    fillPct,
    fillPrev,
    fillIsRecord,
    journalWeekStreak,
    ladderPercent: a.ladder?.percent ?? null,
    ladderRemaining: a.ladder?.remaining ?? null,
    ladderIsTop: Boolean(a.ladder?.isTop),
  };
}

/** Persist submitted journal day (YYYY-MM-DD) and return streak in weeks. */
export function recordJournalSubmitDay(isoDay: string): number {
  if (typeof window === 'undefined') return 0;
  const days = loadJournalDays();
  if (!days.includes(isoDay)) {
    days.push(isoDay);
    days.sort();
    try {
      window.localStorage.setItem(JOURNAL_KEY, JSON.stringify(days.slice(-120)));
    } catch {
      /* ignore */
    }
  }
  return journalWeekStreakFromDays(days);
}

export function loadJournalWeekStreak(): number {
  return journalWeekStreakFromDays(loadJournalDays());
}

function loadJournalDays(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(JOURNAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d));
  } catch {
    return [];
  }
}

/** Consecutive ISO weeks (Mon–Sun) with ≥1 submit, counting back from current week. */
export function journalWeekStreakFromDays(days: string[]): number {
  if (days.length === 0) return 0;
  const weekKeys = new Set(days.map(isoWeekKey));
  let streak = 0;
  const cursor = new Date();
  // Align to Monday of current week
  const day = (cursor.getDay() + 6) % 7;
  cursor.setDate(cursor.getDate() - day);
  cursor.setHours(12, 0, 0, 0);
  for (;;) {
    const key = isoWeekKey(isoFromDate(cursor));
    if (!weekKeys.has(key)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 7);
  }
  return streak;
}

function isoFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isoWeekKey(isoDay: string): string {
  const d = new Date(`${isoDay}T12:00:00`);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return isoFromDate(d);
}

/**
 * Returns true if ladder % rose vs last stored value (new step).
 * Updates storage. Call once when analytics loads.
 */
export function detectLadderStepUp(
  userId: string,
  ladder: { percent: number; volumeCount: number } | null | undefined,
): boolean {
  if (typeof window === 'undefined' || !ladder || !userId) return false;
  const key = `${LADDER_KEY}:${userId}`;
  try {
    const raw = window.localStorage.getItem(key);
    const prev = raw
      ? (JSON.parse(raw) as { percent?: number; volumeCount?: number })
      : null;
    window.localStorage.setItem(
      key,
      JSON.stringify({
        percent: ladder.percent,
        volumeCount: ladder.volumeCount,
      }),
    );
    if (!prev || typeof prev.percent !== 'number') return false;
    return ladder.percent > prev.percent;
  } catch {
    return false;
  }
}
