/**
 * Run: cd apps/api && npx ts-node --transpile-only src/booking-control/spa-document-match.test.ts
 */
import assert from 'node:assert/strict';
import { humanDocumentNumber } from '@fitgo/shared-types';
import {
  awaitingPaymentLabel,
  buildSpaDayMergePairs,
  matchSpaSale,
  matchSpaVisitByDay,
  minskDayKey,
  namesMatch,
  paidSaleSettlementLabel,
  serviceNamesMatch,
  type SpaBookingMatchInput,
  type SpaOnexCandidate,
  type SpaSaleCandidate,
} from './spa-document-match';

function booking(
  partial: Partial<SpaBookingMatchInput> & Pick<SpaBookingMatchInput, 'id' | 'startAt'>,
): SpaBookingMatchInput {
  return {
    paymentType: 'PAID',
    specialistName: 'Бирюкова Екатерина',
    specialistExternalId: '42',
    serviceName: 'Массаж классический 50 мин',
    serviceExternalId: 'svc-50',
    clientExternalId: 'cli-gur',
    clientName: 'Гурская Наталья Ивановна',
    ...partial,
  };
}

function sale(
  partial: Partial<SpaSaleCandidate> & Pick<SpaSaleCandidate, 'externalId' | 'occurredAt'>,
): SpaSaleCandidate {
  return {
    saleAmount: 90,
    paidAmount: 90,
    operationType: 'payment',
    productName: 'Массаж классический 50 мин',
    productExternalId: 'svc-50',
    clientExternalId: 'cli-gur',
    clientName: 'Гурская Наталья Ивановна',
    performerExternalId: '42',
    performerName: 'Бирюкова Екатерина',
    ...partial,
  };
}

// --- Gurskaya: same day sale, reception cashier ≠ performer ---
{
  const visit = new Date('2026-10-19T07:00:00.000Z');
  const b = booking({ id: 'b-gur', startAt: visit });
  const s = sale({
    externalId: 'sale-gur',
    occurredAt: new Date('2026-10-19T06:57:00.000Z'),
  });
  const r = matchSpaSale({ booking: b, sales: [s] });
  assert.equal(r.kind, 'auto');
  if (r.kind === 'auto') {
    assert.equal(r.sale.externalId, 'sale-gur');
    assert.equal(r.paymentStatus, 'PAID');
  }
}

// --- Debt sold another day, paid later still links by document ---
{
  const visit = new Date('2026-10-19T07:00:00.000Z');
  const b = booking({ id: 'b-debt', startAt: visit });
  const s = sale({
    externalId: 'sale-debt',
    occurredAt: new Date('2026-10-10T10:00:00.000Z'),
    paidAmount: 0,
    operationType: 'unpaid',
  });
  const r = matchSpaSale({ booking: b, sales: [s] });
  assert.equal(r.kind, 'auto');
  if (r.kind === 'auto') {
    assert.equal(r.paymentStatus, 'DEBT');
    assert.match(awaitingPaymentLabel(r.sale), /долг/);
  }
}

// --- Other nomenclature → hint ---
{
  const visit = new Date('2026-10-19T07:00:00.000Z');
  const b = booking({ id: 'b-nom', startAt: visit });
  const s = sale({
    externalId: 'sale-sport',
    occurredAt: visit,
    productName: 'Массаж спортивный 40 мин',
    productExternalId: 'svc-sport',
  });
  const r = matchSpaSale({ booking: b, sales: [s] });
  assert.equal(r.kind, 'hint');
  if (r.kind === 'hint') {
    assert.equal(r.hint.kind, 'SALE_OTHER_NOMENCLATURE');
  }
}

// --- No performer → hint ---
{
  const visit = new Date('2026-10-19T07:00:00.000Z');
  const b = booking({ id: 'b-noperf', startAt: visit });
  const s = sale({
    externalId: 'sale-noperf',
    occurredAt: visit,
    performerExternalId: null,
    performerName: null,
  });
  const r = matchSpaSale({ booking: b, sales: [s] });
  assert.equal(r.kind, 'hint');
  if (r.kind === 'hint') {
    assert.equal(r.hint.kind, 'SALE_NO_PERFORMER');
  }
}

// --- Shut: day merge quota (times differ > 3 min, titles differ) ---
{
  const fitgo = booking({
    id: 'b-shut',
    startAt: new Date('2026-10-19T10:00:00.000Z'),
    paymentType: 'QUOTA',
    clientExternalId: 'cli-shut',
    clientName: 'Шут Елена Николаевна',
    serviceName: 'Массаж классический 50 мин',
  });
  const onex: SpaOnexCandidate = {
    externalId: 'onex-shut',
    number: '123',
    startAt: new Date('2026-10-19T10:46:00.000Z'),
    title: 'Массаж классический общий',
    employeeExternalId: '42',
    status: 'COMPLETED',
    members: [
      {
        externalId: 'cli-shut',
        clientName: 'Шут Елена Николаевна',
        paySource: 'PACKAGE',
      },
    ],
  };
  assert.equal(minskDayKey(fitgo.startAt), minskDayKey(onex.startAt));
  const day = matchSpaVisitByDay({
    booking: fitgo,
    onexSessions: [onex],
  });
  assert.equal(day.kind, 'auto');
  const pairs = buildSpaDayMergePairs({
    bookings: [fitgo],
    onexSessions: [onex],
    alreadyMatchedBookingIds: new Set(),
    alreadyMatchedOnexIds: new Set(),
  });
  assert.deepEqual(pairs, [
    { bookingId: 'b-shut', onexExternalId: 'onex-shut' },
  ]);
}

// --- Two write-offs same day → hint, no auto ---
{
  const fitgo = booking({
    id: 'b-two',
    startAt: new Date('2026-10-19T10:00:00.000Z'),
    paymentType: 'QUOTA',
    clientExternalId: 'cli-x',
    clientName: 'Клиент Тест',
  });
  const mk = (id: string, hour: number): SpaOnexCandidate => ({
    externalId: id,
    number: id,
    startAt: new Date(`2026-10-19T${String(hour).padStart(2, '0')}:00:00.000Z`),
    title: 'Массаж',
    employeeExternalId: '42',
    status: 'COMPLETED',
    members: [{ externalId: 'cli-x', clientName: 'Клиент Тест' }],
  });
  const r = matchSpaVisitByDay({
    booking: fitgo,
    onexSessions: [mk('o1', 10), mk('o2', 14)],
  });
  assert.equal(r.kind, 'hint');
  if (r.kind === 'hint') assert.equal(r.hint.kind, 'VISIT_MULTIPLE');
}

// --- Service titles: journal vs 1C nomenclature ---
{
  assert.equal(
    serviceNamesMatch(
      'Массаж классический общий 50 мин',
      'Массаж классический 50 мин',
    ),
    true,
  );
}

// --- Paid (non-quota) day merge when times differ > 3 min ---
{
  const fitgo = booking({
    id: 'b-zaitseva',
    startAt: new Date('2026-10-23T09:00:00.000Z'),
    paymentType: 'PAID',
    clientExternalId: 'cli-zai',
    clientName: 'Зайцева Татьяна',
    serviceName: 'Массаж классический 50 мин',
  });
  const onex: SpaOnexCandidate = {
    externalId: 'onex-zai',
    number: '456',
    startAt: new Date('2026-10-23T11:37:00.000Z'),
    title: 'Массаж классический общий 50 мин',
    employeeExternalId: '42',
    status: 'COMPLETED',
    members: [
      {
        externalId: 'cli-zai',
        clientName: 'Зайцева Татьяна',
        paySource: 'PACKAGE',
      },
    ],
  };
  const pairs = buildSpaDayMergePairs({
    bookings: [fitgo],
    onexSessions: [onex],
    alreadyMatchedBookingIds: new Set(),
    alreadyMatchedOnexIds: new Set(),
  });
  assert.deepEqual(pairs, [
    { bookingId: 'b-zaitseva', onexExternalId: 'onex-zai' },
  ]);
}

// --- Two FitGO bookings same client/day → no auto pair (contested) ---
{
  const a = booking({
    id: 'b-a',
    startAt: new Date('2026-10-23T09:00:00.000Z'),
    paymentType: 'PAID',
    clientExternalId: 'cli-dup',
    clientName: 'Дубль Клиент',
  });
  const b = booking({
    id: 'b-b',
    startAt: new Date('2026-10-23T14:00:00.000Z'),
    paymentType: 'PAID',
    clientExternalId: 'cli-dup',
    clientName: 'Дубль Клиент',
  });
  const onex: SpaOnexCandidate = {
    externalId: 'onex-dup',
    number: '789',
    startAt: new Date('2026-10-23T11:00:00.000Z'),
    title: 'Массаж',
    employeeExternalId: '42',
    status: 'COMPLETED',
    members: [{ externalId: 'cli-dup', clientName: 'Дубль Клиент' }],
  };
  const pairs = buildSpaDayMergePairs({
    bookings: [a, b],
    onexSessions: [onex],
    alreadyMatchedBookingIds: new Set(),
    alreadyMatchedOnexIds: new Set(),
  });
  assert.deepEqual(pairs, []);
}

// Free AllSports биоимпеданс (0 BYN) auto-links and counts as PAID
{
  const visit = new Date('2026-10-16T06:30:00.000Z');
  const b = booking({
    id: 'b-bio',
    startAt: visit,
    serviceName: 'Allsports БИОИМПЕДАНС',
    serviceExternalId: '8de2a45d-36c3-2cf1-11f1-318f3dd9913b',
    clientExternalId: 'cli-patulo',
    clientName: 'Патуло Дарья',
    specialistName: 'Бирюкова Екатерина',
    specialistExternalId: 'bio-perf',
  });
  const s = sale({
    externalId: 'sale-bio-free',
    occurredAt: visit,
    saleAmount: 0,
    paidAmount: 0,
    operationType: 'sale',
    productName: 'Allsports БИОИМПЕДАНС',
    productExternalId: '8de2a45d-36c3-2cf1-11f1-318f3dd9913b',
    clientExternalId: 'cli-patulo',
    clientName: 'Патуло Дарья',
    performerExternalId: 'bio-perf',
    performerName: 'Бирюкова Екатерина',
  });
  const r = matchSpaSale({ booking: b, sales: [s] });
  assert.equal(r.kind, 'auto');
  if (r.kind === 'auto') {
    assert.equal(r.paymentStatus, 'PAID');
    assert.equal(paidSaleSettlementLabel(r.sale), 'AllSports · бесплатно');
  }
}

assert.equal(namesMatch('Бирюкова Екатерина', 'Бирюкова Е.'), true);

// Paid cash sale must not leak the revenue key into the admin card.
{
  const key =
    '54b0d2e2-cb8a-11f1-0dec-a45d36e32cf1:cash:Долг:39b8fdb1-f15c-11e9-8108-7085c20c362e:c5e4e053-2c29-4b87-807a-c92a6a28eb5f:20261019095722:payment:p2026-10-19';
  const s = sale({
    externalId: key,
    occurredAt: new Date('2026-10-19T06:57:00.000Z'),
    cash: 90,
    paidAmount: 90,
    saleAmount: 90,
  });
  const label = paidSaleSettlementLabel(s);
  assert.equal(label, 'Оплачено · наличные 90.00 BYN');
  assert.equal(label.includes(key), false);
  assert.equal(humanDocumentNumber(key), undefined);
  assert.equal(humanDocumentNumber('32076'), '32076');
  assert.equal(
    humanDocumentNumber('54b0d2e2-cb8a-11f1-0dec-a45d36e32cf1'),
    undefined,
  );
}

console.log('spa-document-match.test.ts: ok');
