/**
 * Run: cd apps/api && npx ts-node --transpile-only src/booking-control/spa-document-match.test.ts
 */
import assert from 'node:assert/strict';
import {
  awaitingPaymentLabel,
  buildSpaDayMergePairs,
  matchSpaSale,
  matchSpaVisitByDay,
  minskDayKey,
  namesMatch,
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

assert.equal(namesMatch('Бирюкова Екатерина', 'Бирюкова Е.'), true);

console.log('spa-document-match.test.ts: ok');
