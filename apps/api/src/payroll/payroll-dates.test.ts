/**
 * Run: cd apps/api && npx ts-node --transpile-only src/payroll/payroll-dates.test.ts
 */
import assert from 'node:assert/strict';
import {
  addCalendarDays,
  clubDayIso,
  dateOnly,
  isBeforePayOnPaymentEpoch,
  localMonthStartIso,
  localTodayIso,
  PAY_ON_PAYMENT_EPOCH,
  rateChangeHintText,
  utcDateKey,
} from './payroll-dates';

{
  const d = dateOnly('2026-10-01');
  assert.equal(utcDateKey(d), '2026-10-01');
  // Must not drift to previous UTC day in Europe/Minsk.
  assert.equal(d.toISOString(), '2026-10-01T12:00:00.000Z');
}

{
  // FitGO/Onex day|client keys: 00:00–02:59 Minsk is still "today", UTC slice is yesterday.
  const lateMinsk = new Date('2026-11-07T21:30:00.000Z'); // 00:30 Minsk Nov 8
  assert.equal(lateMinsk.toISOString().slice(0, 10), '2026-11-07');
  assert.equal(clubDayIso(lateMinsk), '2026-11-08');
  assert.equal(clubDayIso('2026-11-07T21:30:00.000Z'), '2026-11-08');
  // Date-only sale day stays the same calendar day.
  assert.equal(clubDayIso('2026-11-07'), '2026-11-07');
}

{
  // Regression: local midnight + toISOString used to yield 2026-10-12 for "day before 14".
  assert.equal(addCalendarDays('2026-10-14', -1), '2026-10-13');
  assert.equal(
    rateChangeHintText(['2026-09-01', '2026-10-14'], '2026-10-01', '2026-10-23'),
    'до 2026-10-13 — прежняя ставка, с 2026-10-14 — новая',
  );
}

{
  // Version on period start is not a "mid-period change".
  assert.equal(
    rateChangeHintText(['2026-10-01'], '2026-10-01', '2026-10-23'),
    undefined,
  );
}

{
  const now = new Date(2026, 9, 23); // local Oct 23
  assert.equal(localTodayIso(now), '2026-10-23');
  assert.equal(localMonthStartIso(now), '2026-10-01');
}

{
  // Europe/Minsk: local T00:00:00 shifts @db.Date to the previous UTC day.
  // Payroll payouts must use dateOnly (UTC noon) — same as StaffCompensation.
  const localMidnight = new Date('2025-10-01T00:00:00');
  assert.equal(localMidnight.toISOString().slice(0, 10), '2025-09-30');
  assert.equal(utcDateKey(dateOnly('2025-10-01')), '2025-10-01');
}

{
  assert.equal(PAY_ON_PAYMENT_EPOCH, '2026-10-01');
  assert.equal(isBeforePayOnPaymentEpoch('2026-09-30'), true);
  assert.equal(isBeforePayOnPaymentEpoch('2026-09-28T21:00:00.000Z'), true);
  assert.equal(isBeforePayOnPaymentEpoch('2026-10-01'), false);
  assert.equal(isBeforePayOnPaymentEpoch('2026-10-12T20:08:00.000Z'), false);
  // Personal reformer visit day.
  assert.equal(isBeforePayOnPaymentEpoch('2026-09-25T12:00:00.000Z'), true);
  assert.equal(isBeforePayOnPaymentEpoch('2026-10-03T12:00:00.000Z'), false);
  assert.equal(isBeforePayOnPaymentEpoch(null), false);
}

console.log('payroll-dates.test.ts: ok');
