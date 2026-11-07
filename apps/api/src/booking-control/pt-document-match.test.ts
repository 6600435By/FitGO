import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canonicalPtDocId,
  expandTakenPtDocIds,
  filterPtSaleCandidates,
  matchPtDocument,
  namesMatch,
  ptDocIdAliases,
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
      [sale, { ...sale, externalId: 'sale-2', amount: 40 }],
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

  it('skips complimentary', () => {
    const r = matchPtDocument(
      { ...booking, isComplimentary: true },
      [sale],
      new Set(),
    );
    assert.equal(r.kind, 'none');
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
});
