/**
 * Pure rules for when Staff rates may be edited.
 * Run: cd apps/api && npx ts-node --transpile-only src/payroll/compensation-day-frozen.test.ts
 */
import assert from 'node:assert/strict';
import { dateOnly, utcDateKey } from './payroll-dates';

/** Mirrors compensationDayFrozen decision without Prisma. */
function rateEditFrozen(input: {
  day: string;
  paidSettlements: Array<{ from: string; to: string }>;
  draftSettlements: Array<{ from: string; to: string }>;
  locks: Array<{ from: string; to: string }>;
  paidAdvances: Array<{ from: string; to: string }>;
}): { frozen: boolean; until?: string } {
  const day = input.day;
  const settled = input.paidSettlements.find(
    (p) => p.from <= day && p.to >= day,
  );
  if (settled) return { frozen: true, until: settled.to };

  const openDraft = input.draftSettlements.find(
    (p) => p.from <= day && p.to >= day,
  );

  const hard = input.locks.filter((lock) => {
    const advanceOnly = input.paidAdvances.some(
      (a) => lock.from >= a.from && lock.to <= a.to,
    );
    if (advanceOnly) return false;
    if (openDraft) return false;
    return true;
  });

  if (!hard.length) return { frozen: false };
  return { frozen: true, until: hard[0]!.to };
}

{
  // Paid advance lock alone must not block Oct 1 rates.
  const r = rateEditFrozen({
    day: '2026-10-01',
    paidSettlements: [],
    draftSettlements: [],
    locks: [{ from: '2026-10-01', to: '2026-10-15' }],
    paidAdvances: [{ from: '2026-10-01', to: '2026-10-15' }],
  });
  assert.equal(r.frozen, false);
}

{
  // DRAFT «Сохранено» + leftover full-month lock → still editable.
  const r = rateEditFrozen({
    day: '2026-10-01',
    paidSettlements: [],
    draftSettlements: [{ from: '2026-10-01', to: '2026-10-31' }],
    locks: [{ from: '2026-10-01', to: '2026-10-31' }],
    paidAdvances: [{ from: '2026-10-01', to: '2026-10-15' }],
  });
  assert.equal(r.frozen, false);
}

{
  // Paid month settlement hard-closes the day.
  const r = rateEditFrozen({
    day: '2026-10-01',
    paidSettlements: [{ from: '2026-10-01', to: '2026-10-31' }],
    draftSettlements: [],
    locks: [{ from: '2026-10-01', to: '2026-10-31' }],
    paidAdvances: [],
  });
  assert.deepEqual(r, { frozen: true, until: '2026-10-31' });
}

{
  // Explicit lock without advance / draft → frozen (Закрыть период).
  const r = rateEditFrozen({
    day: '2026-10-01',
    paidSettlements: [],
    draftSettlements: [],
    locks: [{ from: '2026-10-01', to: '2026-10-31' }],
    paidAdvances: [],
  });
  assert.deepEqual(r, { frozen: true, until: '2026-10-31' });
}

{
  // dateOnly must not drift in Minsk (lock key alignment).
  assert.equal(utcDateKey(dateOnly('2026-10-01')), '2026-10-01');
  assert.equal(dateOnly('2026-10-01').toISOString(), '2026-10-01T12:00:00.000Z');
}

console.log('compensation-day-frozen.test.ts: ok');
