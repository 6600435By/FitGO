/**
 * Booking-control queue segment + issue reasons.
 * Run: npx tsx --test packages/shared-types/src/booking-control-queue.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bookingControlHasControlWork,
  bookingControlIssueReasons,
  bookingControlIsNotIn1c,
  bookingControlIsUnpaid,
  bookingControlMatchesSelectedReasons,
  bookingControlQueueSegment,
  type BookingControlListItem,
} from './booking-control';

const NOW = Date.parse('2026-10-29T12:00:00.000Z');

function row(
  partial: Partial<BookingControlListItem> &
    Pick<BookingControlListItem, 'sessionKey'>,
): BookingControlListItem {
  return {
    kind: 'PT',
    source: '1C',
    title: 'ПТ',
    startAt: '2026-10-28T10:00:00.000Z',
    status: 'COMPLETED',
    performerName: 'Тренер',
    needsReview: false,
    ...partial,
  };
}

describe('bookingControlIsUnpaid', () => {
  it('flags DEBT and UNKNOWN for PT/SPA', () => {
    assert.equal(bookingControlIsUnpaid(row({ sessionKey: 'a', payment: 'DEBT' })), true);
    assert.equal(
      bookingControlIsUnpaid(row({ sessionKey: 'b', payment: 'UNKNOWN' })),
      true,
    );
    assert.equal(bookingControlIsUnpaid(row({ sessionKey: 'c', payment: 'PAID' })), false);
  });

  it('never flags GROUP', () => {
    assert.equal(
      bookingControlIsUnpaid(
        row({ sessionKey: 'g', kind: 'GROUP', payment: 'DEBT' }),
      ),
      false,
    );
  });
});

describe('bookingControlIssueReasons', () => {
  it('collects review unpaid not1c journal', () => {
    assert.deepEqual(
      bookingControlIssueReasons(
        row({
          sessionKey: '1',
          needsReview: true,
          payment: 'DEBT',
        }),
      ),
      ['review', 'unpaid'],
    );
    assert.equal(
      bookingControlIsNotIn1c(
        row({
          sessionKey: '2',
          kind: 'SPA',
          source: 'FITGO',
          oneCLinked: false,
        }),
      ),
      true,
    );
    assert.deepEqual(
      bookingControlIssueReasons(
        row({
          sessionKey: '3',
          kind: 'SPA',
          source: 'FITGO',
          oneCLinked: false,
          missingJournal: true,
        }),
      ),
      ['not1c', 'journal'],
    );
  });
});

describe('bookingControlQueueSegment', () => {
  it('hides cancelled', () => {
    assert.equal(
      bookingControlQueueSegment(
        row({ sessionKey: 'c', status: 'CANCELLED', payment: 'DEBT' }),
        NOW,
      ),
      null,
    );
  });

  it('future approval-wait alone is upcoming', () => {
    const item = row({
      sessionKey: 'f',
      startAt: '2026-10-30T10:00:00.000Z',
      status: 'SCHEDULED',
      approvalPhase: 'PENDING_TRAINER',
      payment: 'PAID',
    });
    assert.equal(bookingControlHasControlWork(item, NOW), false);
    assert.equal(bookingControlQueueSegment(item, NOW), 'upcoming');
  });

  it('future unpaid is pending', () => {
    const item = row({
      sessionKey: 'u',
      startAt: '2026-10-30T10:00:00.000Z',
      status: 'SCHEDULED',
      payment: 'DEBT',
    });
    assert.equal(bookingControlQueueSegment(item, NOW), 'pending');
  });

  it('past pending approval is pending', () => {
    assert.equal(
      bookingControlQueueSegment(
        row({
          sessionKey: 'p',
          approvalPhase: 'PENDING_ADMIN',
          payment: 'PAID',
        }),
        NOW,
      ),
      'pending',
    );
  });

  it('past clean approved is done', () => {
    assert.equal(
      bookingControlQueueSegment(
        row({
          sessionKey: 'd',
          approvalPhase: 'APPROVED',
          payment: 'PAID',
        }),
        NOW,
      ),
      'done',
    );
  });

  it('past clean without phase is done', () => {
    assert.equal(
      bookingControlQueueSegment(
        row({ sessionKey: 'd2', payment: 'QUOTA' }),
        NOW,
      ),
      'done',
    );
  });
});

describe('bookingControlMatchesSelectedReasons', () => {
  it('empty selection matches all', () => {
    assert.equal(
      bookingControlMatchesSelectedReasons(
        row({ sessionKey: 'x', payment: 'PAID' }),
        [],
      ),
      true,
    );
  });

  it('ORs selected reasons', () => {
    const unpaid = row({ sessionKey: 'u', payment: 'DEBT' });
    const review = row({ sessionKey: 'r', needsReview: true, payment: 'PAID' });
    assert.equal(
      bookingControlMatchesSelectedReasons(unpaid, ['unpaid', 'review']),
      true,
    );
    assert.equal(
      bookingControlMatchesSelectedReasons(review, ['unpaid']),
      false,
    );
    assert.equal(
      bookingControlMatchesSelectedReasons(review, ['unpaid', 'review']),
      true,
    );
  });
});
