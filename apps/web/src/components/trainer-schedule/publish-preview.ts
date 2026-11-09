import type {
  SchedulePublishSummary,
  TrainerAvailabilityBlock,
  TrainerCalendarEvent,
} from '@fitgo/shared-types';

export type PublishPreviewLine = {
  id: string;
  startAt: string;
  endAt: string;
  kind: 'draft_window' | 'series_slot';
  /** Human-readable change description. */
  change: string;
  occupied: boolean;
};

function overlaps(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return new Date(aStart) < new Date(bEnd) && new Date(aEnd) > new Date(bStart);
}

function inRange(iso: string, rangeStart: string, rangeEnd: string): boolean {
  const t = new Date(iso).getTime();
  return t >= new Date(rangeStart).getTime() && t <= new Date(rangeEnd).getTime();
}

/**
 * Pure preview of what publish will do — no network, no counter rewrite.
 * Occupied drafts stay windows but are not free for clients.
 */
export function buildPublishPreview(input: {
  rangeStart: string;
  rangeEnd: string;
  availabilityBlocks: TrainerAvailabilityBlock[];
  events: TrainerCalendarEvent[];
  summary?: SchedulePublishSummary;
}): {
  periodStart: string;
  periodEnd: string;
  lines: PublishPreviewLine[];
  windowCount: number;
  occupiedByClients: number;
  freeForClients: number;
  draftBlockCount: number;
} {
  const liveBookings = input.events.filter(
    (e) => e.kind === 'PERSONAL' && e.bookingStatus !== 'CANCELLED',
  );

  const drafts = input.availabilityBlocks.filter(
    (b) =>
      (b.kind === 'OPEN' || b.kind == null) &&
      b.status === 'DRAFT' &&
      new Date(b.startAt) < new Date(input.rangeEnd) &&
      new Date(b.endAt) > new Date(input.rangeStart),
  );

  const lines: PublishPreviewLine[] = drafts.map((block) => {
    const occupied = liveBookings.some((b) =>
      overlaps(b.startAt, b.endAt, block.startAt, block.endAt),
    );
    return {
      id: `draft-${block.id}`,
      startAt: block.startAt,
      endAt: block.endAt,
      kind: 'draft_window' as const,
      change: occupied
        ? 'станет опубликованным окном · занято, клиентам как свободное не откроется'
        : 'станет опубликованным окном',
      occupied,
    };
  });

  const series = (input.summary?.pendingSeriesSlots ?? []).filter(
    (s) =>
      inRange(s.startAt, input.rangeStart, input.rangeEnd) ||
      (new Date(s.startAt) < new Date(input.rangeEnd) &&
        new Date(s.endAt) > new Date(input.rangeStart)),
  );

  for (const slot of series) {
    lines.push({
      id: `series-${slot.startAt}`,
      startAt: slot.startAt,
      endAt: slot.endAt,
      kind: 'series_slot',
      change: 'появится запись серии',
      occupied: true,
    });
  }

  lines.sort((a, b) => a.startAt.localeCompare(b.startAt));

  const windowCount = input.summary?.windowCount ?? drafts.length;
  const occupiedByClients =
    input.summary?.occupiedByClients ??
    drafts.filter((block) =>
      liveBookings.some((b) =>
        overlaps(b.startAt, b.endAt, block.startAt, block.endAt),
      ),
    ).length;
  const freeForClients =
    input.summary?.freeForClients ??
    Math.max(0, windowCount - occupiedByClients);

  return {
    periodStart: input.rangeStart,
    periodEnd: input.rangeEnd,
    lines,
    windowCount,
    occupiedByClients,
    freeForClients,
    draftBlockCount: drafts.length,
  };
}
