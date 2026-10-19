/** Shared day/week period helpers for SPA journal. */

export type SpaBoardView = 'day' | 'week';

const VIEW_STORAGE_KEY = 'fitgo.spa-board.view';

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
  return {
    start: startOfDay(day).toISOString(),
    end: endOfDay(day).toISOString(),
  };
}

export function shiftBoardDay(day: Date, view: SpaBoardView, delta: number) {
  return addDays(day, view === 'week' ? delta * 7 : delta);
}

export function readStoredSpaBoardView(): SpaBoardView | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (raw === 'day' || raw === 'week') return raw;
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
