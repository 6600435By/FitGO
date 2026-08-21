export const GRID_SLOT_MINUTES = 15;
export const SLOT_HEIGHT_PX = 24;

export type ScheduleView = 'day' | 'week' | 'month';

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function dateKey(d: Date): string {
  return d.toLocaleDateString('fr-CA');
}

export function minutesFromIso(dateStr: string, iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (dateKey(d) !== dateStr) return null;
  return d.getHours() * 60 + d.getMinutes();
}

export function isoAtMinutes(dateStr: string, minutes: number): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d.toISOString();
}

export function getEventLayout(
  dateStr: string,
  bounds: { start: number; end: number },
  startAt: string,
  endAt: string,
): { top: number; height: number } | null {
  const topMin = minutesFromIso(dateStr, startAt);
  const endMin = minutesFromIso(dateStr, endAt);
  if (topMin === null || endMin === null || endMin <= topMin) return null;

  const top = ((topMin - bounds.start) / GRID_SLOT_MINUTES) * SLOT_HEIGHT_PX;
  const height = Math.max(
    ((endMin - topMin) / GRID_SLOT_MINUTES) * SLOT_HEIGHT_PX,
    SLOT_HEIGHT_PX,
  );
  if (!Number.isFinite(top) || !Number.isFinite(height)) return null;
  return { top, height };
}

export function topPxFromMinutes(minutes: number, boundsStart: number): number {
  return ((minutes - boundsStart) / GRID_SLOT_MINUTES) * SLOT_HEIGHT_PX;
}

export function getGridBounds(
  events: { startAt: string; endAt: string }[],
  dateStr: string,
  fallback?: { start: number; end: number },
): { start: number; end: number } {
  let start = fallback?.start ?? 7 * 60;
  let end = fallback?.end ?? 22 * 60;

  for (const event of events) {
    const topMin = minutesFromIso(dateStr, event.startAt);
    const endMin = minutesFromIso(dateStr, event.endAt);
    if (topMin === null || endMin === null) continue;
    start = Math.min(start, topMin);
    end = Math.max(end, endMin);
  }

  start = Math.floor(start / GRID_SLOT_MINUTES) * GRID_SLOT_MINUTES;
  end = Math.ceil(end / GRID_SLOT_MINUTES) * GRID_SLOT_MINUTES;
  if (end <= start) return { start: 7 * 60, end: 22 * 60 };
  return { start, end };
}

export function getDayWorkBounds(
  dateStr: string,
  availabilityBlocks: Array<{
    startAt: string;
    endAt: string;
    status: string;
  }>,
): { start: number; end: number } | null {
  const published = availabilityBlocks.filter(
    (b) => b.status === 'PUBLISHED' && minutesFromIso(dateStr, b.startAt) !== null,
  );
  if (published.length === 0) return null;

  let start = 24 * 60;
  let end = 0;
  for (const block of published) {
    const topMin = minutesFromIso(dateStr, block.startAt);
    const endMin = minutesFromIso(dateStr, block.endAt);
    if (topMin === null || endMin === null) continue;
    start = Math.min(start, topMin);
    end = Math.max(end, endMin);
  }
  if (start >= end) return null;
  return {
    start: Math.floor(start / GRID_SLOT_MINUTES) * GRID_SLOT_MINUTES,
    end: Math.ceil(end / GRID_SLOT_MINUTES) * GRID_SLOT_MINUTES,
  };
}

export function getDisplayBoundsForDay(
  dateStr: string,
  events: { startAt: string; endAt: string }[],
  availabilityBlocks: Array<{ startAt: string; endAt: string; status: string }>,
): { start: number; end: number } {
  const dayEvents = events.filter(
    (e) => minutesFromIso(dateStr, e.startAt) !== null,
  );
  const work = getDayWorkBounds(dateStr, availabilityBlocks);
  if (work) return work;
  return getGridBounds(dayEvents, dateStr);
}

export function getWeekGridBounds(
  events: { startAt: string; endAt: string }[],
  dayKeys: string[],
  availabilityBlocks: Array<{ startAt: string; endAt: string; status: string }>,
): { start: number; end: number } {
  let start = 24 * 60;
  let end = 0;
  let hasWork = false;

  for (const day of dayKeys) {
    const work = getDayWorkBounds(day, availabilityBlocks);
    if (work) {
      hasWork = true;
      start = Math.min(start, work.start);
      end = Math.max(end, work.end);
    }
  }

  if (hasWork) return { start, end };

  return getWeekGridBoundsFromEvents(events, dayKeys);
}

function getWeekGridBoundsFromEvents(
  events: { startAt: string; endAt: string }[],
  dayKeys: string[],
): { start: number; end: number } {
  let start = 7 * 60;
  let end = 22 * 60;

  for (const day of dayKeys) {
    const dayBounds = getGridBounds(events, day, { start, end });
    start = Math.min(start, dayBounds.start);
    end = Math.max(end, dayBounds.end);
  }

  return { start, end };
}

export function generateTimeLabels(start: number, end: number): number[] {
  const labels: number[] = [];
  for (let m = start; m < end; m += GRID_SLOT_MINUTES) {
    labels.push(m);
  }
  return labels;
}

export function formatMinutesLabel(minutes: number): string {
  if (minutes % 60 !== 0) return '';
  return minutesToTime(minutes);
}

export type MinuteInterval = { start: number; end: number };

export function getOverlapRegions(
  dateStr: string,
  events: { startAt: string; endAt: string }[],
): MinuteInterval[] {
  type Ev = { t: number; delta: number };
  const points: Ev[] = [];

  for (const event of events) {
    const start = minutesFromIso(dateStr, event.startAt);
    const end = minutesFromIso(dateStr, event.endAt);
    if (start === null || end === null || end <= start) continue;
    points.push({ t: start, delta: 1 }, { t: end, delta: -1 });
  }

  points.sort((a, b) => a.t - b.t || a.delta - b.delta);

  let count = 0;
  let overlapStart: number | null = null;
  const regions: MinuteInterval[] = [];

  for (const point of points) {
    const prev = count;
    count += point.delta;
    if (prev < 2 && count >= 2) overlapStart = point.t;
    else if (prev >= 2 && count < 2 && overlapStart !== null) {
      regions.push({ start: overlapStart, end: point.t });
      overlapStart = null;
    }
  }

  return regions;
}

export function shiftDateKey(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

export function formatDateTitle(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    weekday: 'long',
  });
}

export function weekDayKeys(anchor: Date): string[] {
  const monday = new Date(anchor);
  const day = monday.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  monday.setDate(monday.getDate() + diff);
  monday.setHours(12, 0, 0, 0);

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return dateKey(d);
  });
}
