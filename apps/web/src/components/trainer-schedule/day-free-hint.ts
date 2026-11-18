import type {
  TrainerAvailabilityBlock,
  TrainerCalendarEvent,
} from '@fitgo/shared-types';
import { dateKey } from './schedule-grid';

const SESSION_MIN = 60;

export type DayFreeHint = {
  allocatedMin: number;
  freeMin: number;
  draftIds: string[];
  publishedIds: string[];
  firstFreeSlotStart: string | null;
  hasUnpublished: boolean;
};

function mergeIntervals(
  intervals: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: Array<{ start: number; end: number }> = [
    { ...sorted[0]! },
  ];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

function subtractBusy(
  free: Array<{ start: number; end: number }>,
  busy: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
  let result = free;
  for (const b of busy) {
    const next: Array<{ start: number; end: number }> = [];
    for (const f of result) {
      if (b.end <= f.start || b.start >= f.end) {
        next.push(f);
        continue;
      }
      if (b.start > f.start) next.push({ start: f.start, end: b.start });
      if (b.end < f.end) next.push({ start: b.end, end: f.end });
    }
    result = next;
  }
  return result;
}

function totalMin(intervals: Array<{ start: number; end: number }>) {
  return intervals.reduce((sum, i) => sum + Math.max(0, i.end - i.start), 0) /
    60_000;
}

export function formatFreeHours(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m === 0) return '0 мин';
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return `${rem} мин`;
  if (rem === 0) return `${h} ч`;
  return `${h} ч ${rem} мин`;
}

/** Free minutes inside trainer OPEN blocks for the selected day (duty excluded). */
export function computeDayFreeHint(
  day: Date,
  availabilityBlocks: TrainerAvailabilityBlock[],
  events: TrainerCalendarEvent[],
): DayFreeHint {
  const key = dateKey(day);
  const dayBlocks = availabilityBlocks.filter(
    (b) =>
      b.kind === 'OPEN' &&
      dateKey(new Date(b.startAt)) === key,
  );
  const draftIds = dayBlocks
    .filter((b) => b.status === 'DRAFT')
    .map((b) => b.id);
  const publishedIds = dayBlocks
    .filter((b) => b.status === 'PUBLISHED')
    .map((b) => b.id);

  const allocated = mergeIntervals(
    dayBlocks.map((b) => ({
      start: new Date(b.startAt).getTime(),
      end: new Date(b.endAt).getTime(),
    })),
  );

  const busy = events
    .filter((e) => {
      if (dateKey(new Date(e.startAt)) !== key) return false;
      if (e.kind === 'OPEN_SLOT' || e.kind === 'DRAFT_SLOT') return false;
      if (e.kind === 'DUTY') return false;
      if (e.bookingStatus === 'CANCELLED') return false;
      return (
        e.kind === 'PERSONAL' ||
        e.kind === 'GROUP' ||
        e.kind === 'HOLD_SLOT' ||
        e.kind === 'PERSONAL_BLOCK'
      );
    })
    .map((e) => ({
      start: new Date(e.startAt).getTime(),
      end: new Date(e.endAt).getTime(),
    }));

  const freeGaps = subtractBusy(allocated, mergeIntervals(busy));
  const freeMin = totalMin(freeGaps);
  const allocatedMin = totalMin(allocated);

  let firstFreeSlotStart: string | null = null;
  for (const gap of freeGaps) {
    if (gap.end - gap.start >= SESSION_MIN * 60_000) {
      firstFreeSlotStart = new Date(gap.start).toISOString();
      break;
    }
  }

  return {
    allocatedMin,
    freeMin,
    draftIds,
    publishedIds,
    firstFreeSlotStart,
    hasUnpublished: draftIds.length > 0,
  };
}
