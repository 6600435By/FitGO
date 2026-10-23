/**
 * Run: cd apps/api && npx ts-node --transpile-only src/admin-sales/trainer-pt-sales-debt.test.ts
 */
import assert from 'node:assert/strict';
import {
  applyUnpaidDebtStatusToPtSales,
  collectUnpaidPtDebtKeys,
  type TrainerPtSaleRow,
  type UnpaidDebtRevenueEntry,
} from './trainer-pt-sales-from-revenue';

function unpaid(
  partial: Partial<UnpaidDebtRevenueEntry> &
    Pick<UnpaidDebtRevenueEntry, 'externalId' | 'occurredAt'>,
): UnpaidDebtRevenueEntry {
  return {
    operationType: 'unpaid',
    paidAmount: 0,
    saleAmount: 40,
    productName: 'Занятие с тренером 40р.',
    saleType: 'training',
    clientName: 'Позняк Ольга',
    performerName: 'Ходанович Мария Михайловна',
    ...partial,
  };
}

function sale(
  partial: Partial<TrainerPtSaleRow> & Pick<TrainerPtSaleRow, 'occurredAt'>,
): TrainerPtSaleRow {
  return {
    amount: 40,
    clientName: 'Позняк Ольга',
    serviceName: 'Занятие с тренером 40р.',
    employeeName: 'Ходанович Мария Михайловна',
    paymentStatus: 'PAID',
    ...partial,
  };
}

{
  const keys = collectUnpaidPtDebtKeys([
    unpaid({
      externalId: 'doc-30749:debt:1',
      documentId: 'doc-30749',
      occurredAt: new Date('2026-10-05T00:00:00.000Z'),
    }),
  ]);
  assert.ok(keys.has('doc:doc-30749'));
  assert.ok(
    keys.has(
      '2026-10-05|позняк ольга|n:ходанович мария михайловна',
    ),
  );
}

{
  // Membership/shop debt: doc key only (admin % never uses TrainerPtSale,
  // but same doc must still force DEBT if a PT line shares the sale UUID).
  const keys = collectUnpaidPtDebtKeys([
    unpaid({
      externalId: 'mem-1:debt:1',
      documentId: 'mem-1',
      productName: 'Абонемент VIP 12',
      saleType: 'membership',
      occurredAt: new Date('2026-10-05T00:00:00.000Z'),
      performerName: null,
      employeeName: 'Админ Иван',
    }),
  ]);
  assert.ok(keys.has('doc:mem-1'));
  assert.equal(
    [...keys].some((k) => k.startsWith('2026-10-05|')),
    false,
  );
}

{
  // SPA massage unpaid → day|client|performer for specialists.
  const keys = collectUnpaidPtDebtKeys([
    unpaid({
      externalId: 'spa-1:debt:1',
      documentId: 'spa-1',
      productName: 'Массаж классический 50 мин',
      saleType: 'service',
      performerName: 'Бирюкова Екатерина',
      occurredAt: new Date('2026-10-05T00:00:00.000Z'),
    }),
  ]);
  assert.ok(keys.has('doc:spa-1'));
  assert.ok(
    keys.has('2026-10-05|позняк ольга|n:бирюкова екатерина'),
  );
}

{
  // Already paid money on unpaid stub → not a debt key.
  const keys = collectUnpaidPtDebtKeys([
    unpaid({
      externalId: 'x',
      occurredAt: new Date('2026-10-05T00:00:00.000Z'),
      paidAmount: 40,
    }),
  ]);
  assert.equal(keys.size, 0);
}

{
  const keys = collectUnpaidPtDebtKeys([
    unpaid({
      externalId: 'doc-30749:debt:1',
      documentId: 'doc-30749',
      occurredAt: new Date('2026-10-05T00:00:00.000Z'),
    }),
  ]);
  const rows = applyUnpaidDebtStatusToPtSales(
    [
      sale({
        occurredAt: '2026-10-05T00:00:00.000Z',
        docRef: 'doc-30749',
        externalId: 'doc-30749#1',
        paymentStatus: 'PAID',
      }),
      sale({
        occurredAt: '2026-10-06T12:00:00.000Z',
        clientName: 'Другой Клиент',
        docRef: 'other',
        paymentStatus: 'PAID',
      }),
    ],
    keys,
  );
  assert.equal(rows[0]!.paymentStatus, 'DEBT');
  assert.equal(rows[1]!.paymentStatus, 'PAID');
}

{
  // Match by day+client+trainer when docRef missing (stale sync).
  const keys = collectUnpaidPtDebtKeys([
    unpaid({
      externalId: 'orphan:debt:1',
      occurredAt: new Date('2026-10-05T00:00:00.000Z'),
    }),
  ]);
  const rows = applyUnpaidDebtStatusToPtSales(
    [
      sale({
        occurredAt: '2026-10-05T00:00:00.000Z',
        paymentStatus: 'PAID',
      }),
    ],
    keys,
  );
  assert.equal(rows[0]!.paymentStatus, 'DEBT');
}

console.log('trainer-pt-sales-debt.test.ts: ok');
