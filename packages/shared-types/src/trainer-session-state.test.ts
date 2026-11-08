/**
 * Trainer session clock / result rules + counter scopes.
 * Run: npx tsx --test packages/shared-types/src/trainer-session-state.test.ts packages/shared-types/src/booking-control-queue.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bookingControlHasControlWork,
  bookingControlQueueSegment,
  bookingControlRowStateLabelRu,
  bookingControlTrainerOwnConfirmPending,
} from './booking-control';
import type { BookingControlListItem } from './booking-control';
import {
  clubDayBounds,
  clubDayKey,
  sessionClockPhase,
  sessionStateExplainRu,
  SESSION_CLOCK_NOW_IS_NOT_CONFIRM,
  trainerOwnConfirmPending,
  TRAINER_CONTROL_SCOPES,
} from './trainer-session-state';

/** 2026-11-08 15:00 Europe/Minsk = 12:00Z */
const NOW = Date.parse('2026-11-08T12:00:00.000Z');

function row(
  partial: Partial<BookingControlListItem> &
    Pick<BookingControlListItem, 'sessionKey'>,
): BookingControlListItem {
  return {
    kind: 'PT',
    source: 'FITGO',
    title: 'ПТ',
    startAt: '2026-11-08T10:00:00.000Z',
    endAt: '2026-11-08T11:00:00.000Z',
    status: 'SCHEDULED',
    performerName: 'Тренер',
    needsReview: false,
    ...partial,
  };
}

describe('club day Europe/Minsk', () => {
  it('day key follows Minsk, not UTC', () => {
    // 2026-11-08 23:30 Minsk = 20:30Z → still 8 Nov in Minsk
    assert.equal(clubDayKey(new Date('2026-11-08T20:30:00.000Z')), '2026-11-08');
    // 2026-11-09 00:30 Minsk = 2026-11-08 21:30Z → 9 Nov in Minsk
    assert.equal(clubDayKey(new Date('2026-11-08T21:30:00.000Z')), '2026-11-09');
  });

  it('day bounds include Minsk midnight edge', () => {
    const { start, end } = clubDayBounds('2026-11-08');
    assert.equal(start.toISOString(), '2026-11-07T21:00:00.000Z');
    assert.equal(end.toISOString(), '2026-11-08T20:59:59.999Z');
    // Instant just before Minsk midnight belongs to previous club day
    assert.equal(
      clubDayKey(new Date(start.getTime() - 1)),
      '2026-11-07',
    );
    assert.equal(clubDayKey(end), '2026-11-08');
  });
});

describe('sessionClockPhase — time ≠ result', () => {
  it('future / current / elapsed / cancelled', () => {
    assert.equal(
      sessionClockPhase({
        startAt: '2026-11-08T13:00:00.000Z',
        endAt: '2026-11-08T14:00:00.000Z',
        nowMs: NOW,
      }),
      'UPCOMING',
    );
    assert.equal(
      sessionClockPhase({
        startAt: '2026-11-08T11:30:00.000Z',
        endAt: '2026-11-08T12:30:00.000Z',
        nowMs: NOW,
      }),
      'IN_PROGRESS',
    );
    assert.equal(
      sessionClockPhase({
        startAt: '2026-11-08T10:00:00.000Z',
        endAt: '2026-11-08T11:00:00.000Z',
        nowMs: NOW,
      }),
      'ELAPSED',
    );
    assert.equal(
      sessionClockPhase({
        startAt: '2026-11-08T10:00:00.000Z',
        endAt: '2026-11-08T11:00:00.000Z',
        cancelled: true,
        nowMs: NOW,
      }),
      'CANCELLED',
    );
  });

  it('elapsed unconfirmed is never «Сейчас»', () => {
    const label = sessionStateExplainRu({
      clock: 'ELAPSED',
      result: 'trainer',
    });
    assert.equal(label, 'Время прошло, результат не подтверждён');
    assert.equal(label.includes('Сейчас'), false);
    assert.ok(SESSION_CLOCK_NOW_IS_NOT_CONFIRM.length > 0);
  });

  it('admin wait after elapsed', () => {
    assert.equal(
      sessionStateExplainRu({ clock: 'ELAPSED', result: 'admin' }),
      'Время прошло · ждёт администратора',
    );
  });
});

describe('counter scopes — Today vs journal', () => {
  it('documents distinct scopes', () => {
    assert.notEqual(
      TRAINER_CONTROL_SCOPES.pendingMe.titleRu,
      TRAINER_CONTROL_SCOPES.journalPending.titleRu,
    );
    assert.match(TRAINER_CONTROL_SCOPES.pendingMe.scopeRu, /отметк/i);
    assert.match(TRAINER_CONTROL_SCOPES.journalPending.scopeRu, /оплат/i);
  });

  it('unpaid alone is journal pending, not trainer own confirm', () => {
    const unpaid = row({
      sessionKey: 'u',
      payment: 'DEBT',
      approvalPhase: undefined,
      startAt: '2026-11-08T10:00:00.000Z',
      endAt: '2026-11-08T11:00:00.000Z',
    });
    assert.equal(bookingControlHasControlWork(unpaid, NOW), true);
    assert.equal(bookingControlTrainerOwnConfirmPending(unpaid, NOW), false);
    assert.equal(bookingControlQueueSegment(unpaid, NOW), 'pending');
  });

  it('elapsed PENDING_PERFORMER is both journal and own confirm', () => {
    const item = row({
      sessionKey: 'p',
      payment: 'PAID',
      approvalPhase: 'PENDING_PERFORMER',
    });
    assert.equal(bookingControlHasControlWork(item, NOW), true);
    assert.equal(bookingControlTrainerOwnConfirmPending(item, NOW), true);
    assert.equal(
      bookingControlRowStateLabelRu(item, NOW),
      'Время прошло, результат не подтверждён',
    );
  });

  it('in-progress unpaid is journal pending; own confirm waits for end', () => {
    const item = row({
      sessionKey: 'live',
      payment: 'DEBT',
      approvalPhase: 'PENDING_PERFORMER',
      startAt: '2026-11-08T11:30:00.000Z',
      endAt: '2026-11-08T12:30:00.000Z',
    });
    assert.equal(bookingControlHasControlWork(item, NOW), true); // unpaid
    assert.equal(bookingControlTrainerOwnConfirmPending(item, NOW), false);
    assert.equal(
      sessionStateExplainRu({
        clock: sessionClockPhase({ ...item, nowMs: NOW }),
        result: 'trainer',
      }),
      'Идёт · отметка после окончания',
    );
  });

  it('future session with approval phase is upcoming, not pendingMe', () => {
    const item = row({
      sessionKey: 'f',
      payment: 'PAID',
      approvalPhase: 'PENDING_PERFORMER',
      startAt: '2026-11-08T14:00:00.000Z',
      endAt: '2026-11-08T15:00:00.000Z',
      status: 'SCHEDULED',
    });
    assert.equal(bookingControlTrainerOwnConfirmPending(item, NOW), false);
    assert.equal(bookingControlQueueSegment(item, NOW), 'upcoming');
  });

  it('cancelled is hidden from queue; explain says Отменена', () => {
    const item = row({
      sessionKey: 'c',
      status: 'CANCELLED',
      payment: 'DEBT',
      approvalPhase: 'PENDING_PERFORMER',
    });
    assert.equal(bookingControlQueueSegment(item, NOW), null);
    assert.equal(
      bookingControlRowStateLabelRu(item, NOW),
      'Отменена',
    );
  });

  it('PENDING_ADMIN after end is journal pending, not own confirm', () => {
    const item = row({
      sessionKey: 'a',
      payment: 'PAID',
      approvalPhase: 'PENDING_ADMIN',
    });
    assert.equal(bookingControlHasControlWork(item, NOW), true);
    assert.equal(bookingControlTrainerOwnConfirmPending(item, NOW), false);
    assert.equal(
      bookingControlRowStateLabelRu(item, NOW),
      'Время прошло · ждёт администратора',
    );
  });

  it('trainerOwnConfirmPending without phase after end still waits', () => {
    assert.equal(
      trainerOwnConfirmPending({
        startAt: '2026-11-08T10:00:00.000Z',
        endAt: '2026-11-08T11:00:00.000Z',
        approvalPhase: null,
        nowMs: NOW,
      }),
      true,
    );
    assert.equal(
      trainerOwnConfirmPending({
        startAt: '2026-11-08T11:30:00.000Z',
        endAt: '2026-11-08T12:30:00.000Z',
        approvalPhase: null,
        nowMs: NOW,
      }),
      false,
    );
  });
});

describe('Minsk day boundary for today list membership', () => {
  it('session just after Minsk midnight is next club day', () => {
    const { end: dayEnd } = clubDayBounds('2026-11-08');
    const justAfter = new Date(dayEnd.getTime() + 1);
    assert.equal(clubDayKey(justAfter), '2026-11-09');
    const sessionStart = justAfter.toISOString();
    assert.equal(
      sessionClockPhase({
        startAt: sessionStart,
        endAt: new Date(justAfter.getTime() + 3600_000).toISOString(),
        nowMs: dayEnd.getTime(),
      }),
      'UPCOMING',
    );
  });
});
