/**
 * Run: cd apps/api && npx ts-node --transpile-only -r tsconfig-paths/register src/analytics/analytics-money.test.ts
 */
import assert from 'node:assert/strict';
import type { PayrollSegmentSets } from '../admin-sales/admin-sales-segments';
import {
  ANALYTICS_SEG_LABEL,
  aggregateAnalyticsMoney,
  classifyAnalyticsSegment,
  type AnalyticsCreRow,
} from './analytics-money';

function emptySets(
  override: Partial<Record<keyof PayrollSegmentSets, string[]>> = {},
): PayrollSegmentSets {
  const mk = (xs: string[] = []) => new Set(xs.map((s) => s.toLowerCase()));
  return {
    membership: mk(override.membership),
    spa: mk(override.spa),
    shop: mk(override.shop),
    solarium: mk(override.solarium),
    training: mk(override.training),
    reformerPersonal: mk(override.reformerPersonal),
    reformerGroup: mk(override.reformerGroup),
  };
}

{
  const segs = emptySets({
    membership: ['групповоезанятиереформер'],
    training: ['индивидуальноезанятиереформер10'],
    reformerGroup: ['uuid-group'],
    reformerPersonal: ['uuid-personal'],
  });
  assert.equal(
    classifyAnalyticsSegment(
      'membership',
      'Групповое занятие реформер',
      null,
      segs,
    ),
    'reformers',
  );
  assert.equal(
    classifyAnalyticsSegment(
      'training',
      'Индивидуальное занятие реформер 10',
      null,
      segs,
    ),
    'reformers',
  );
  assert.equal(
    classifyAnalyticsSegment('shop', 'Пакет реформер', 'uuid-group', segs),
    'reformers',
  );
}

{
  const segs = emptySets({
    membership: ['безлимит1месяц'],
    training: ['занятиестренером'],
  });
  assert.equal(
    classifyAnalyticsSegment(null, 'Безлимит 1 месяц', null, segs),
    'membership',
  );
  assert.equal(
    classifyAnalyticsSegment('training', 'Занятие с тренером', null, segs),
    'training',
  );
}

{
  const baseReceipt = (
    partial: Partial<AnalyticsCreRow>,
  ): AnalyticsCreRow => ({
    externalId: 'e1',
    documentId: 'd1',
    operationType: 'payment',
    occurredAt: new Date('2026-10-15T12:00:00+03:00'),
    paidAt: new Date('2026-10-15T12:00:00+03:00'),
    amount: 100,
    cash: 100,
    card: 0,
    cashless: 0,
    personalAccount: 0,
    refundAmount: 0,
    paidAmount: 100,
    saleType: null,
    productName: 'Товар',
    productExternalId: null,
    clientName: 'Клиент',
    clientExternalId: 'c1',
    employeeExternalId: null,
    employeeName: null,
    performerExternalId: null,
    performerName: null,
    ...partial,
  });

  const segs = emptySets({ shop: ['вода'] });
  const result = aggregateAnalyticsMoney({
    from: '2026-10-01',
    to: '2026-10-31',
    receipts: [
      baseReceipt({
        productName: 'Вода',
        cash: 50,
        amount: 50,
        paidAmount: 50,
      }),
    ],
    manuals: [
      {
        kind: 'corpo',
        amountMinor: 99900,
        entryDate: new Date('2026-10-10T00:00:00+03:00'),
      },
    ],
    payrollCorporateMinor: 1_000_000,
    payrollSegs: segs,
  });
  assert.equal(result.byPayment.corpoMinor, 1_000_000);
  const corp = result.bySegment.find((s) => s.key === 'corporate');
  assert.ok(corp);
  assert.equal(corp!.amountMinor, 1_000_000);
  assert.equal(ANALYTICS_SEG_LABEL.reformers, 'Реформеры');

  const filtered = aggregateAnalyticsMoney({
    from: '2026-10-01',
    to: '2026-10-31',
    receipts: [],
    manuals: [],
    payrollCorporateMinor: 500_000,
    payrollSegs: emptySets(),
    filters: { employee: 'emp-1' },
  });
  assert.equal(filtered.byPayment.corpoMinor, 0);
}

console.log('analytics-money.test.ts: ok');
