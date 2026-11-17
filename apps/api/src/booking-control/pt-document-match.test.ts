import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildPtDayMergePairs,
  canonicalPtDocId,
  expandTakenPtDocIds,
  filterPtSaleCandidates,
  matchPtDocument,
  matchPtVisitByDay,
  namesMatch,
  pairPtSalesToBookings,
  ptDocIdAliases,
  ptSaleLineNumber,
  saleTakenByOther,
} from './pt-document-match';

describe('pt-document-match', () => {
  const booking = {
    id: 'b1',
    startAt: new Date('2026-11-06T10:00:00.000Z'),
    clientExternalId: 'cli-1',
    clientName: 'Иванов Иван',
    trainerEmployeeCode: 'T42',
    trainerName: 'Петров Пётр',
  };

  const sale = {
    externalId: 'sale-1',
    occurredAt: new Date('2026-11-06T12:00:00.000Z'),
    clientName: 'Иванов И.',
    employeeCode: 'T42',
    employeeName: 'Петров П.',
    amount: 50,
    docRef: '0000123#1',
    serviceName: 'Персональная тренировка',
  };

  it('namesMatch tolerates short forms', () => {
    assert.equal(namesMatch('Иванов Иван', 'Иванов И.'), true);
    assert.equal(namesMatch('Иванов', 'Петров'), false);
  });

  it('auto when exactly one free candidate', () => {
    const r = matchPtDocument(booking, [sale], new Set());
    assert.equal(r.kind, 'auto');
    if (r.kind === 'auto') assert.equal(r.sale.externalId, 'sale-1');
  });

  it('ambiguous when two candidates', () => {
    const r = matchPtDocument(
      booking,
      [sale, { ...sale, externalId: 'sale-2', amount: 40, docRef: '0000124#1' }],
      new Set(),
    );
    assert.equal(r.kind, 'ambiguous');
  });

  it('skips taken docs', () => {
    const hits = filterPtSaleCandidates(
      booking,
      [sale],
      new Set(['sale-1']),
    );
    assert.equal(hits.length, 0);
  });

  it('skips complimentary cash sales', () => {
    const r = matchPtDocument(
      { ...booking, isComplimentary: true },
      [sale],
      new Set(),
    );
    assert.equal(r.kind, 'none');
  });

  it('skips multi-visit pack sale titles', () => {
    const pack = {
      ...sale,
      externalId: 'pack-1',
      serviceName: '10 ПТ',
    };
    const r = matchPtDocument(booking, [pack], new Set());
    assert.equal(r.kind, 'none');
  });

  it('prefers same-day sale over wider window', () => {
    const far = {
      ...sale,
      externalId: 'far',
      occurredAt: new Date('2026-11-12T10:00:00.000Z'),
      docRef: '0000999#1',
    };
    const r = matchPtDocument(booking, [far, sale], new Set());
    assert.equal(r.kind, 'auto');
    if (r.kind === 'auto') assert.equal(r.sale.externalId, 'sale-1');
  });

  it('canonicalPtDocId prefers externalId over docRef', () => {
    assert.equal(canonicalPtDocId(sale), 'sale-1');
    assert.equal(
      canonicalPtDocId({ docRef: '0000123#1' }),
      '0000123#1',
    );
  });

  it('expandTakenPtDocIds blocks both aliases of one sale', () => {
    const taken = expandTakenPtDocIds(['0000123#1'], [sale]);
    assert.equal(taken.has('0000123#1'), true);
    assert.equal(taken.has('sale-1'), true);
    assert.equal(saleTakenByOther(sale, taken), true);
    const hits = filterPtSaleCandidates(booking, [sale], taken);
    assert.equal(hits.length, 0);
  });

  it('ptDocIdAliases lists both forms once', () => {
    assert.deepEqual(ptDocIdAliases(sale), ['sale-1', '0000123#1']);
    assert.deepEqual(ptDocIdAliases({ externalId: 'x', docRef: 'x' }), ['x']);
  });

  it('pairPtSalesToBookings pairs by time and line number', () => {
    const pairs = pairPtSalesToBookings({
      bookings: [
        { id: 'late', startAt: new Date('2026-11-06T14:00:00.000Z') },
        { id: 'early', startAt: new Date('2026-11-06T10:00:00.000Z') },
      ],
      sales: [
        { ...sale, externalId: 'l2', docRef: '0000123#2' },
        { ...sale, externalId: 'l1', docRef: '0000123#1' },
      ],
    });
    assert.ok(pairs);
    assert.equal(pairs![0]!.bookingId, 'early');
    assert.equal(ptSaleLineNumber(pairs![0]!.sale), 1);
    assert.equal(pairs![1]!.bookingId, 'late');
    assert.equal(ptSaleLineNumber(pairs![1]!.sale), 2);
  });

  it('pairPtSalesToBookings refuses unequal counts', () => {
    assert.equal(
      pairPtSalesToBookings({
        bookings: [booking],
        sales: [
          sale,
          { ...sale, externalId: 'sale-2', docRef: '0000123#2' },
        ],
      }),
      null,
    );
  });

  it('matchPtVisitByDay auto when one visit same day', () => {
    const r = matchPtVisitByDay({
      booking,
      visits: [
        {
          externalId: 'onex-1',
          startAt: new Date('2026-11-06T18:00:00.000Z'),
          employeeExternalId: 'T42',
          clientExternalId: 'cli-1',
          clientName: 'Иванов Иван',
        },
      ],
    });
    assert.equal(r.kind, 'auto');
  });

  it('matchPtVisitByDay ambiguous when two visits', () => {
    const r = matchPtVisitByDay({
      booking,
      visits: [
        {
          externalId: 'onex-1',
          startAt: new Date('2026-11-06T10:00:00.000Z'),
          employeeExternalId: 'T42',
          clientExternalId: 'cli-1',
        },
        {
          externalId: 'onex-2',
          startAt: new Date('2026-11-06T16:00:00.000Z'),
          employeeExternalId: 'T42',
          clientExternalId: 'cli-1',
        },
      ],
    });
    assert.equal(r.kind, 'ambiguous');
  });

  it('buildPtDayMergePairs links unique visit', () => {
    const pairs = buildPtDayMergePairs({
      bookings: [booking],
      visits: [
        {
          externalId: 'onex-1',
          startAt: new Date('2026-11-06T11:00:00.000Z'),
          employeeExternalId: 'T42',
          clientExternalId: 'cli-1',
        },
      ],
    });
    assert.deepEqual(pairs, [
      { bookingId: 'b1', visitExternalId: 'onex-1' },
    ]);
  });
});
