/** Staff may layer bookings by at most this many minutes (per neighbor). */
export const SPA_OVERLAP_ALLOW_MIN = 15;

/** Gaps shorter than this are not shown as free-time strips. */
export const SPA_FREE_GAP_MIN = 15;

/** Staff «закрыть запись» placeholder occupying a free gap. */
export const SPA_TIME_BLOCK_GUEST_NAME = 'Закрыто';
export const SPA_TIME_BLOCK_ALIAS = '__TIME_BLOCK__';

export function isSpaTimeBlock(booking: {
  guestAlias?: string | null;
  guestName?: string | null;
}): boolean {
  return (
    booking.guestAlias === SPA_TIME_BLOCK_ALIAS ||
    booking.guestName === SPA_TIME_BLOCK_GUEST_NAME
  );
}

export type SpaIntervalMs = {
  startMs: number;
  endMs: number;
};

export type SpaFreeWindow = SpaIntervalMs & {
  durationMin: number;
};

export type SpaOverlapPeer = {
  id: string;
  label: string;
  startMs: number;
  endMs: number;
  overlapMin: number;
};

export type SpaPlacementCheck = {
  /** Minutes of overlap with the worst neighbor (0 = fits clean). */
  maxOverlapMin: number;
  peers: SpaOverlapPeer[];
  /** True when every peer overlap is ≤ SPA_OVERLAP_ALLOW_MIN and stack depth ≤ 2. */
  allowedWithConfirm: boolean;
  /** True when there is no overlap at all. */
  fitsClean: boolean;
  /** Max concurrent bookings if this interval is placed (1 = alone). */
  maxStackDepth: number;
};

export type SpaFitSuggestion = {
  startMs: number;
  endMs: number;
  overlapMin: number;
  kind: 'clean' | 'overlap';
};

function overlapMinutes(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number {
  const start = Math.max(aStart, bStart);
  const end = Math.min(aEnd, bEnd);
  if (end <= start) return 0;
  return Math.round((end - start) / 60_000);
}

/**
 * Free gaps inside published work bands after subtracting confirmed bookings.
 * Only returns gaps ≥ SPA_FREE_GAP_MIN.
 */
export function computeSpaFreeWindows(
  workBands: SpaIntervalMs[],
  bookings: SpaIntervalMs[],
  minGapMin: number = SPA_FREE_GAP_MIN,
): SpaFreeWindow[] {
  const minMs = minGapMin * 60_000;
  const bands = [...workBands]
    .filter((b) => b.endMs > b.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  const busy = [...bookings]
    .filter((b) => b.endMs > b.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  const windows: SpaFreeWindow[] = [];

  for (const band of bands) {
    let cursor = band.startMs;
    for (const b of busy) {
      if (b.endMs <= cursor) continue;
      if (b.startMs >= band.endMs) break;
      const gapStart = cursor;
      const gapEnd = Math.min(b.startMs, band.endMs);
      if (gapEnd - gapStart >= minMs) {
        windows.push({
          startMs: gapStart,
          endMs: gapEnd,
          durationMin: Math.round((gapEnd - gapStart) / 60_000),
        });
      }
      cursor = Math.max(cursor, Math.min(b.endMs, band.endMs));
      if (cursor >= band.endMs) break;
    }
    if (band.endMs - cursor >= minMs) {
      windows.push({
        startMs: cursor,
        endMs: band.endMs,
        durationMin: Math.round((band.endMs - cursor) / 60_000),
      });
    }
  }

  return windows;
}

/** Max concurrent bookings at one instant when stacking (candidate + peers). */
export const SPA_MAX_STACK_DEPTH = 2;

/**
 * Sweep-line max depth for half-open [start, end) intervals.
 */
export function spaStackDepth(
  intervals: Array<{ startMs: number; endMs: number }>,
): number {
  const events: Array<{ t: number; d: number }> = [];
  for (const iv of intervals) {
    if (iv.endMs <= iv.startMs) continue;
    events.push({ t: iv.startMs, d: 1 });
    events.push({ t: iv.endMs, d: -1 });
  }
  // At the same timestamp process ends (-1) before starts (+1).
  events.sort((a, b) => a.t - b.t || a.d - b.d);
  let depth = 0;
  let max = 0;
  for (const e of events) {
    depth += e.d;
    if (depth > max) max = depth;
  }
  return max;
}

/**
 * How a candidate interval overlaps existing bookings (excluding excludeId).
 * Stacking is allowed only for exactly two layers, each pairwise overlap ≤ allowMin.
 */
export function checkSpaPlacement(
  startMs: number,
  endMs: number,
  peers: Array<{
    id: string;
    label: string;
    startMs: number;
    endMs: number;
  }>,
  allowMin: number = SPA_OVERLAP_ALLOW_MIN,
): SpaPlacementCheck {
  const hits: SpaOverlapPeer[] = [];
  for (const p of peers) {
    const overlapMin = overlapMinutes(startMs, endMs, p.startMs, p.endMs);
    if (overlapMin <= 0) continue;
    hits.push({
      id: p.id,
      label: p.label,
      startMs: p.startMs,
      endMs: p.endMs,
      overlapMin,
    });
  }
  hits.sort((a, b) => b.overlapMin - a.overlapMin);
  const maxOverlapMin = hits[0]?.overlapMin ?? 0;
  const maxStackDepth = spaStackDepth([
    { startMs, endMs },
    ...hits.map((h) => ({ startMs: h.startMs, endMs: h.endMs })),
  ]);
  const overlapsOk = hits.every((h) => h.overlapMin <= allowMin);
  const stackOk = maxStackDepth <= SPA_MAX_STACK_DEPTH;
  return {
    maxOverlapMin,
    peers: hits,
    fitsClean: maxOverlapMin === 0,
    allowedWithConfirm: overlapsOk && stackOk && maxOverlapMin > 0,
    maxStackDepth,
  };
}

/**
 * Suggest starts for a service duration inside free windows, plus starts that
 * need a small overlap (≤ allowMin) to fit against a neighbor.
 */
export function suggestSpaFitStarts(
  workBands: SpaIntervalMs[],
  bookings: Array<{
    id: string;
    label: string;
    startMs: number;
    endMs: number;
  }>,
  durationMin: number,
  options?: {
    allowOverlapMin?: number;
    stepMin?: number;
    maxSuggestions?: number;
  },
): SpaFitSuggestion[] {
  const allowMin = options?.allowOverlapMin ?? SPA_OVERLAP_ALLOW_MIN;
  const stepMin = options?.stepMin ?? 5;
  const maxSuggestions = options?.maxSuggestions ?? 12;
  const durationMs = durationMin * 60_000;
  const stepMs = stepMin * 60_000;
  const peers = bookings.map((b) => ({
    id: b.id,
    label: b.label,
    startMs: b.startMs,
    endMs: b.endMs,
  }));

  const free = computeSpaFreeWindows(
    workBands,
    bookings.map((b) => ({ startMs: b.startMs, endMs: b.endMs })),
    1,
  );

  const out: SpaFitSuggestion[] = [];
  const seen = new Set<number>();

  const push = (startMs: number) => {
    if (seen.has(startMs)) return;
    const endMs = startMs + durationMs;
    const check = checkSpaPlacement(startMs, endMs, peers, allowMin);
    if (!check.fitsClean && !check.allowedWithConfirm) return;
    // Must still sit inside some published band.
    const inBand = workBands.some(
      (band) => startMs >= band.startMs && endMs <= band.endMs,
    );
    if (!inBand) return;
    seen.add(startMs);
    out.push({
      startMs,
      endMs,
      overlapMin: check.maxOverlapMin,
      kind: check.fitsClean ? 'clean' : 'overlap',
    });
  };

  // Clean fits: start at the beginning of each free window that is long enough.
  for (const w of free) {
    if (w.durationMin >= durationMin) {
      push(w.startMs);
      for (
        let t = w.startMs + stepMs;
        t + durationMs <= w.endMs;
        t += stepMs
      ) {
        push(t);
        if (out.length >= maxSuggestions) return out;
      }
    }
  }

  // Overlap fits: start so the service ends up to allowMin into the next booking,
  // or starts up to allowMin before the previous booking ends — only when a clean
  // window is shorter than duration.
  for (const w of free) {
    if (w.durationMin >= durationMin) continue;
    if (w.durationMin + allowMin < durationMin) continue;
    // Start at window start → overlaps into whatever follows the gap.
    push(w.startMs);
    // Start late enough that the booking ends exactly at window end
    // (overlaps into whatever precedes the gap).
    const lateStart = w.endMs - durationMs;
    if (lateStart < w.startMs) {
      push(lateStart);
    }
    if (out.length >= maxSuggestions) break;
  }

  return out
    .sort((a, b) => a.startMs - b.startMs || a.overlapMin - b.overlapMin)
    .slice(0, maxSuggestions);
}

/** Europe/Minsk is UTC+3 year-round (no DST). */
const MINSK_OFFSET_MS = 3 * 60 * 60 * 1000;

const HALF_HOUR_MS = 30 * 60_000;

/**
 * Soft client reserve end: next Europe/Minsk :00 or :30 after `endMs`.
 * Already on :00/:30 (exact second) → same instant (no reserve).
 * :05–:25 → :30 same hour; :35–:55 → :00 next hour.
 */
export function snapSpaClientReserveEnd(endMs: number): number {
  const local = new Date(endMs + MINSK_OFFSET_MS);
  const y = local.getUTCFullYear();
  const mo = local.getUTCMonth();
  const d = local.getUTCDate();
  const h = local.getUTCHours();
  const m = local.getUTCMinutes();
  const s = local.getUTCSeconds();
  const ms = local.getUTCMilliseconds();

  if ((m === 0 || m === 30) && s === 0 && ms === 0) {
    return endMs;
  }

  const targetLocal =
    m < 30
      ? Date.UTC(y, mo, d, h, 30, 0, 0)
      : Date.UTC(y, mo, d, h + 1, 0, 0, 0);
  return targetLocal - MINSK_OFFSET_MS;
}

/**
 * Earliest Europe/Minsk :00 or :30 at or after `ms` (exact second).
 * Same rule as {@link snapSpaClientReserveEnd}.
 */
export function ceilSpaClientHalfHour(ms: number): number {
  return snapSpaClientReserveEnd(ms);
}

export type SpaRoundClientSlot = {
  startMs: number;
  endMs: number;
};

/**
 * Client-facing SPA starts on the Europe/Minsk :00 / :30 grid.
 * Occupancy length is `durationMin` (callers pass duration + buffer).
 * Overlap uses real booking `[start, end)` — soft reserve is implied by the grid.
 */
export function listRoundSpaClientSlots(opts: {
  workBands: SpaIntervalMs[];
  bookings: SpaIntervalMs[];
  durationMin: number;
  nowMs?: number;
  rangeStartMs?: number;
  rangeEndMs?: number;
}): SpaRoundClientSlot[] {
  const durationMs = Math.max(1, Math.round(opts.durationMin)) * 60_000;
  const nowMs = opts.nowMs ?? Date.now();
  const rangeStartMs = opts.rangeStartMs ?? nowMs;
  const rangeEndMs =
    opts.rangeEndMs ?? rangeStartMs + 14 * 24 * 60 * 60 * 1000;

  const bands = [...opts.workBands]
    .filter((b) => b.endMs > b.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  const busy = opts.bookings.filter((b) => b.endMs > b.startMs);

  const slots: SpaRoundClientSlot[] = [];
  const seen = new Set<number>();

  for (const band of bands) {
    let slotStart = ceilSpaClientHalfHour(band.startMs);
    while (slotStart + durationMs <= band.endMs) {
      const slotEnd = slotStart + durationMs;
      const isPast = slotStart <= nowMs;
      const inRange = slotStart >= rangeStartMs && slotStart < rangeEndMs;
      const overlaps = busy.some(
        (b) => b.startMs < slotEnd && b.endMs > slotStart,
      );

      if (!isPast && inRange && !overlaps && !seen.has(slotStart)) {
        seen.add(slotStart);
        slots.push({ startMs: slotStart, endMs: slotEnd });
      }

      slotStart += HALF_HOUR_MS;
    }
  }

  return slots.sort((a, b) => a.startMs - b.startMs);
}

/**
 * Pack overlapping intervals into side-by-side lanes (Google Calendar style).
 * Returns laneIndex and laneCount per id.
 */
export function packSpaBookingLanes(
  items: Array<{ id: string; startMs: number; endMs: number }>,
): Map<string, { lane: number; laneCount: number }> {
  const sorted = [...items].sort(
    (a, b) => a.startMs - b.startMs || a.endMs - b.endMs,
  );
  type Active = { id: string; endMs: number; lane: number };
  const active: Active[] = [];
  const assigned = new Map<string, number>();
  const clusterIds: string[] = [];
  let clusterMaxLane = 0;

  const flushCluster = () => {
    const count = clusterMaxLane + 1;
    for (const id of clusterIds) {
      const lane = assigned.get(id) ?? 0;
      result.set(id, { lane, laneCount: count });
    }
    clusterIds.length = 0;
    clusterMaxLane = 0;
  };

  const result = new Map<string, { lane: number; laneCount: number }>();

  for (const item of sorted) {
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i]!.endMs <= item.startMs) active.splice(i, 1);
    }
    if (active.length === 0 && clusterIds.length > 0) {
      flushCluster();
    }
    const used = new Set(active.map((a) => a.lane));
    let lane = 0;
    while (used.has(lane)) lane += 1;
    active.push({ id: item.id, endMs: item.endMs, lane });
    assigned.set(item.id, lane);
    clusterIds.push(item.id);
    clusterMaxLane = Math.max(clusterMaxLane, lane);
  }
  if (clusterIds.length > 0) flushCluster();

  return result;
}
