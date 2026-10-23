/**
 * Run: cd apps/api && npx ts-node --transpile-only src/payroll/payroll-dates.test.ts
 */
import assert from 'node:assert/strict';
import {
  addCalendarDays,
  dateOnly,
  localMonthStartIso,
  localTodayIso,
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

console.log('payroll-dates.test.ts: ok');
