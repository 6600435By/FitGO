/** Shared day/week/month period helpers for SPA journal. */

export type SpaBoardView = 'day' | 'week' | 'month';

const VIEW_STORAGE_KEY = 'fitgo.spa-board.view';
const WEEK_SCALE_STORAGE_KEY = 'fitgo.spa-board.week-scale';
const MONTH_EMPTY_WORK_KEY = 'fitgo.spa-board.month-empty-work';

/** Zoom steps for the week journal (percent of default density). */
export const SPA_WEEK_SCALE_STEPS = [70, 85, 100, 115] as const;
export type SpaWeekScale = (typeof SPA_WEEK_SCALE_STEPS)[number];

export function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Monday 00:00 of the week containing `d`. */
export function startOfWeekMonday(d: Date) {
  const x = startOfDay(d);
  const dow = x.getDay(); // 0=Sun … 6=Sat
  const offset = dow === 0 ? -6 : 1 - dow;
  return addDays(x, offset);
}

export function endOfWeekSunday(d: Date) {
  return endOfDay(addDays(startOfWeekMonday(d), 6));
}

export function weekDays(anchor: Date): Date[] {
  const start = startOfWeekMonday(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function startOfMonth(d: Date) {
  return startOfDay(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function endOfMonth(d: Date) {
  return endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export function addMonths(d: Date, n: number) {
  const x = startOfDay(d);
  const day = x.getDate();
  x.setDate(1);
  x.setMonth(x.getMonth() + n);
  const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  x.setDate(Math.min(day, last));
  return x;
}

/** All calendar days in the month containing `d`. */
export function monthDays(anchor: Date): Date[] {
  const start = startOfMonth(anchor);
  const end = endOfMonth(anchor);
  const out: Date[] = [];
  for (let cur = start; cur <= end; cur = addDays(cur, 1)) {
    out.push(cur);
  }
  return out;
}

export function boardPeriodForView(
  day: Date,
  view: SpaBoardView,
): { start: string; end: string } {
  if (view === 'week') {
    return {
      start: startOfWeekMonday(day).toISOString(),
      end: endOfWeekSunday(day).toISOString(),
    };
  }
  if (view === 'month') {
    return {
      start: startOfMonth(day).toISOString(),
      end: endOfMonth(day).toISOString(),
    };
  }
  return {
    start: startOfDay(day).toISOString(),
    end: endOfDay(day).toISOString(),
  };
}

export function shiftBoardDay(day: Date, view: SpaBoardView, delta: number) {
  if (view === 'month') return addMonths(day, delta);
  return addDays(day, view === 'week' ? delta * 7 : delta);
}

export function readStoredSpaBoardView(): SpaBoardView | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (raw === 'day' || raw === 'week' || raw === 'month') return raw;
  } catch {
    /* ignore */
  }
  return null;
}

export function writeStoredSpaBoardView(view: SpaBoardView) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    /* ignore */
  }
}

export function defaultSpaBoardView(): SpaBoardView {
  const stored = readStoredSpaBoardView();
  if (stored) return stored;
  if (typeof window === 'undefined') return 'week';
  return window.innerWidth < 640 ? 'day' : 'week';
}

export function readStoredSpaWeekScale(): SpaWeekScale | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = Number(window.localStorage.getItem(WEEK_SCALE_STORAGE_KEY));
    if ((SPA_WEEK_SCALE_STEPS as readonly number[]).includes(raw)) {
      return raw as SpaWeekScale;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function writeStoredSpaWeekScale(scale: SpaWeekScale) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(WEEK_SCALE_STORAGE_KEY, String(scale));
  } catch {
    /* ignore */
  }
}

export function defaultSpaWeekScale(): SpaWeekScale {
  return readStoredSpaWeekScale() ?? 100;
}

export function nudgeSpaWeekScale(
  current: SpaWeekScale,
  delta: -1 | 1,
): SpaWeekScale {
  const idx = SPA_WEEK_SCALE_STEPS.indexOf(current);
  const next = Math.max(
    0,
    Math.min(SPA_WEEK_SCALE_STEPS.length - 1, (idx < 0 ? 2 : idx) + delta),
  );
  return SPA_WEEK_SCALE_STEPS[next]!;
}

export function readStoredMonthShowEmptyWork(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(MONTH_EMPTY_WORK_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeStoredMonthShowEmptyWork(on: boolean) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MONTH_EMPTY_WORK_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}
