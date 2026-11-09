/**
 * Run: cd apps/web && npx tsx --test src/components/trainer-schedule/publish-preview.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  TrainerAvailabilityBlock,
  TrainerCalendarEvent,
} from '@fitgo/shared-types';
import { buildPublishPreview } from './publish-preview';

const rangeStart = '2026-11-10T00:00:00.000Z';
const rangeEnd = '2026-11-10T23:59:59.999Z';

const draftWindow: TrainerAvailabilityBlock = {
  id: 'w1',
  startAt: '2026-11-10T10:00:00.000Z',
  endAt: '2026-11-10T11:00:00.000Z',
  status: 'DRAFT',
  kind: 'OPEN',
};

describe('buildPublishPreview', () => {
  it('keeps occupied 0→1 and free 1→0 when a confirmed booking sits on the window', () => {
    const empty = buildPublishPreview({
      rangeStart,
      rangeEnd,
      availabilityBlocks: [draftWindow],
      events: [],
      summary: {
        periodStart: rangeStart,
        periodEnd: rangeEnd,
        windowCount: 1,
        occupiedByClients: 0,
        freeForClients: 1,
        holdCount: 0,
        blockCount: 0,
        draftBlockCount: 1,
      },
    });
    assert.equal(empty.occupiedByClients, 0);
    assert.equal(empty.freeForClients, 1);
    assert.equal(empty.lines[0]?.change, 'станет опубликованным окном');

    const booking: TrainerCalendarEvent = {
      id: 'personal-b1',
      kind: 'PERSONAL',
      title: 'ПТ · Клиент',
      startAt: '2026-11-10T10:00:00.000Z',
      endAt: '2026-11-10T11:00:00.000Z',
      bookingStatus: 'CONFIRMED',
      bookingId: 'b1',
    };
    const occupied = buildPublishPreview({
      rangeStart,
      rangeEnd,
      availabilityBlocks: [draftWindow],
      events: [booking],
      summary: {
        periodStart: rangeStart,
        periodEnd: rangeEnd,
        windowCount: 1,
        occupiedByClients: 1,
        freeForClients: 0,
        holdCount: 0,
        blockCount: 0,
        draftBlockCount: 1,
      },
    });
    assert.equal(occupied.occupiedByClients, 1);
    assert.equal(occupied.freeForClients, 0);
    assert.match(occupied.lines[0]!.change, /занято/);
  });

  it('does not treat cancelled booking as occupying the window', () => {
    const cancelled: TrainerCalendarEvent = {
      id: 'personal-c1',
      kind: 'PERSONAL',
      title: 'Отмена · Клиент',
      startAt: '2026-11-10T10:00:00.000Z',
      endAt: '2026-11-10T11:00:00.000Z',
      bookingStatus: 'CANCELLED',
      bookingId: 'c1',
      cancelReason: 'Перенос по просьбе',
    };
    const preview = buildPublishPreview({
      rangeStart,
      rangeEnd,
      availabilityBlocks: [draftWindow],
      events: [cancelled],
      summary: {
        periodStart: rangeStart,
        periodEnd: rangeEnd,
        windowCount: 1,
        occupiedByClients: 0,
        freeForClients: 1,
        holdCount: 0,
        blockCount: 0,
        draftBlockCount: 1,
      },
    });
    assert.equal(preview.occupiedByClients, 0);
    assert.equal(preview.freeForClients, 1);
    assert.equal(preview.lines[0]?.occupied, false);
  });

  it('lists pending series slots separately without calling them duplicates', () => {
    const preview = buildPublishPreview({
      rangeStart,
      rangeEnd,
      availabilityBlocks: [draftWindow],
      events: [],
      summary: {
        periodStart: rangeStart,
        periodEnd: rangeEnd,
        windowCount: 1,
        occupiedByClients: 0,
        freeForClients: 1,
        holdCount: 0,
        blockCount: 0,
        draftBlockCount: 1,
        pendingSeriesSlots: [
          {
            startAt: '2026-11-10T12:00:00.000Z',
            endAt: '2026-11-10T13:00:00.000Z',
          },
        ],
      },
    });
    assert.equal(preview.lines.length, 2);
    assert.equal(
      preview.lines.find((l) => l.kind === 'series_slot')?.change,
      'появится запись серии',
    );
  });
});
