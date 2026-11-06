import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  filterPtSaleCandidates,
  matchPtDocument,
  namesMatch,
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
});
