/**
 * Run: cd apps/api && npx ts-node --transpile-only src/booking-control/spa-document-match.test.ts
 */
import assert from 'node:assert/strict';
import {
  humanDocumentNumber,
  MEMBERSHIP_INCLUDED_SERVICES,
  MEMBERSHIP_INCLUDED_SPA_NAMES,
  isGeneralGroupMembershipService,
  isGroupReformerMembershipService,
  isMassageBlockCompositionLine,
  membershipAllowsGroupReformer,
  spaCatalogMatchesMembershipLine,
} from '@fitgo/shared-types';
import {
  awaitingPaymentLabel,
  buildSpaDayMergePairs,
  collapseSpaSalesByBasis,
  collapseSpaSalesByLine,
  matchSpaSale,
  matchSpaVisitByDay,
  minskDayKey,
  namesMatch,
  paidSaleSettlementLabel,
  isMembershipIncludedSpaTitle,
  pickBestServiceByDuration,
  preferredServiceDurationMin,
  saleAmountMajor,
  saleIsDebtWriteOff,
  saleIsPaid,
  saleIsSpaLinkCandidate,
  saleLineTotalMajor,
  saleTakenBlocksSpaLink,
  serviceNamesMatch,
  serviceNamesMatchForSaleLink,
  spaAnchoredLineKeys,
  spaRetailLineHasAnchor,
  spaSaleLineKey,
  spaTitleHasDurationMin,
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

// --- After admin unlink: blockAutoLink must not return auto ---
{
  const visit = new Date('2026-10-19T07:00:00.000Z');
  const b = booking({ id: 'b-unlink', startAt: visit });
  const s = sale({
    externalId: 'sale-unlink',
    occurredAt: new Date('2026-10-19T06:57:00.000Z'),
  });
  const r = matchSpaSale({ booking: b, sales: [s], blockAutoLink: true });
  assert.equal(r.kind, 'hint');
  if (r.kind === 'hint') {
    assert.equal(r.hint.kind, 'SALE_MULTIPLE');
    assert.equal(r.hint.candidates[0]?.externalId, 'sale-unlink');
  }
}

// --- Stored link keeps auto even when only a cash-key twin is in the list ---
{
  const visit = new Date('2026-10-29T13:35:00.000Z');
  const doc = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const b = booking({
    id: 'b-linked-twin',
    startAt: visit,
    linkedSaleExternalId: `${doc}:1`,
    serviceName: 'Массаж классический 25 мин',
  });
  const twin = sale({
    externalId: `pay:${doc}:cash:card:cli:${doc}:ts:op`,
    documentId: doc,
    occurredAt: new Date('2026-10-20T13:26:00.000Z'),
    productName: 'Блок массажа 10 новый',
    saleAmount: 450,
    paidAmount: 450,
  });
  const r = matchSpaSale({ booking: b, sales: [twin] });
  assert.equal(r.kind, 'auto');
  if (r.kind === 'auto') {
    assert.equal(r.sale.externalId, twin.externalId);
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

// --- Multi-visit pack purchase is never a visit payment candidate ---
{
  const visit = new Date('2026-10-29T13:35:00.000Z');
  const b = booking({
    id: 'b-unpaid-pack',
    startAt: visit,
    serviceName: 'Массаж классический 25 мин',
  });
  const unpaid = sale({
    externalId: 'sale-pack-unpaid',
    occurredAt: new Date('2026-10-20T13:26:00.000Z'),
    productName: 'Блок массажа 10 новый',
    saleAmount: 450,
    paidAmount: 0,
    operationType: 'unpaid',
  });
  const paid = sale({
    externalId: 'sale-pack-paid',
    occurredAt: new Date('2026-10-20T15:47:00.000Z'),
    productName: 'Блок массажа 10 новый',
    saleAmount: 675,
    paidAmount: 675,
  });
  assert.equal(matchSpaSale({ booking: b, sales: [unpaid] }).kind, 'none');
  assert.equal(matchSpaSale({ booking: b, sales: [paid] }).kind, 'none');
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

// --- Kishkis: 25 мин ≠ 40 мин; same-day unpaid ranked first, but no auto ---
{
  assert.equal(
    serviceNamesMatch('Массаж классический 25 мин', 'Массаж классический 40 мин'),
    false,
  );
  const visit = new Date('2026-10-08T10:00:00.000Z');
  const b = booking({
    id: 'b-kishkis',
    startAt: visit,
    clientExternalId: 'cli-kish',
    clientName: 'Кишкис Надежда',
    serviceName: 'Массаж классический 25 мин',
    serviceExternalId: 'svc-25',
  });
  const stale = sale({
    externalId: 'sale-sept',
    occurredAt: new Date('2026-09-30T12:00:00.000Z'),
    productName: 'Массаж классический 25 мин',
    productExternalId: 'svc-25',
    clientExternalId: 'cli-kish',
    clientName: 'Кишкис Надежда Геннадьевна',
  });
  const unpaidSameDay = sale({
    externalId: 'sale-30863',
    occurredAt: new Date('2026-10-08T11:00:00.000Z'),
    paidAmount: 0,
    saleAmount: 30,
    operationType: 'unpaid',
    productName: 'Массаж классический 25 мин',
    productExternalId: 'svc-25',
    clientExternalId: 'cli-kish',
    clientName: 'Кишкис Надежда Геннадьевна (Сотрудник)',
  });
  const wrongDur = sale({
    externalId: 'sale-40',
    occurredAt: new Date('2026-10-08T12:00:00.000Z'),
    productName: 'Массаж классический 40 мин',
    productExternalId: 'svc-40',
    clientExternalId: 'cli-kish',
    clientName: 'Кишкис Надежда',
  });
  const r = matchSpaSale({
    booking: b,
    sales: [stale, unpaidSameDay, wrongDur],
  });
  // Two sales fit client+performer+service → admin picks, nearest day first.
  assert.equal(r.kind, 'hint');
  if (r.kind === 'hint') {
    assert.equal(r.hint.kind, 'SALE_MULTIPLE');
    assert.match(r.hint.message, /Несколько продаж \(2\) — выберите строку/);
    assert.deepEqual(
      r.hint.candidates.map((c) => c.externalId),
      ['sale-30863', 'sale-sept'],
    );
  }
  // Alone, the same-day unpaid still auto-links.
  const solo = matchSpaSale({ booking: b, sales: [unpaidSameDay, wrongDur] });
  assert.equal(solo.kind, 'auto');
  if (solo.kind === 'auto') {
    assert.equal(solo.sale.externalId, 'sale-30863');
    assert.equal(solo.paymentStatus, 'DEBT');
  }
}

// --- Shimanskaya: late sale + journal typo «моссажем» still auto-links ---
{
  assert.equal(
    serviceNamesMatch(
      'Уход за лицом с моссажем Angiorharm 50 мин',
      'Уход за лицом с массажем Angiorharm 50 мин',
    ),
    true,
  );
  const visit = new Date('2026-10-08T08:00:00.000Z');
  const b = booking({
    id: 'b-shim',
    startAt: visit,
    clientName: 'Шиманская Екатерина',
    serviceName: 'Уход за лицом с моссажем Angiorharm 50 мин',
    serviceExternalId: 'svc-angio',
  });
  const s = sale({
    externalId: 'sale-32774',
    occurredAt: new Date('2026-10-23T12:00:00.000Z'),
    paidAt: new Date('2026-10-17T12:09:00.000Z'),
    saleAmount: 42.5,
    paidAmount: 42.5,
    cash: 42.5,
    productName: 'Уход за лицом с массажем Angiorharm 50 мин',
    productExternalId: 'svc-angio',
    clientName: 'Шиманская Екатерина (Сотрудник)',
  });
  const r = matchSpaSale({ booking: b, sales: [s] });
  assert.equal(r.kind, 'auto');
  if (r.kind === 'auto') {
    assert.equal(r.sale.externalId, 'sale-32774');
    assert.equal(r.paymentStatus, 'PAID');
  }
}

// --- Loyko: debt write-off counts as paid settlement base ---
{
  assert.equal(saleIsDebtWriteOff({ operationType: 'debt_writeoff' } as SpaSaleCandidate), true);
  const visit = new Date('2026-10-13T08:00:00.000Z');
  const b = booking({
    id: 'b-loyko',
    startAt: visit,
    clientName: 'Лойко Алексей',
    serviceName: 'Массаж классический 25 мин',
  });
  const s = sale({
    externalId: 'sale-31354:u2026-10-13',
    occurredAt: visit,
    saleAmount: 30,
    paidAmount: 0,
    operationType: 'debt_writeoff',
    productName: 'Массаж классический 25 мин',
    clientName: 'Лойко Алексей Евгеньевич (Сотрудник)',
  });
  assert.equal(saleIsPaid(s), true);
  const r = matchSpaSale({ booking: b, sales: [s] });
  assert.equal(r.kind, 'auto');
  if (r.kind === 'auto') {
    assert.equal(r.paymentStatus, 'PAID');
    assert.match(paidSaleSettlementLabel(r.sale), /Списание задолженности/);
    assert.equal(saleAmountMajor(r.sale), 30);
  }
}

// --- Loyko 34221: guest without 1C id, write-off 45 after 50% discount.
// Coffee debts of the same surname must not steal the massage line.
{
  const visit = new Date('2026-11-04T10:00:00.000Z');
  const b = booking({
    id: 'b-loyko-34221',
    startAt: visit,
    clientName: 'Лойко Алексей',
    clientExternalId: null,
    serviceName: 'Массаж классический 50 мин',
    serviceExternalId: null,
    specialistExternalId: 'staff-bir',
    specialistEmployeeCode: '000000154',
  });
  const writeOff = sale({
    externalId:
      '91749625-fe20-4f0a-87a9-d2b85e616c0e:debt:a6b05b09-ac7c-11e8-80e8-7085c20c362e:u2026-11-04',
    documentId: '91749625-fe20-4f0a-87a9-d2b85e616c0e',
    occurredAt: new Date('2026-11-04T20:13:01.000Z'),
    saleAmount: 45,
    paidAmount: 0,
    cash: 0,
    card: 0,
    operationType: 'debt_writeoff',
    productName: 'Массаж классический 50 мин',
    productExternalId: '72233086-a555-11e8-80e8-7085c20c362e',
    clientExternalId: 'a6b05b09-ac7c-11e8-80e8-7085c20c362e',
    clientName: 'Лойко Алексей Евгеньевич (Сотрудник)',
    performerExternalId: '000000154',
    performerName: 'Бирюкова Екатерина',
  });
  const coffee = Array.from({ length: 40 }, (_, i) =>
    sale({
      externalId: `coffee-${i}`,
      occurredAt: new Date('2026-11-16T08:00:00.000Z'),
      saleAmount: 3.5,
      paidAmount: 0,
      operationType: 'unpaid',
      productName: 'Лунго',
      productExternalId: 'sku-lungo',
      clientExternalId: 'a6b05b09-ac7c-11e8-80e8-7085c20c362e',
      clientName: 'Лойко Алексей Евгеньевич (Сотрудник)',
      performerExternalId: '',
      performerName: '',
    }),
  );
  const r = matchSpaSale({ booking: b, sales: [writeOff, ...coffee] });
  assert.equal(r.kind, 'auto');
  if (r.kind === 'auto') {
    assert.equal(r.paymentStatus, 'PAID');
    assert.equal(saleLineTotalMajor(r.sale), 45);
    assert.match(paidSaleSettlementLabel(r.sale), /45\.00 BYN/);
  }
}

// --- Dubovik: client's sale is on another specialist. Do not offer the
// booking specialist's other massages as if they were the document.
{
  const visit = new Date('2026-10-07T12:00:00.000Z');
  const b = booking({
    id: 'b-dubovik',
    startAt: visit,
    clientName: 'Дубовик Дмитрий',
    clientExternalId: 'cli-dub',
    specialistName: 'Абрамчик Егор',
    specialistExternalId: 'staff-abr',
    serviceName: 'Массаж классический 50 мин',
  });
  const telica = sale({
    externalId: 'sale-33742',
    occurredAt: new Date('2026-11-01T11:00:00.000Z'),
    saleAmount: 90,
    paidAmount: 90,
    productName: 'Массаж классический 50 мин',
    clientExternalId: 'cli-dub',
    clientName: 'Дубовик Дмитрий Сергеевич',
    performerExternalId: 'staff-tel',
    performerName: 'Телица Вадим',
  });
  const abramSep = sale({
    externalId: 'sale-abr-sep',
    occurredAt: new Date('2026-09-25T13:59:00.000Z'),
    productName: 'Массаж классический 50 мин',
    clientExternalId: 'cli-dub',
    clientName: 'Дубовик Дмитрий Сергеевич',
    performerExternalId: 'staff-abr',
    performerName: 'Абрамчик Егор',
  });
  const abramOct = sale({
    externalId: 'sale-abr-oct',
    occurredAt: new Date('2026-10-16T17:05:00.000Z'),
    productName: 'Массаж классический 50 мин',
    clientExternalId: 'cli-dub',
    clientName: 'Дубовик Дмитрий Сергеевич',
    performerExternalId: 'staff-abr',
    performerName: 'Абрамчик Егор',
  });
  const r = matchSpaSale({
    booking: b,
    sales: [abramSep, abramOct, telica],
  });
  assert.equal(r.kind, 'hint');
  if (r.kind === 'hint') {
    assert.equal(r.hint.kind, 'SALE_OTHER_PERFORMER');
    assert.match(r.hint.message, /Телица Вадим/);
    assert.match(r.hint.message, /Абрамчик Егор/);
    assert.match(r.hint.message, /записи FitGO/);
    assert.match(r.hint.message, /документе 1С/);
    assert.equal(r.hint.candidates[0]?.externalId, 'sale-33742');
    assert.equal(r.hint.candidates[0]?.performerName, 'Телица Вадим');
  }
}

// --- Khodanovich: mixed pays across days — SUM, unpaid until full ---
{
  const saleUuid = 'b1b7cad3-33cb-4c57-8336-f5b0828a0f90';
  const client = '51f155c2-610e-11ee-8dd1-a45d36c32cf1';
  const visit = new Date('2026-10-02T12:00:00.000Z');
  const unpaid = sale({
    externalId: `${saleUuid}:debt:${client}:u2026-10-08`,
    documentId: saleUuid,
    occurredAt: new Date('2026-10-08T16:10:15.000Z'),
    saleAmount: 27.5,
    paidAmount: 0,
    operationType: 'unpaid',
    productName: 'Массаж лица 25 мин',
    clientExternalId: client,
    clientName: 'Ходанович Мария Михайловна (Сотрудник)',
    performerExternalId: '000000162',
    performerName: 'Абрамчик Егор Викторович',
  });
  const pay1 = sale({
    externalId: `76e6658e-c54c-11f1-8dec-a45d36c32cf1:cash:Долг:${client}:${saleUuid}:20261011205418:payment:p2026-10-11`,
    documentId: '76e6658e-c54c-11f1-8dec-a45d36c32cf1',
    occurredAt: new Date('2026-10-11T17:54:18.000Z'),
    paidAt: new Date('2026-10-11T17:54:18.000Z'),
    saleAmount: 7.5,
    paidAmount: 7.5,
    operationType: 'payment',
    cash: 7.5,
    productName: 'Массаж лица 25 мин',
    clientExternalId: client,
    clientName: 'Ходанович Мария Михайловна (Сотрудник)',
    performerExternalId: '000000162',
    performerName: 'Абрамчик Егор Викторович',
  });
  const pay2 = sale({
    externalId: `pay2:cash:Долг:${client}:${saleUuid}:20261016000000:payment:p2026-10-16`,
    documentId: 'pay2',
    occurredAt: new Date('2026-10-16T12:00:00.000Z'),
    paidAt: new Date('2026-10-16T12:00:00.000Z'),
    saleAmount: 1,
    paidAmount: 1,
    operationType: 'payment',
    cash: 1,
    productName: 'Массаж лица 25 мин',
    clientExternalId: client,
    clientName: 'Ходанович Мария Михайловна (Сотрудник)',
  });
  const pay3 = sale({
    externalId: `da91b3ec-cecc-11f1-8dec-a45d36c32cf1:cash:Долг:${client}:${saleUuid}:20261023133107:payment:p2026-10-23`,
    documentId: 'da91b3ec-cecc-11f1-8dec-a45d36c32cf1',
    occurredAt: new Date('2026-10-23T10:31:07.000Z'),
    paidAt: new Date('2026-10-23T10:31:07.000Z'),
    saleAmount: 19,
    paidAmount: 19,
    operationType: 'payment',
    card: 19,
    productName: 'Массаж лица 25 мин',
    clientExternalId: client,
    clientName: 'Ходанович Мария Михайловна (Сотрудник)',
    performerExternalId: '000000162',
    performerName: 'Абрамчик Егор Викторович',
  });

  const partial = collapseSpaSalesByBasis([unpaid, pay1]);
  assert.equal(partial.length, 1);
  assert.equal(saleIsPaid(partial[0]!), false);
  assert.ok((partial[0]!.paidAmount || 0) >= 7.4 && (partial[0]!.paidAmount || 0) <= 7.6);
  assert.match(awaitingPaymentLabel(partial[0]!), /Частично оплачено|остаток|Ждёт оплаты/);

  const full = collapseSpaSalesByBasis([unpaid, pay1, pay2, pay3]);
  assert.equal(full.length, 1);
  assert.equal(roundMajorForTest(full[0]!.paidAmount), 27.5);
  assert.equal(saleIsPaid(full[0]!), true);
  assert.match(paidSaleSettlementLabel(full[0]!), /наличные|карта/);

  const b = booking({
    id: 'b-face',
    startAt: visit,
    clientExternalId: client,
    clientName: 'Ходанович Мария',
    specialistName: 'Абрамчик Егор Викторович',
    specialistEmployeeCode: '000000162',
    serviceName: 'Массаж лица 25 мин',
  });
  const mid = matchSpaSale({ booking: b, sales: [unpaid, pay1] });
  assert.equal(mid.kind, 'auto');
  if (mid.kind === 'auto') {
    assert.equal(mid.paymentStatus, 'DEBT');
  }
  const done = matchSpaSale({
    booking: b,
    sales: [unpaid, pay1, pay2, pay3],
  });
  assert.equal(done.kind, 'auto');
  if (done.kind === 'auto') {
    assert.equal(done.paymentStatus, 'PAID');
    assert.equal(done.sale.occurredAt.toISOString().slice(0, 10), '2026-10-08');
  }
}

function roundMajorForTest(n: number | null | undefined): number {
  return Math.round((Number(n) || 0) * 100) / 100;
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

// --- VIP pack lines (qty varies) vs timed retail SKU ---
{
  assert.deepEqual(
    [...MEMBERSHIP_INCLUDED_SPA_NAMES],
    ['Массаж классический общий', 'Анализ состава тела'],
  );
  assert.equal(
    MEMBERSHIP_INCLUDED_SERVICES.some(
      (s) => s.name === 'Подарочная ПТ с тренером' && s.kind === 'PT',
    ),
    true,
  );
  assert.equal(isMembershipIncludedSpaTitle('Массаж классический общий'), true);
  assert.equal(spaTitleHasDurationMin('Массаж классический общий'), false);
  assert.equal(isMembershipIncludedSpaTitle('Массаж классический 50 мин'), false);
  assert.equal(spaTitleHasDurationMin('Массаж классический 50 мин'), true);
  assert.equal(isMembershipIncludedSpaTitle('Анализ состава тела'), true);
  assert.equal(
    isMembershipIncludedSpaTitle('Подарочная ПТ с тренером'),
    false,
  );
  assert.equal(
    spaCatalogMatchesMembershipLine({
      membershipServiceName: 'Массаж классический общий',
      catalogName: 'Массаж классический общий',
      catalogKind: 'MASSAGE',
    }),
    true,
  );
  assert.equal(
    spaCatalogMatchesMembershipLine({
      membershipServiceName: 'Массаж классический общий',
      catalogName: 'Массаж лица 40 мин',
      catalogKind: 'MASSAGE',
    }),
    false,
  );
  assert.equal(
    spaCatalogMatchesMembershipLine({
      membershipServiceName: 'Анализ состава тела',
      catalogName: 'Массаж классический 50 мин',
      catalogKind: 'MASSAGE',
    }),
    false,
  );
  assert.equal(
    spaCatalogMatchesMembershipLine({
      membershipServiceName: 'Анализ состава тела',
      catalogName: 'Анализ состава тела (InBody)',
      catalogKind: 'BODY_COMPOSITION',
    }),
    true,
  );
  // Massage block СоставУслуг: only the sold timed SKU, not every classic duration.
  assert.equal(isMassageBlockCompositionLine('Массаж классический 25 мин'), true);
  assert.equal(isMassageBlockCompositionLine('Массаж классический 25 мин (10)'), true);
  assert.equal(isMassageBlockCompositionLine('Массаж классический общий'), false);
  assert.equal(
    spaCatalogMatchesMembershipLine({
      membershipServiceName: 'Массаж классический 25 мин (10)',
      catalogName: 'Массаж классический 25 мин',
      catalogKind: 'MASSAGE',
    }),
    true,
  );
  assert.equal(
    spaCatalogMatchesMembershipLine({
      membershipServiceName: 'Массаж классический 25 мин',
      catalogName: 'Массаж классический 50 мин',
      catalogKind: 'MASSAGE',
    }),
    false,
  );
  assert.equal(
    spaCatalogMatchesMembershipLine({
      membershipServiceName: 'Массаж классический 25 мин',
      catalogName: 'Массаж лица 25 мин',
      catalogKind: 'MASSAGE',
    }),
    false,
  );
  assert.equal(
    membershipAllowsGroupReformer([
      { name: 'Групповые программы' },
    ]),
    false,
  );
  assert.equal(
    membershipAllowsGroupReformer([
      { name: 'Групповые программы' },
      { name: 'Групповое занятие реформер 1' },
    ]),
    true,
  );
  assert.equal(
    isGroupReformerMembershipService('Групповое занятие реформер 1'),
    true,
  );
  assert.equal(
    isGeneralGroupMembershipService('Групповое занятие реформер 1'),
    false,
  );
  assert.equal(
    isGeneralGroupMembershipService('Групповые программы'),
    true,
  );
}

// --- Quota-linked classical SKUs: pick by visit length (60 → 50) ---
{
  const catalog = [
    { id: '25', durationMin: 25, name: 'Классический спа-массаж 25 мин' },
    { id: '40', durationMin: 40, name: 'Классический спа-массаж 40 мин' },
    { id: '50', durationMin: 50, name: 'Классический спа-массаж 50 мин' },
    { id: '80', durationMin: 80, name: 'Классический спа-массаж 80 мин' },
  ];
  const preferred = preferredServiceDurationMin({
    title: 'Массаж классический общий',
    durationMin: 60,
  });
  assert.equal(preferred, 60);
  const best = pickBestServiceByDuration(catalog, preferred);
  assert.equal(best?.id, '50');
  const fromTitle = preferredServiceDurationMin({
    title: 'Массаж классический 50 мин',
  });
  assert.equal(fromTitle, 50);
  assert.equal(pickBestServiceByDuration(catalog, fromTitle)?.id, '50');
}

// --- VIP pack title ↔ retail SKUs when SpaQuotaRule missing (Auto) ---
{
  assert.equal(
    serviceNamesMatch(
      'Массаж классический общий',
      'Классический спа-массаж 50 мин',
    ),
    true,
  );
  assert.equal(
    serviceNamesMatch(
      'Массаж классический общий',
      'Расслабляющий спа-массаж 50 мин',
    ),
    false,
  );
  const vipHits = [
    'Классический спа-массаж 25 мин',
    'Классический спа-массаж 40 мин',
    'Классический спа-массаж 50 мин',
    'Классический спа-массаж 80 мин',
    'Расслабляющий спа-массаж 50 мин',
    'Бандажирование + спа-массаж',
  ].filter((name) => serviceNamesMatch('Массаж классический общий', name));
  assert.deepEqual(vipHits, [
    'Классический спа-массаж 25 мин',
    'Классический спа-массаж 40 мин',
    'Классический спа-массаж 50 мин',
    'Классический спа-массаж 80 мин',
  ]);
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

// Soft list must not offer café sales; only SPA nomenclature.
{
  const visit = new Date('2026-10-30T10:50:00.000Z');
  const b = booking({
    id: 'b-loyko',
    startAt: visit,
    clientExternalId: 'cli-loyko',
    clientName: 'Лойко Алексей',
    specialistName: 'Бирюкова Екатерина',
    specialistExternalId: '42',
    serviceName: 'Массаж классический 40 мин',
    serviceExternalId: 'svc-40',
  });
  const coffee = sale({
    externalId: 'sale-cappuccino',
    occurredAt: new Date('2026-10-30T10:45:00.000Z'),
    saleAmount: 3.15,
    paidAmount: 3.15,
    productName: 'Капучино',
    productExternalId: 'cafe-cap',
    clientExternalId: 'cli-loyko',
    clientName: 'Лойко Алексей',
    performerExternalId: null,
    performerName: null,
  });
  const lungo = sale({
    externalId: 'sale-lungo',
    occurredAt: new Date('2026-10-30T09:11:00.000Z'),
    saleAmount: 3.5,
    paidAmount: 3.5,
    productName: 'Лунго',
    productExternalId: 'cafe-lungo',
    clientExternalId: 'cli-loyko',
    clientName: 'Лойко Алексей',
    performerExternalId: null,
    performerName: null,
  });
  const mass = sale({
    externalId: 'sale-mass-40',
    occurredAt: new Date('2026-10-30T10:40:00.000Z'),
    saleAmount: 80,
    paidAmount: 80,
    productName: 'Массаж классический 40 мин',
    productExternalId: 'svc-40',
    clientExternalId: 'cli-loyko',
    clientName: 'Лойко Алексей',
    performerExternalId: '42',
    performerName: 'Бирюкова Екатерина',
  });
  assert.equal(saleIsSpaLinkCandidate(coffee), false);
  assert.equal(saleIsSpaLinkCandidate(lungo), false);
  assert.equal(saleIsSpaLinkCandidate(mass), true);
  const r = matchSpaSale({
    booking: b,
    sales: [coffee, lungo, mass],
  });
  assert.equal(r.kind, 'auto');
  if (r.kind === 'auto') {
    assert.equal(r.sale.externalId, 'sale-mass-40');
  }
  const onlyCafe = matchSpaSale({
    booking: b,
    sales: [coffee, lungo],
  });
  assert.equal(onlyCafe.kind, 'none');
}

// Taken retail SPA sale is blocked; massage block purchase is never offered.
{
  const visit = new Date('2026-10-19T07:00:00.000Z');
  const b = booking({ id: 'b-block', startAt: visit });
  const takenRetail = sale({
    externalId: 'sale-taken-retail',
    occurredAt: visit,
  });
  const block = sale({
    externalId: 'sale-mass-block',
    occurredAt: visit,
    saleAmount: 450,
    paidAmount: 450,
    productName: 'Блок массажа 10',
    productExternalId: 'block-10',
  });
  assert.equal(
    saleTakenBlocksSpaLink(takenRetail, new Set(['sale-taken-retail'])),
    true,
  );
  assert.equal(
    saleTakenBlocksSpaLink(block, new Set(['sale-mass-block'])),
    false,
  );
  const r = matchSpaSale({
    booking: b,
    sales: [takenRetail, block],
    takenSaleIds: new Set(['sale-taken-retail', 'sale-mass-block']),
  });
  assert.equal(r.kind, 'none');
}

// Guest booking (no clientExternalId) + 50% discount sale (catalog 80 → paid 40).
// Match is by FIO + performer + nomenclature — amount must not block auto-link.
{
  const visit = new Date('2026-10-13T08:55:00.000Z');
  const b = booking({
    id: 'b-borich-guest',
    startAt: visit,
    clientExternalId: null,
    clientName: 'Боричевский денис',
    specialistName: 'Абрамчик Егор',
    specialistExternalId: 'abr-egor',
    serviceName: 'Массаж классический 40 мин',
    serviceExternalId: 'svc-mass-40',
  });
  const s = sale({
    externalId: 'sale-borich-40',
    occurredAt: new Date('2026-10-13T13:38:00.000Z'),
    saleAmount: 40,
    paidAmount: 40,
    cash: 40,
    productName: 'Массаж классический 40 мин',
    productExternalId: 'svc-mass-40',
    clientExternalId: 'cli-borich',
    clientName: 'Боричевский Денис Константинович',
    performerExternalId: 'abr-egor',
    performerName: 'Абрамчик Егор Викторович',
  });
  assert.equal(namesMatch(b.clientName, s.clientName), true);
  const r = matchSpaSale({ booking: b, sales: [s] });
  assert.equal(r.kind, 'auto');
  if (r.kind === 'auto') {
    assert.equal(r.sale.externalId, 'sale-borich-40');
    assert.equal(r.paymentStatus, 'PAID');
    assert.equal(saleAmountMajor(r.sale), 40);
  }
}

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

// Two nomenclature lines in one Документ.Продажа stay two candidates.
{
  const doc = 'c0ffee00-1111-2222-3333-444455556666';
  const face = sale({
    externalId: `${doc}:1`,
    documentId: doc,
    occurredAt: new Date('2026-10-02T12:00:00.000Z'),
    saleAmount: 27.5,
    paidAmount: 0,
    operationType: 'unpaid',
    productName: 'Массаж лица 25 мин',
    productExternalId: 'svc-face-25',
  });
  const wrap = sale({
    externalId: `${doc}:2`,
    documentId: doc,
    occurredAt: new Date('2026-10-02T12:00:00.000Z'),
    saleAmount: 75,
    paidAmount: 75,
    operationType: 'sale',
    productName: 'Обертывание шоколадное 50 мин',
    productExternalId: 'svc-wrap-50',
  });
  const payFace = sale({
    externalId: `payf:cash:Долг:cli-gur:${doc}:20261004120000:payment`,
    documentId: 'payf',
    occurredAt: new Date('2026-10-04T12:00:00.000Z'),
    paidAt: new Date('2026-10-04T12:00:00.000Z'),
    saleAmount: 27.5,
    paidAmount: 27.5,
    cash: 27.5,
    operationType: 'payment',
    productName: 'Массаж лица 25 мин',
    productExternalId: 'svc-face-25',
  });

  assert.notEqual(spaSaleLineKey(face), spaSaleLineKey(wrap));
  // Document collapse loses the second line; line collapse keeps both.
  assert.equal(collapseSpaSalesByBasis([face, wrap, payFace]).length, 1);
  const lines = collapseSpaSalesByLine([face, wrap, payFace]);
  assert.equal(lines.length, 2);
  const faceLine = lines.find((l) => l.externalId === `${doc}:1`)!;
  assert.equal(saleLineTotalMajor(faceLine), 27.5);
  assert.equal(saleIsPaid(faceLine), true);
  const anchors = spaAnchoredLineKeys([face, wrap, payFace]);
  assert.equal(spaRetailLineHasAnchor(faceLine, anchors), true);

  // Debt repayment slices for OLD SPA sales (anchor outside the loaded
  // window) must not invent retail visits — Ходанович Oct 2026.
  const oldDebtPay = sale({
    externalId: `17c18cb5-d351-11f1-8dec-a45d36c32cf1:cash:Долг:cli:44fc4edb-a5e3-4892-b892-c0e0c51d386c:20261029072747:payment`,
    documentId: '17c18cb5-d351-11f1-8dec-a45d36c32cf1',
    occurredAt: new Date('2026-10-29T04:27:47.000Z'),
    paidAt: new Date('2026-10-29T04:27:47.000Z'),
    saleAmount: 5.26,
    paidAmount: 5.26,
    cash: 5.26,
    operationType: 'payment',
    productName: 'Массаж классический 25 мин',
    productExternalId: '7223308a',
    performerName: 'Абрамчик Егор Викторович',
    clientName: 'Ходанович Мария Михайловна (Сотрудник)',
  });
  const classic40Pay = sale({
    externalId: `76e6658e-c54c-11f1-8dec-a45d36c32cf1:cash:Долг:cli:879bd05a-93e5-4774-ade4-e1f1672f5260:20261011205418:payment`,
    documentId: '76e6658e-c54c-11f1-8dec-a45d36c32cf1',
    occurredAt: new Date('2026-10-11T17:54:18.000Z'),
    paidAt: new Date('2026-10-11T17:54:18.000Z'),
    saleAmount: 2.5,
    paidAmount: 2.5,
    cash: 2.5,
    operationType: 'payment',
    productName: 'Массаж классический 40 мин',
    productExternalId: 'e370fe03',
    performerName: 'Бирюкова Екатерина',
    clientName: 'Ходанович Мария Михайловна (Сотрудник)',
  });
  const classic50Pay = sale({
    externalId: `76e6658e-c54c-11f1-8dec-a45d36c32cf1:cash:Долг:cli:0dc408f7-c3d0-4dd1-94af-7a5b72a545f7:20261011205418:payment`,
    documentId: '76e6658e-c54c-11f1-8dec-a45d36c32cf1',
    occurredAt: new Date('2026-10-11T17:54:18.000Z'),
    paidAt: new Date('2026-10-11T17:54:18.000Z'),
    saleAmount: 5,
    paidAmount: 5,
    cash: 5,
    operationType: 'payment',
    productName: 'Массаж классический 50 мин',
    productExternalId: '72233086',
    performerName: 'Абрамчик Егор',
    clientName: 'Ходанович Мария Михайловна (Сотрудник)',
  });
  const orphanPays = collapseSpaSalesByLine([
    oldDebtPay,
    classic40Pay,
    classic50Pay,
  ]);
  assert.equal(orphanPays.length, 3);
  const emptyAnchors = spaAnchoredLineKeys([
    oldDebtPay,
    classic40Pay,
    classic50Pay,
  ]);
  assert.equal(emptyAnchors.size, 0);
  for (const row of orphanPays) {
    assert.equal(spaRetailLineHasAnchor(row, emptyAnchors), false);
  }

  const b = booking({
    id: 'b-two-lines',
    startAt: new Date('2026-10-02T12:00:00.000Z'),
    serviceName: 'Массаж лица 25 мин',
    serviceExternalId: 'svc-face-25',
  });
  const r = matchSpaSale({ booking: b, sales: [face, wrap, payFace] });
  assert.equal(r.kind, 'auto');
  if (r.kind === 'auto') {
    assert.equal(r.sale.externalId, `${doc}:1`);
    assert.equal(saleLineTotalMajor(r.sale), 27.5);
    assert.equal(r.paymentStatus, 'PAID');
  }
}

// Stale sticky link (service changed) must not keep the wrong document.
{
  const visit = new Date('2026-10-19T07:00:00.000Z');
  const b = booking({
    id: 'b-stale-link',
    startAt: visit,
    linkedSaleExternalId: 'sale-sport-link',
  });
  const wrong = sale({
    externalId: 'sale-sport-link',
    occurredAt: visit,
    productName: 'Массаж спортивный 40 мин',
    productExternalId: 'svc-sport',
  });
  const r = matchSpaSale({ booking: b, sales: [wrong] });
  assert.notEqual(r.kind, 'auto');
  if (r.kind === 'hint') {
    assert.equal(r.hint.kind, 'SALE_OTHER_NOMENCLATURE');
  }
}

// Two equally exact sales → always a pick list, never same-day guessing.
{
  const visit = new Date('2026-10-19T07:00:00.000Z');
  const b = booking({ id: 'b-two-exact', startAt: visit });
  const sameDay = sale({
    externalId: 'sale-same-day',
    occurredAt: new Date('2026-10-19T06:50:00.000Z'),
  });
  const nextDay = sale({
    externalId: 'sale-next-day',
    occurredAt: new Date('2026-10-20T09:00:00.000Z'),
  });
  const r = matchSpaSale({ booking: b, sales: [sameDay, nextDay] });
  assert.equal(r.kind, 'hint');
  if (r.kind === 'hint') {
    assert.equal(r.hint.kind, 'SALE_MULTIPLE');
    assert.equal(r.hint.message, 'Несколько продаж (2) — выберите строку');
    assert.equal(r.hint.candidates[0]?.externalId, 'sale-same-day');
    assert.equal(r.hint.candidates[0]?.amountMajor, 90);
  }
}

// Block pack purchase is never a spa link target.
{
  const block = sale({
    externalId: 'sale-block-10',
    occurredAt: new Date('2026-10-19T07:00:00.000Z'),
    saleAmount: 450,
    paidAmount: 450,
    productName: 'Блок массажа 10',
    productExternalId: 'block-10',
  });
  assert.equal(saleIsSpaLinkCandidate(block), false);
  assert.equal(
    saleIsSpaLinkCandidate(block, new Map([['block-10', 'svc-x']])),
    false,
  );
}

// Joined cache row («A, B») is not one nomenclature.
{
  const visit = new Date('2026-10-19T07:00:00.000Z');
  const b = booking({ id: 'b-joined', startAt: visit });
  const joined = sale({
    externalId: 'sale-joined',
    occurredAt: visit,
    productName: 'Массаж классический 50 мин, Капучино',
    productExternalId: null,
  });
  assert.equal(saleIsSpaLinkCandidate(joined), false);
  assert.equal(
    serviceNamesMatchForSaleLink(
      'Массаж классический 50 мин, Капучино',
      'Массаж классический 50 мин',
    ),
    false,
  );
  const r = matchSpaSale({ booking: b, sales: [joined] });
  assert.equal(r.kind, 'hint');
  if (r.kind === 'hint') {
    assert.equal(r.hint.kind, 'SALE_JOINED_PRODUCT');
  }
}

// Timed SKU must not link to an untimed («общий») title.
{
  assert.equal(
    serviceNamesMatch('Массаж классический общий', 'Массаж классический 50 мин'),
    true,
  );
  assert.equal(
    serviceNamesMatchForSaleLink(
      'Массаж классический общий',
      'Массаж классический 50 мин',
    ),
    false,
  );
  assert.equal(
    serviceNamesMatchForSaleLink(
      'Массаж классический 50 мин',
      'Массаж классический общий 50 мин',
    ),
    true,
  );
}

// Same FIO, different 1C client cards (клиент vs «Сотрудник») → auto-link.
{
  const visit = new Date('2026-10-19T07:00:00.000Z');
  const b = booking({ id: 'b-dup-card', startAt: visit });
  const s = sale({
    externalId: 'sale-other-card',
    occurredAt: visit,
    clientExternalId: 'cli-gur-duplicate',
  });
  const r = matchSpaSale({ booking: b, sales: [s] });
  assert.equal(r.kind, 'auto');
  if (r.kind === 'auto') {
    assert.equal(r.sale.externalId, 'sale-other-card');
  }
}

// Different FIO + different client cards → mismatch hint (no silent link).
{
  const visit = new Date('2026-10-19T07:00:00.000Z');
  const b = booking({ id: 'b-wrong-person', startAt: visit });
  const s = sale({
    externalId: 'sale-other-person',
    occurredAt: visit,
    clientExternalId: 'cli-other',
    clientName: 'Иванов Пётр',
  });
  const r = matchSpaSale({ booking: b, sales: [s] });
  // clientMatchesSale fails on FIO → not even otherClientCard; none or other path
  assert.equal(r.kind, 'none');
}

// VIP write-off: specialist code mismatch, FIO match → auto day-link.
{
  const fitgo = booking({
    id: 'b-vip-fio',
    startAt: new Date('2026-11-04T07:00:00.000Z'),
    paymentType: 'PAID',
    clientExternalId: 'cli-mal-phone',
    clientName: 'Малышев Сергей',
    specialistExternalId: 'staff-uuid-bir',
    specialistName: 'Бирюкова Екатерина',
    serviceName: 'Массаж классический 50 мин',
  });
  const onex: SpaOnexCandidate = {
    externalId: 'onex-vip-mal',
    number: '112856',
    startAt: new Date('2026-11-04T07:55:00.000Z'),
    title: 'Массаж классический общий',
    employeeExternalId: '000000099',
    employeeName: 'Бирюкова Екатерина',
    status: 'COMPLETED',
    members: [
      {
        externalId: 'cli-mal-employee',
        clientName: 'Малышев Сергей Михайлович',
        paySource: 'PACKAGE',
        paymentBasis: 'Членство: "VIP (6 месяцев)" до 31.08.2026',
      },
    ],
  };
  const day = matchSpaVisitByDay({
    booking: fitgo,
    onexSessions: [onex],
  });
  assert.equal(day.kind, 'auto');
  if (day.kind === 'auto') {
    assert.equal(day.onex.externalId, 'onex-vip-mal');
  }
}

// Phone-first: local FIO garbage, official 1C FIO on match input → auto.
{
  const visit = new Date('2026-11-09T07:00:00.000Z');
  const b = booking({
    id: 'b-phone-fio',
    startAt: visit,
    // Specialist typed wrong local name; phone→1C filled matchClientName.
    clientExternalId: 'cli-mal-1c',
    clientName: 'Малышев Сергей Михайлович',
    specialistName: 'Бирюкова Екатерина',
    specialistExternalId: '42',
    serviceName: 'Массаж классический 50 мин',
  });
  const s = sale({
    externalId: 'sale-mal-phone',
    occurredAt: visit,
    clientExternalId: 'cli-mal-employee',
    clientName: 'Малышев Сергей Михайлович (Сотрудник)',
    performerExternalId: '42',
    performerName: 'Бирюкова Екатерина',
    productName: 'Массаж классический 50 мин',
    saleAmount: 45,
    paidAmount: 45,
  });
  const r = matchSpaSale({ booking: b, sales: [s] });
  assert.equal(r.kind, 'auto');
}

// Free AllSports биоимпеданс: complimentary 0 BYN → auto when roles match.
{
  const visit = new Date('2026-11-02T13:00:00.000Z');
  const b = booking({
    id: 'b-bio',
    startAt: visit,
    clientExternalId: 'cli-kosova',
    clientName: 'Косова Ольга',
    specialistExternalId: 'emp-abram',
    specialistName: 'Абрамчик Егор',
    serviceName: 'Allsports БИОИМПЕДАНС',
    serviceExternalId: 'bio-1',
  });
  const s = sale({
    externalId: 'sale-33827:u2026-11-02',
    occurredAt: visit,
    saleAmount: 0,
    paidAmount: 0,
    operationType: 'sale',
    productName: 'Allsports БИОИМПЕДАНС',
    productExternalId: 'bio-1',
    clientExternalId: 'cli-kosova',
    clientName: 'Косова Ольга',
    performerExternalId: 'emp-abram',
    performerName: 'Абрамчик Егор',
  });
  const r = matchSpaSale({ booking: b, sales: [s] });
  assert.equal(r.kind, 'auto');
  if (r.kind === 'auto') {
    assert.equal(r.paymentStatus, 'PAID');
  }
}

console.log('spa-document-match.test.ts: ok');
