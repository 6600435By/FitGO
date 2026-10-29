/**
 * Free-slot pick for «В журнал»: earliest clean window in the specialist's
 * published shift on the visit's Minsk calendar day (no 15‑min overlap).
 */
import { suggestSpaFitStarts, type SpaIntervalMs } from '@fitgo/shared-types';

export type SpaJournalSlotPick =
  | { kind: 'ok'; startAt: Date; endAt: Date }
  | { kind: 'no_shift' }
  | { kind: 'no_free_slot' };

/** Europe/Minsk day bounds as UTC Date (Minsk = UTC+3, no DST). */
export function minskDayBoundsUtc(day: string): { start: Date; end: Date } {
  return {
    start: new Date(`${day}T00:00:00+03:00`),
    end: new Date(`${day}T23:59:59.999+03:00`),
  };
}

/** Display «29.10» from YYYY-MM-DD. */
export function formatMinskDayShort(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!m) return day;
  return `${m[3]}.${m[2]}`;
}

/** Display «10:00–10:50» in Europe/Minsk. */
export function formatMinskTimeRange(startAt: Date, endAt: Date): string {
  const fmt = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Minsk',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${fmt.format(startAt)}–${fmt.format(endAt)}`;
}

/**
 * Earliest clean fit for `durationMin` inside published work bands after
 * subtracting existing journal bookings. Overlap allowance is always 0.
 */
export function pickEarliestCleanSpaJournalSlot(opts: {
  workBands: SpaIntervalMs[];
  bookings: Array<{ id: string; startMs: number; endMs: number }>;
  durationMin: number;
}): SpaJournalSlotPick {
  const durationMin = Math.max(1, Math.round(opts.durationMin));
  const bands = opts.workBands.filter((b) => b.endMs > b.startMs);
  if (bands.length === 0) return { kind: 'no_shift' };

  const suggestions = suggestSpaFitStarts(
    bands,
    opts.bookings.map((b) => ({
      id: b.id,
      label: b.id,
      startMs: b.startMs,
      endMs: b.endMs,
    })),
    durationMin,
    {
      allowOverlapMin: 0,
      stepMin: 5,
      maxSuggestions: 24,
    },
  );
  const clean = suggestions.find((s) => s.kind === 'clean' && s.overlapMin === 0);
  if (!clean) return { kind: 'no_free_slot' };
  return {
    kind: 'ok',
    startAt: new Date(clean.startMs),
    endAt: new Date(clean.endMs),
  };
}
