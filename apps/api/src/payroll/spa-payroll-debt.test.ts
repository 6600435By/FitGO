import assert from 'node:assert/strict';
import type { WorkUnit } from '@fitgo/shared-types';
import {
  PAYROLL_DEBT_HINT,
  dedupeSpaPayrollUnits,
  payrollClientNamesMatch,
  preferSpaPayrollUnit,
  spaUnitCoversVisit,
} from './spa-payroll-debt';

function spa(
  partial: Partial<WorkUnit> & Pick<WorkUnit, 'id' | 'occurredAt'>,
): WorkUnit {
  return {
    kind: 'SPA',
    performerId: 'p1',
    title: 'Массаж классический 25 мин',
    quantity: 1,
    trustBand: 'GREEN',
    trustResolution: 'NONE',
    payrollTrusted: true,
    clientName: 'Князева Алёна',
    ...partial,
  };
}

{
  assert.equal(
    payrollClientNamesMatch('Петров Андрей', 'Петров Андрей Юрьевич'),
    true,
  );
  assert.equal(
    payrollClientNamesMatch('Бич Татьяна', 'Бич Татьяна Александровна'),
    true,
  );
  assert.equal(
    payrollClientNamesMatch('Петров Андрей', 'Сидоров Иван'),
    false,
  );
}

{
  const trusted = spa({
    id: 'onex:1',
    occurredAt: '2026-10-29T15:00:00.000Z',
    title: 'Массаж классический общий (абонемент)',
    clientName: 'Петров Андрей Юрьевич',
    spaMembershipQuota: true,
  });
  assert.equal(
    spaUnitCoversVisit(
      [trusted],
      'Петров Андрей',
      new Date('2026-10-29T15:00:00.000Z'),
      { onlyTrusted: true },
    ),
    true,
  );
}

{
  const abo = spa({
    id: 'onex:vip',
    occurredAt: '2026-10-29T15:00:00.000Z',
    title: 'Массаж классический общий (абонемент)',
    clientName: 'Бич Татьяна Александровна',
    payrollTrusted: true,
    spaMembershipQuota: true,
    priceMinor: 0,
    earnMinor: 2000,
  });
  const debt = spa({
    id: 'fitgo-debt',
    occurredAt: '2026-10-29T15:00:00.000Z',
    title: 'Массаж классический 50 мин',
    clientName: 'Бич Татьяна',
    payrollTrusted: false,
    trustBand: 'RED',
    trustHints: [PAYROLL_DEBT_HINT],
    priceMinor: 9000,
  });
  assert.equal(preferSpaPayrollUnit(abo, debt), abo);
  const out = dedupeSpaPayrollUnits([abo, debt]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.id, 'onex:vip');
}

{
  const petrovAbo = spa({
    id: 'onex:p',
    occurredAt: '2026-10-29T15:00:00.000Z',
    title: 'Массаж классический общий (абонемент)',
    clientName: 'Петров Андрей Юрьевич',
    spaMembershipQuota: true,
  });
  const petrovDebt = spa({
    id: 'fitgo-p',
    occurredAt: '2026-10-29T15:00:00.000Z',
    title: 'Массаж классический 50 мин',
    clientName: 'Петров Андрей',
    payrollTrusted: false,
    trustHints: [PAYROLL_DEBT_HINT],
  });
  assert.equal(dedupeSpaPayrollUnits([petrovAbo, petrovDebt]).length, 1);
}

{
  const a = spa({
    id: 'a',
    occurredAt: '2026-10-23T08:00:00.000Z',
    clientName: 'Дениченко Ольга',
  });
  const b = spa({
    id: 'b',
    occurredAt: '2026-10-24T08:00:00.000Z',
    clientName: 'Дениченко Ольга',
  });
  assert.equal(dedupeSpaPayrollUnits([a, b]).length, 2);
}

{
  // Two distinct 1C sessions for same client within 90 min (e.g. 14:00 and 14:50) must both be kept
  const s1 = spa({
    id: 'onex:doc1',
    sessionId: 'doc1',
    occurredAt: '2026-11-13T14:00:00.000Z',
    title: 'Массаж классический общий (абонемент)',
    clientName: 'Иванова Мария',
    payrollTrusted: true,
    spaMembershipQuota: true,
  });
  const s2 = spa({
    id: 'onex:doc2',
    sessionId: 'doc2',
    occurredAt: '2026-11-13T14:50:00.000Z',
    title: 'Массаж классический общий (абонемент)',
    clientName: 'Иванова Мария',
    payrollTrusted: true,
    spaMembershipQuota: true,
  });
  assert.equal(dedupeSpaPayrollUnits([s1, s2]).length, 2);
}

{
  // Two different services for same client within 90 min must both be kept
  const s1 = spa({
    id: 's1',
    occurredAt: '2026-11-13T14:00:00.000Z',
    title: 'Массаж классический 50 мин',
    clientName: 'Иванова Мария',
    payrollTrusted: true,
    priceMinor: 9000,
  });
  const s2 = spa({
    id: 's2',
    occurredAt: '2026-11-13T14:50:00.000Z',
    title: 'Массаж шейно-воротниковой зоны 30 мин',
    clientName: 'Иванова Мария',
    payrollTrusted: true,
    priceMinor: 5000,
  });
  assert.equal(dedupeSpaPayrollUnits([s1, s2]).length, 2);
}

console.log('spa-payroll-debt.test.ts: ok');
