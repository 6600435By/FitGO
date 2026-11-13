import assert from 'node:assert/strict';
import type { WorkUnit } from '@fitgo/shared-types';
import {
  PAYROLL_DEBT_HINT,
  dedupeSpaPayrollUnits,
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
  const trusted = spa({
    id: 'onex:1',
    occurredAt: '2026-10-29T13:35:00.000Z',
    title: 'Массаж классический 25 мин (блок)',
  });
  assert.equal(
    spaUnitCoversVisit(
      [trusted],
      'Князева Алёна',
      new Date('2026-10-29T13:40:00.000Z'),
      { onlyTrusted: true },
    ),
    true,
  );
  assert.equal(
    spaUnitCoversVisit(
      [trusted],
      'Другой Клиент',
      new Date('2026-10-29T13:40:00.000Z'),
    ),
    false,
  );
}

{
  const paid = spa({
    id: 'onex:1',
    occurredAt: '2026-10-29T13:35:00.000Z',
    payrollTrusted: true,
    saleExternalId: 'pack-1',
  });
  const debt = spa({
    id: 'fitgo-debt',
    occurredAt: '2026-10-29T13:35:00.000Z',
    payrollTrusted: false,
    trustBand: 'RED',
    trustHints: [PAYROLL_DEBT_HINT],
  });
  assert.equal(preferSpaPayrollUnit(paid, debt), paid);
  const out = dedupeSpaPayrollUnits([paid, debt]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.id, 'onex:1');
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
