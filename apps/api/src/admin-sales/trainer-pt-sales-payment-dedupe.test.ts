/**
 * Run: cd apps/api && npx ts-node --transpile-only src/admin-sales/trainer-pt-sales-payment-dedupe.test.ts
 */
import assert from 'node:assert/strict';
import {
  mergeTrainerPtSaleRows,
  resolvePtCashOccurredAt,
  saleDocumentIdFromPtExternalId,
  type TrainerPtSaleRow,
} from './trainer-pt-sales-from-revenue';
import {
  collapseSpaSalesByBasis,
  matchSpaSale,
  type SpaBookingMatchInput,
  type SpaSaleCandidate,
} from '../booking-control/spa-document-match';

const SALE_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function pt(
  partial: Partial<TrainerPtSaleRow> & Pick<TrainerPtSaleRow, 'occurredAt'>,
): TrainerPtSaleRow {
  return {
    amount: 40,
    clientName: 'Новикова Анна',
    serviceName: 'Занятие с тренером 40р.',
    employeeCode: '12',
    employeeName: 'Федотова Ирина Николаевна',
    paymentStatus: 'DEBT',
    ...partial,
  };
}

{
  assert.equal(
    saleDocumentIdFromPtExternalId(`${SALE_UUID}#1`),
    SALE_UUID,
  );
  assert.equal(saleDocumentIdFromPtExternalId('30167#1'), undefined);
  assert.equal(saleDocumentIdFromPtExternalId(SALE_UUID), SALE_UUID);
}

// Late ЛС/card pay of 12.10 sale must keep 12.10, not cashier day 30.10.
{
  const saleAt = new Date('2026-10-12T20:08:38.000Z');
  const payAt = new Date('2026-10-30T17:28:00.000Z');
  const prior = new Map([[SALE_UUID, saleAt]]);
  const resolved = resolvePtCashOccurredAt(payAt, SALE_UUID, prior);
  assert.equal(resolved.toISOString(), saleAt.toISOString());
  assert.equal(
    resolvePtCashOccurredAt(payAt, undefined, prior).toISOString(),
    payAt.toISOString(),
  );
  assert.equal(
    resolvePtCashOccurredAt(payAt, '00000000-0000-0000-0000-000000000000', prior)
      .toISOString(),
    payAt.toISOString(),
  );
}

// Novikova: sale 02.10 + card payment 06.10 → one PAID row on 02.10, amount 40.
{
  const primary = [
    pt({
      occurredAt: '2026-10-02T18:53:00.000Z',
      externalId: '30167#1',
      docRef: '30167#1',
      saleDocumentId: SALE_UUID,
      paymentStatus: 'DEBT',
    }),
  ];
  const cash = [
    pt({
      occurredAt: '2026-10-06T10:28:00.000Z',
      externalId: `paydoc:cash:Долг:${SALE_UUID}:20261006102800:payment`,
      docRef: SALE_UUID,
      saleDocumentId: SALE_UUID,
      paymentStatus: 'PAID',
      fromCashPayment: true,
      amount: 40,
    }),
  ];
  const merged = mergeTrainerPtSaleRows(primary, cash);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.occurredAt.slice(0, 10), '2026-10-02');
  assert.equal(merged[0]!.paymentStatus, 'PAID');
  assert.equal(merged[0]!.amount, 40);
  assert.equal(merged[0]!.docRef, '30167#1');
}

// Same-day cash payment does not create a second row.
{
  const primary = [
    pt({
      occurredAt: '2026-10-07T12:12:00.000Z',
      externalId: '30665#1',
      docRef: '30665#1',
      saleDocumentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      paymentStatus: 'DEBT',
    }),
  ];
  const cash = [
    pt({
      occurredAt: '2026-10-07T14:00:00.000Z',
      externalId: 'pay:cash:x',
      docRef: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      saleDocumentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      paymentStatus: 'PAID',
      fromCashPayment: true,
    }),
  ];
  const merged = mergeTrainerPtSaleRows(primary, cash);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.paymentStatus, 'PAID');
  assert.equal(merged[0]!.amount, 40);
}

// Pair session + later payment → one row.
{
  const uuid = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const merged = mergeTrainerPtSaleRows(
    [
      pt({
        occurredAt: '2026-10-01T10:00:00.000Z',
        serviceName: 'Парное занятие с тренером',
        amount: 70,
        externalId: '30001#1',
        docRef: '30001#1',
        saleDocumentId: uuid,
        paymentStatus: 'DEBT',
      }),
    ],
    [
      pt({
        occurredAt: '2026-10-05T10:00:00.000Z',
        serviceName: 'Парное занятие с тренером',
        amount: 70,
        saleDocumentId: uuid,
        docRef: uuid,
        paymentStatus: 'PAID',
        fromCashPayment: true,
      }),
    ],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.serviceName, 'Парное занятие с тренером');
  assert.equal(merged[0]!.paymentStatus, 'PAID');
  assert.equal(merged[0]!.amount, 70);
}

// Legacy sale without saleDocumentId: match by client+trainer+service.
{
  const merged = mergeTrainerPtSaleRows(
    [
      pt({
        occurredAt: '2026-10-02T18:53:00.000Z',
        externalId: '30167#1',
        docRef: '30167#1',
        paymentStatus: 'DEBT',
      }),
    ],
    [
      pt({
        occurredAt: '2026-10-06T10:28:00.000Z',
        paymentStatus: 'PAID',
        fromCashPayment: true,
        // No shared UUID — identity via client|trainer|service.
      }),
    ],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.paymentStatus, 'PAID');
  assert.equal(merged[0]!.occurredAt.slice(0, 10), '2026-10-02');
}

// Two different services same client → two rows.
{
  const merged = mergeTrainerPtSaleRows(
    [
      pt({
        occurredAt: '2026-10-02T10:00:00.000Z',
        serviceName: 'Занятие с тренером 40р.',
        docRef: 'a#1',
        saleDocumentId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      }),
      pt({
        occurredAt: '2026-10-02T12:00:00.000Z',
        serviceName: 'Занятие с тренером 55р.',
        amount: 55,
        docRef: 'b#1',
        saleDocumentId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      }),
    ],
    [],
  );
  assert.equal(merged.length, 2);
}

// Cash without matching sale stays as fallback session.
{
  const merged = mergeTrainerPtSaleRows(
    [],
    [
      pt({
        occurredAt: '2026-10-06T10:28:00.000Z',
        saleDocumentId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        paymentStatus: 'PAID',
        fromCashPayment: true,
      }),
    ],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.fromCashPayment, true);
  assert.equal(merged[0]!.paymentStatus, 'PAID');
}

// Новик / Доминецкая: one cached sale must not swallow other sales' card pays.
// 19.10 sale in TrainerPtSale + 14.10 / 26.10 cash (different sale UUIDs) → 3 visits.
{
  const sale19 = '06e34a3c-3cc2-4c34-bfce-7defcb1c3ff7';
  const pay14 = '66b01412-f0fb-4513-b7a3-bc05c59042c5';
  const pay26 = '346d86cd-c07b-479b-9d8c-f97c825f4db5';
  const merged = mergeTrainerPtSaleRows(
    [
      pt({
        occurredAt: '2026-10-19T09:52:55.000Z',
        clientName: 'Новик Анна Николаевна',
        serviceName: 'Занятие с тренером 50р.',
        amount: 50,
        employeeCode: '156',
        employeeName: 'Доминецкая Ирина Александровна',
        externalId: '00000032088#1',
        docRef: '00000032088#1',
        saleDocumentId: sale19,
        paymentStatus: 'PAID',
      }),
    ],
    [
      pt({
        occurredAt: '2026-10-14T10:55:08.000Z',
        clientName: 'Новик Анна Николаевна',
        serviceName: 'Занятие с тренером 50р.',
        amount: 50,
        employeeCode: '156',
        employeeName: 'Доминецкая Ирина Александровна',
        saleDocumentId: pay14,
        docRef: pay14,
        paymentStatus: 'PAID',
        fromCashPayment: true,
      }),
      pt({
        occurredAt: '2026-10-19T09:53:08.000Z',
        clientName: 'Новик Анна Николаевна',
        serviceName: 'Занятие с тренером 50р.',
        amount: 50,
        employeeCode: '156',
        employeeName: 'Доминецкая Ирина Александровна',
        saleDocumentId: sale19,
        docRef: sale19,
        paymentStatus: 'PAID',
        fromCashPayment: true,
      }),
      pt({
        occurredAt: '2026-10-26T13:49:42.000Z',
        clientName: 'Новик Анна Николаевна',
        serviceName: 'Занятие с тренером 50р.',
        amount: 50,
        employeeCode: '156',
        employeeName: 'Доминецкая Ирина Александровна',
        saleDocumentId: pay26,
        docRef: pay26,
        paymentStatus: 'PAID',
        fromCashPayment: true,
      }),
    ],
  );
  assert.equal(merged.length, 3);
  const days = merged.map((r) => r.occurredAt.slice(0, 10)).sort();
  assert.deepEqual(days, ['2026-10-14', '2026-10-19', '2026-10-26']);
  assert.ok(merged.every((r) => r.paymentStatus === 'PAID'));
  assert.ok(merged.every((r) => r.amount === 50));
}

// Cash with sale UUID must not attach to a different same-service sale via svc key.
{
  const merged = mergeTrainerPtSaleRows(
    [
      pt({
        occurredAt: '2026-10-19T10:00:00.000Z',
        externalId: '32088#1',
        docRef: '32088#1',
        // No saleDocumentId — legacy Integration number#line only.
        paymentStatus: 'PAID',
      }),
    ],
    [
      pt({
        occurredAt: '2026-10-14T10:00:00.000Z',
        saleDocumentId: '66b01412-f0fb-4513-b7a3-bc05c59042c5',
        paymentStatus: 'PAID',
        fromCashPayment: true,
      }),
    ],
  );
  assert.equal(merged.length, 2);
}

// Split card pay 25+25 (same sale UUID, two registrars) → one PAID visit, amount 50.
// Sale 30171 / Новик: две оплаты картой 02.11 на одну продажу 02.10.
{
  const saleUuid = '4d9deae0-f4d4-4d3c-93f1-e693125d1c11';
  const merged = mergeTrainerPtSaleRows(
    [
      pt({
        occurredAt: '2026-10-02T19:00:02.000Z',
        clientName: 'Новик Анна Николаевна',
        serviceName: 'Занятие с тренером 50р.',
        amount: 50,
        employeeCode: '156',
        employeeName: 'Доминецкая Ирина Александровна',
        saleDocumentId: saleUuid,
        docRef: saleUuid,
        paymentStatus: 'DEBT',
      }),
    ],
    [
      pt({
        occurredAt: '2026-11-02T20:03:28.000Z',
        clientName: 'Новик Анна Николаевна',
        serviceName: 'Занятие с тренером 50р.',
        amount: 25,
        employeeCode: '156',
        employeeName: 'Доминецкая Ирина Александровна',
        saleDocumentId: saleUuid,
        docRef: saleUuid,
        paymentStatus: 'PAID',
        fromCashPayment: true,
      }),
      pt({
        occurredAt: '2026-11-02T22:19:02.000Z',
        clientName: 'Новик Анна Николаевна',
        serviceName: 'Занятие с тренером 50р.',
        amount: 25,
        employeeCode: '156',
        employeeName: 'Доминецкая Ирина Александровна',
        saleDocumentId: saleUuid,
        docRef: saleUuid,
        paymentStatus: 'PAID',
        fromCashPayment: true,
      }),
    ],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.occurredAt.slice(0, 10), '2026-10-02');
  assert.equal(merged[0]!.paymentStatus, 'PAID');
  assert.equal(merged[0]!.amount, 50);
}

// Do not sum payment amount onto sale amount.
{
  const uuid = '11111111-1111-1111-1111-111111111111';
  const merged = mergeTrainerPtSaleRows(
    [
      pt({
        occurredAt: '2026-10-02T10:00:00.000Z',
        amount: 40,
        saleDocumentId: uuid,
        docRef: 'x#1',
        paymentStatus: 'DEBT',
      }),
    ],
    [
      pt({
        occurredAt: '2026-10-06T10:00:00.000Z',
        amount: 40,
        saleDocumentId: uuid,
        paymentStatus: 'PAID',
        fromCashPayment: true,
      }),
    ],
  );
  assert.equal(merged[0]!.amount, 40);
}

// --- SPA: sale + later card payment → one PAID candidate, sale date kept ---
{
  const saleUuid = '22222222-2222-2222-2222-222222222222';
  const unpaid: SpaSaleCandidate = {
    externalId: `${saleUuid}:unpaid`,
    documentId: saleUuid,
    occurredAt: new Date('2026-10-02T12:00:00.000Z'),
    saleAmount: 90,
    paidAmount: 0,
    operationType: 'unpaid',
    productName: 'Массаж классический 50 мин',
    productExternalId: 'svc-50',
    clientExternalId: 'cli-1',
    clientName: 'Клиент СПА',
    performerExternalId: '42',
    performerName: 'Бирюкова Екатерина',
  };
  const pay: SpaSaleCandidate = {
    externalId: `pay:${saleUuid}:cash:Долг:cli:ts:payment`,
    documentId: 'pay-registrar',
    occurredAt: new Date('2026-10-06T15:00:00.000Z'),
    paidAt: new Date('2026-10-06T15:00:00.000Z'),
    saleAmount: 90,
    paidAmount: 90,
    operationType: 'payment',
    productName: 'Массаж классический 50 мин',
    productExternalId: 'svc-50',
    clientExternalId: 'cli-1',
    clientName: 'Клиент СПА',
    performerExternalId: '42',
    performerName: 'Бирюкова Екатерина',
    card: 90,
  };
  // preferredSaleBasisId for cash key needs :cash: at index with basis at +3
  const payCash: SpaSaleCandidate = {
    ...pay,
    externalId: `paydoc:cash:Долг:cli-1:${saleUuid}:20261006150000:payment`,
  };
  const collapsed = collapseSpaSalesByBasis([unpaid, payCash]);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0]!.occurredAt.toISOString().slice(0, 10), '2026-10-02');
  assert.ok((collapsed[0]!.paidAmount || 0) >= 90);
  assert.notEqual(collapsed[0]!.operationType, 'unpaid');

  const booking: SpaBookingMatchInput = {
    id: 'spa-b1',
    startAt: new Date('2026-10-02T12:00:00.000Z'),
    paymentType: 'PAID',
    specialistName: 'Бирюкова Екатерина',
    specialistExternalId: '42',
    serviceName: 'Массаж классический 50 мин',
    serviceExternalId: 'svc-50',
    clientExternalId: 'cli-1',
    clientName: 'Клиент СПА',
  };
  const r = matchSpaSale({
    booking,
    sales: [unpaid, payCash],
  });
  assert.equal(r.kind, 'auto');
  if (r.kind === 'auto') {
    assert.equal(r.paymentStatus, 'PAID');
    assert.equal(r.sale.occurredAt.toISOString().slice(0, 10), '2026-10-02');
  }
}

console.log('trainer-pt-sales-payment-dedupe.test.ts: ok');
