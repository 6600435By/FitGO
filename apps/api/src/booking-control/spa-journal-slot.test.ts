/**
 * Run: cd apps/api && npx ts-node --transpile-only src/booking-control/spa-journal-slot.test.ts
 */
import assert from 'node:assert/strict';
import {
  formatMinskDayShort,
  formatMinskTimeRange,
  minskDayBoundsUtc,
  pickEarliestCleanSpaJournalSlot,
} from './spa-journal-slot';

function ms(iso: string): number {
  return new Date(iso).getTime();
}

{
  const { start, end } = minskDayBoundsUtc('2026-10-29');
  assert.equal(start.toISOString(), '2026-10-28T21:00:00.000Z');
  assert.equal(end.toISOString(), '2026-10-29T20:59:59.999Z');
}

assert.equal(formatMinskDayShort('2026-10-29'), '29.10');
assert.equal(
  formatMinskTimeRange(
    new Date('2026-10-29T07:00:00.000Z'),
    new Date('2026-10-29T07:50:00.000Z'),
  ),
  '10:00–10:50',
);

{
  const pick = pickEarliestCleanSpaJournalSlot({
    workBands: [],
    bookings: [],
    durationMin: 50,
  });
  assert.equal(pick.kind, 'no_shift');
}

{
  // Full shift free → start of band.
  const pick = pickEarliestCleanSpaJournalSlot({
    workBands: [
      {
        startMs: ms('2026-10-29T07:00:00.000Z'),
        endMs: ms('2026-10-29T15:00:00.000Z'),
      },
    ],
    bookings: [],
    durationMin: 50,
  });
  assert.equal(pick.kind, 'ok');
  if (pick.kind === 'ok') {
    assert.equal(pick.startAt.toISOString(), '2026-10-29T07:00:00.000Z');
    assert.equal(pick.endAt.toISOString(), '2026-10-29T07:50:00.000Z');
  }
}

{
  // Gap after morning booking → next free start.
  const pick = pickEarliestCleanSpaJournalSlot({
    workBands: [
      {
        startMs: ms('2026-10-29T07:00:00.000Z'),
        endMs: ms('2026-10-29T15:00:00.000Z'),
      },
    ],
    bookings: [
      {
        id: 'a',
        startMs: ms('2026-10-29T07:00:00.000Z'),
        endMs: ms('2026-10-29T07:50:00.000Z'),
      },
    ],
    durationMin: 50,
  });
  assert.equal(pick.kind, 'ok');
  if (pick.kind === 'ok') {
    assert.equal(pick.startAt.toISOString(), '2026-10-29T07:50:00.000Z');
    assert.equal(pick.endAt.toISOString(), '2026-10-29T08:40:00.000Z');
  }
}

{
  // Only a 40‑min gap for a 50‑min service → no clean fit (no overlap allowed).
  const pick = pickEarliestCleanSpaJournalSlot({
    workBands: [
      {
        startMs: ms('2026-10-29T07:00:00.000Z'),
        endMs: ms('2026-10-29T09:00:00.000Z'),
      },
    ],
    bookings: [
      {
        id: 'a',
        startMs: ms('2026-10-29T07:00:00.000Z'),
        endMs: ms('2026-10-29T07:50:00.000Z'),
      },
      {
        id: 'b',
        startMs: ms('2026-10-29T08:30:00.000Z'),
        endMs: ms('2026-10-29T09:00:00.000Z'),
      },
    ],
    durationMin: 50,
  });
  assert.equal(pick.kind, 'no_free_slot');
}

{
  // Packed solid → no free slot.
  const pick = pickEarliestCleanSpaJournalSlot({
    workBands: [
      {
        startMs: ms('2026-10-29T07:00:00.000Z'),
        endMs: ms('2026-10-29T08:00:00.000Z'),
      },
    ],
    bookings: [
      {
        id: 'a',
        startMs: ms('2026-10-29T07:00:00.000Z'),
        endMs: ms('2026-10-29T08:00:00.000Z'),
      },
    ],
    durationMin: 50,
  });
  assert.equal(pick.kind, 'no_free_slot');
}

console.log('spa-journal-slot.test.ts: ok');
