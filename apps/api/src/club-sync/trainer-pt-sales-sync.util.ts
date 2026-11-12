import { addMoscowDays } from './moscow-time';

/** Same ≤5-day windows as booking-control «Обновить из 1С» (avoids 1C/proxy timeouts). */
export const TRAINER_PT_SALES_CHUNK_DAYS = 5;

/**
 * Soft-deactivate only when the pull looks complete enough.
 * Empty / tiny pulls must not wipe the cache (timeouts used to return [] and
 * deactivate the whole FULL window → PT rows + ЗП flickered).
 */
export function shouldSoftDeactivateTrainerPtSales(opts: {
  seenCount: number;
  existingActiveCount: number;
}): boolean {
  const { seenCount, existingActiveCount } = opts;
  if (seenCount <= 0) return false;
  // Meaningful cache + pull < half → treat as truncated / partial failure.
  if (existingActiveCount >= 5 && seenCount < existingActiveCount * 0.5) {
    return false;
  }
  return true;
}

/** Inclusive YYYY-MM-DD ranges of at most `maxDays` calendar days each. */
export function splitYmdRangeInclusive(
  from: string,
  to: string,
  maxDays = TRAINER_PT_SALES_CHUNK_DAYS,
): Array<{ from: string; to: string }> {
  if (from > to) return [];
  const span = Math.max(1, maxDays);
  const out: Array<{ from: string; to: string }> = [];
  let cursor = from;
  while (cursor <= to) {
    const chunkTo = minYmd(addMoscowDays(cursor, span - 1), to);
    out.push({ from: cursor, to: chunkTo });
    cursor = addMoscowDays(chunkTo, 1);
  }
  return out;
}

function minYmd(a: string, b: string): string {
  return a <= b ? a : b;
}
