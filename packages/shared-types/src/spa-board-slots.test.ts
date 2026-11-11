/**
 * SPA client :00/:30 grid + soft reserve snap.
 * Run: npx tsx --test packages/shared-types/src/spa-board-slots.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeSpaFreeWindows,
  listRoundSpaClientSlots,
  snapSpaClientReserveEnd,
} from './spa-board-slots';

/** Minsk wall time → UTC ms (Minsk = UTC+3). */
function minsk(isoLocal: string): number {
  return new Date(`${isoLocal}+03:00`).getTime();
}

describe('snapSpaClientReserveEnd', () => {
  it('leaves exact :00 and :30 unchanged', () => {
    assert.equal(snapSpaClientReserveEnd(minsk('2026-11-11T10:00:00')), minsk('2026-11-11T10:00:00'));
    assert.equal(snapSpaClientReserveEnd(minsk('2026-11-11T10:30:00')), minsk('2026-11-11T10:30:00'));
  });

  it('snaps :05–:25 to :30 same hour', () => {
    assert.equal(snapSpaClientReserveEnd(minsk('2026-11-11T10:05:00')), minsk('2026-11-11T10:30:00'));
    assert.equal(snapSpaClientReserveEnd(minsk('2026-11-11T10:20:00')), minsk('2026-11-11T10:30:00'));
    assert.equal(snapSpaClientReserveEnd(minsk('2026-11-11T10:25:00')), minsk('2026-11-11T10:30:00'));
  });

  it('snaps :35–:55 to :00 next hour', () => {
    assert.equal(snapSpaClientReserveEnd(minsk('2026-11-11T10:35:00')), minsk('2026-11-11T11:00:00'));
    assert.equal(snapSpaClientReserveEnd(minsk('2026-11-11T10:50:00')), minsk('2026-11-11T11:00:00'));
    assert.equal(snapSpaClientReserveEnd(minsk('2026-11-11T10:55:00')), minsk('2026-11-11T11:00:00'));
  });
});

describe('listRoundSpaClientSlots', () => {
  const shift = {
    startMs: minsk('2026-11-11T10:00:00'),
    endMs: minsk('2026-11-11T18:00:00'),
  };
  const nowBefore = minsk('2026-11-11T09:00:00');

  it('offers only :00 and :30 on an empty shift', () => {
    const slots = listRoundSpaClientSlots({
      workBands: [shift],
      bookings: [],
      durationMin: 60,
      nowMs: nowBefore,
      rangeStartMs: shift.startMs,
      rangeEndMs: shift.endMs,
    });
    assert.equal(slots[0]?.startMs, minsk('2026-11-11T10:00:00'));
    assert.equal(slots[1]?.startMs, minsk('2026-11-11T10:30:00'));
    assert.equal(slots[2]?.startMs, minsk('2026-11-11T11:00:00'));
    assert.ok(slots.every((s) => {
      const m = new Date(s.startMs + 3 * 3600_000).getUTCMinutes();
      return m === 0 || m === 30;
    }));
  });

  it('after end 10:20 next client start is 10:30', () => {
    const slots = listRoundSpaClientSlots({
      workBands: [shift],
      bookings: [
        {
          startMs: minsk('2026-11-11T09:30:00'),
          endMs: minsk('2026-11-11T10:20:00'),
        },
      ],
      durationMin: 60,
      nowMs: nowBefore,
      rangeStartMs: shift.startMs,
      rangeEndMs: shift.endMs,
    });
    assert.equal(slots[0]?.startMs, minsk('2026-11-11T10:30:00'));
    assert.ok(
      !slots.some((s) => s.startMs === minsk('2026-11-11T10:00:00')),
    );
  });

  it('after end 10:40 slot 10:30 is taken; next is 11:00', () => {
    const slots = listRoundSpaClientSlots({
      workBands: [shift],
      bookings: [
        {
          startMs: minsk('2026-11-11T09:45:00'),
          endMs: minsk('2026-11-11T10:40:00'),
        },
      ],
      durationMin: 60,
      nowMs: nowBefore,
      rangeStartMs: shift.startMs,
      rangeEndMs: shift.endMs,
    });
    assert.ok(
      !slots.some((s) => s.startMs === minsk('2026-11-11T10:30:00')),
    );
    assert.equal(slots[0]?.startMs, minsk('2026-11-11T11:00:00'));
  });

  it('ceils shift start off the half-hour to the next :00/:30', () => {
    const slots = listRoundSpaClientSlots({
      workBands: [
        {
          startMs: minsk('2026-11-11T10:15:00'),
          endMs: minsk('2026-11-11T14:00:00'),
        },
      ],
      bookings: [],
      durationMin: 60,
      nowMs: nowBefore,
      rangeStartMs: minsk('2026-11-11T10:00:00'),
      rangeEndMs: minsk('2026-11-11T14:00:00'),
    });
    assert.equal(slots[0]?.startMs, minsk('2026-11-11T10:30:00'));
  });

  it('booking ending on :30 allows the next start at that :30', () => {
    const slots = listRoundSpaClientSlots({
      workBands: [shift],
      bookings: [
        {
          startMs: minsk('2026-11-11T09:30:00'),
          endMs: minsk('2026-11-11T10:30:00'),
        },
      ],
      durationMin: 55,
      nowMs: nowBefore,
      rangeStartMs: shift.startMs,
      rangeEndMs: shift.endMs,
    });
    assert.equal(slots[0]?.startMs, minsk('2026-11-11T10:30:00'));
  });
});

describe('staff free window includes soft client reserve', () => {
  it('shows свободно from real endAt 10:20 (inside client reserve to 10:30)', () => {
    const shift = {
      startMs: minsk('2026-11-11T10:00:00'),
      endMs: minsk('2026-11-11T18:00:00'),
    };
    const windows = computeSpaFreeWindows(
      [shift],
      [
        {
          startMs: minsk('2026-11-11T10:00:00'),
          endMs: minsk('2026-11-11T10:20:00'),
        },
      ],
      15,
    );
    assert.equal(windows[0]?.startMs, minsk('2026-11-11T10:20:00'));
    assert.equal(snapSpaClientReserveEnd(minsk('2026-11-11T10:20:00')), minsk('2026-11-11T10:30:00'));

    const clientSlots = listRoundSpaClientSlots({
      workBands: [shift],
      bookings: [
        {
          startMs: minsk('2026-11-11T10:00:00'),
          endMs: minsk('2026-11-11T10:20:00'),
        },
      ],
      durationMin: 60,
      nowMs: minsk('2026-11-11T09:00:00'),
      rangeStartMs: shift.startMs,
      rangeEndMs: shift.endMs,
    });
    assert.equal(clientSlots[0]?.startMs, minsk('2026-11-11T10:30:00'));
    assert.ok(windows[0]!.startMs < clientSlots[0]!.startMs);
  });
});
