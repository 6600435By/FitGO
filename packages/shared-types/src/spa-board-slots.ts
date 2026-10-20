/** Staff may layer bookings by at most this many minutes (per neighbor). */
export const SPA_OVERLAP_ALLOW_MIN = 15;

/** Gaps shorter than this are not shown as free-time strips. */
export const SPA_FREE_GAP_MIN = 15;

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
  /** Milliseconds of overlap with the worst neighbor (0 = fits clean). */
  maxOverlapMin: number;
  peers: SpaOverlapPeer[];
  /** True when every peer overlap is ≤ SPA_OVERLAP_ALLOW_MIN. */
  allowedWithConfirm: boolean;
  /** True when there is no overlap at all. */
  fitsClean: boolean;
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

/**
 * How a candidate interval overlaps existing bookings (excluding excludeId).
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
  return {
    maxOverlapMin,
    peers: hits,
    fitsClean: maxOverlapMin === 0,
    allowedWithConfirm: hits.every((h) => h.overlapMin <= allowMin),
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
