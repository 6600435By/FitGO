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

console.log('spa-payroll-debt.test.ts: ok');
