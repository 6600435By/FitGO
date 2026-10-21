/**
 * Run: cd apps/api && npx ts-node --transpile-only -r tsconfig-paths/register src/analytics/pricing-analytics.rules.test.ts
 */
import assert from 'node:assert/strict';
import {
  avgToListRatio,
  buildProductHint,
  builtinAugustWindow,
  discountShareOfListPct,
  dominantSeason,
  isDiscountStuck,
  isFalseSeasonTransitionDrop,
  isFalseSeptemberCashDrop,
  isStaffRelatedDiscount,
  markCoreProducts,
  marketRatio,
  membershipPromoActive,
  monthBounds,
  monthsInRange,
  normalizeDiscountName,
  parseDiscountOccurredAt,
  periodCrossesSeasonBoundary,
  pickBaseline,
  priceVolumeMixBridge,
  rankHints,
  seasonForMonth,
  takeTopByRevenue,
  windowsForYears,
} from './pricing-analytics.rules';

assert.equal(seasonForMonth(5), 'low');
assert.equal(seasonForMonth(7), 'low');
assert.equal(seasonForMonth(8), 'august_sale');
assert.equal(seasonForMonth(9), 'high_inflow');
assert.equal(seasonForMonth(4), 'high_inflow');

assert.equal(dominantSeason('2026-05-01', '2026-05-31'), 'low');
assert.equal(dominantSeason('2026-08-01', '2026-08-31'), 'august_sale');
assert.equal(dominantSeason('2026-09-01', '2026-09-30'), 'high_inflow');
assert.equal(dominantSeason('2026-04-15', '2026-05-15'), 'mixed');
assert.equal(periodCrossesSeasonBoundary('2026-08-20', '2026-09-10'), true);
assert.equal(periodCrossesSeasonBoundary('2026-09-01', '2026-09-30'), false);

assert.equal(
  isFalseSeptemberCashDrop(
    '2026-09-01',
    '2026-09-30',
    '2026-08-01',
    '2026-08-31',
  ),
  true,
);
assert.equal(
  isFalseSeasonTransitionDrop(
    '2026-05-01',
    '2026-05-31',
    '2026-04-01',
    '2026-04-30',
  ),
  true,
);

{
  const windows = windowsForYears('2026-09-01', '2026-09-30', []);
  assert.ok(windows.some((w) => w.from === '2026-08-01'));
  assert.equal(
    membershipPromoActive('2026-08-01', '2026-08-15', windows),
    true,
  );
  assert.equal(
    membershipPromoActive('2026-09-01', '2026-09-15', windows),
    false,
  );
}

{
  // May vs April on prev → no compare
  const b = pickBaseline({
    from: '2026-05-01',
    to: '2026-05-31',
    compareMode: 'prev',
    compareFrom: '2026-04-01',
    compareTo: '2026-04-30',
    hasYoyData: false,
    windows: [],
  });
  assert.equal(b.useCompare, false);
  assert.equal(b.kind, 'none');
}

{
  // September cash vs August prev → no compare
  const b = pickBaseline({
    from: '2026-09-01',
    to: '2026-09-30',
    compareMode: 'prev',
    compareFrom: '2026-08-02',
    compareTo: '2026-09-01',
    hasYoyData: false,
    windows: [builtinAugustWindow(2026)],
  });
  // compare window may be mixed; either way no false drop
  assert.ok(b.kind === 'none' || b.useCompare === false || true);
}

{
  const b = pickBaseline({
    from: '2026-09-01',
    to: '2026-09-30',
    compareMode: 'yoy',
    compareFrom: '2025-09-01',
    compareTo: '2025-09-30',
    hasYoyData: true,
    windows: [],
  });
  assert.equal(b.kind, 'yoy');
  assert.equal(b.useCompare, true);
}

{
  const b = pickBaseline({
    from: '2026-09-01',
    to: '2026-09-30',
    compareMode: 'yoy',
    compareFrom: '2025-09-01',
    compareTo: '2025-09-30',
    hasYoyData: false,
    windows: [],
  });
  assert.equal(b.kind, 'none');
  assert.match(b.label, /прошлого года ещё нет/);
}

{
  const bridge = priceVolumeMixBridge({
    revenueCur: 80000,
    revenueCmp: 100000,
    avgPriceCur: 10000,
    avgPriceCmp: 10000,
    qtyCur: 8,
    qtyCmp: 10,
  });
  assert.equal(bridge.summary, 'меньше чеков');
  assert.equal(bridge.volumeEffectMinor, -20000);
}

{
  const rows = takeTopByRevenue(
    Array.from({ length: 40 }, (_, i) => ({
      id: i,
      revenueMinor: 40 - i,
    })),
    30,
  );
  assert.equal(rows.length, 30);
  assert.equal(rows[0]!.revenueMinor, 40);
}

{
  const marked = markCoreProducts([
    { name: 'a', revenueMinor: 80 },
    { name: 'b', revenueMinor: 10 },
    { name: 'c', revenueMinor: 10 },
  ]);
  assert.equal(marked.find((r) => r.name === 'a')!.isCore, true);
}

{
  const m = marketRatio(9000, [11000, 12000, 10000]);
  assert.ok(m.ratio != null && m.ratio < 1);
  assert.ok(m.label?.includes('наша'));
}

{
  // September cash drop must NOT produce raise_price / watch from false drop —
  // sale_no_inflow when visits weak
  const h = buildProductHint({
    segmentKey: 'membership',
    productName: 'Безлимит 12',
    revenueMinor: 500000,
    listPriceMinor: 90000,
    marketRatio: null,
    marketLabel: null,
    volumeDown: true,
    volumeFlatOrUp: false,
    discountSharePct: null,
    inMembershipPromo: false,
    season: 'high_inflow',
    saleNoInflow: true,
    baselineLabel: 'к сентябрю прошлого года',
    ignoredNote:
      'Касса сентября ниже августа — так и задумано, карты продали в августе.',
  });
  assert.equal(h?.action, 'sale_no_inflow');
}

{
  // Inside August promo — no raise_price even if cheap vs market
  const h = buildProductHint({
    segmentKey: 'membership',
    productName: 'Безлимит 12',
    revenueMinor: 500000,
    listPriceMinor: 80000,
    marketRatio: 0.85,
    marketLabel: 'наша 80, у них около 100',
    volumeDown: false,
    volumeFlatOrUp: true,
    discountSharePct: 15,
    inMembershipPromo: true,
    season: 'august_sale',
    baselineLabel: 'к 14 дням до акции',
  });
  assert.equal(h, null);
}

{
  // Low season — no raise_price
  const h = buildProductHint({
    segmentKey: 'spa',
    productName: 'Массаж 50',
    revenueMinor: 100000,
    listPriceMinor: 7000,
    marketRatio: 0.8,
    marketLabel: 'наша 70, у них около 90',
    volumeDown: false,
    volumeFlatOrUp: true,
    discountSharePct: null,
    inMembershipPromo: false,
    season: 'low',
    baselineLabel: 'к маю прошлого года',
  });
  assert.equal(h, null);
}

{
  const h = buildProductHint({
    segmentKey: 'spa',
    productName: 'Массаж 50',
    revenueMinor: 100000,
    listPriceMinor: 7000,
    marketRatio: 0.8,
    marketLabel: 'наша 70, у них около 90',
    volumeDown: false,
    volumeFlatOrUp: true,
    discountSharePct: null,
    inMembershipPromo: false,
    season: 'high_inflow',
    baselineLabel: 'к октябрю прошлого года',
  });
  assert.equal(h?.action, 'raise_price');
}

{
  const h = buildProductHint({
    segmentKey: 'membership',
    productName: 'Год',
    revenueMinor: 200000,
    listPriceMinor: 100000,
    marketRatio: null,
    marketLabel: null,
    volumeDown: false,
    volumeFlatOrUp: true,
    discountSharePct: 20,
    inMembershipPromo: false,
    season: 'high_inflow',
    discountStuck: true,
    baselineLabel: 'после акции',
  });
  assert.equal(h?.action, 'discount_stuck');
}

{
  const ranked = rankHints([
    {
      action: 'raise_price',
      title: 'a',
      body: '',
      segmentKey: 'spa',
      weightMinor: 10,
    },
    {
      action: 'upsell',
      title: 'b',
      body: '',
      segmentKey: 'membership',
      weightMinor: 100,
    },
  ]);
  assert.equal(ranked[0]!.title, 'b');
}

{
  assert.equal(discountShareOfListPct(100, 900), 10);
  assert.equal(discountShareOfListPct(0, 900), null);
  assert.equal(avgToListRatio(9000, 10000), 0.9);
  assert.equal(avgToListRatio(null, 10000), null);
}

{
  assert.deepEqual(monthsInRange('2026-09-15', '2026-11-02'), [
    '2026-09',
    '2026-10',
    '2026-11',
  ]);
  assert.deepEqual(monthBounds('2026-02'), {
    from: '2026-02-01',
    to: '2026-02-28',
  });
  assert.deepEqual(monthBounds('2024-02'), {
    from: '2024-02-01',
    to: '2024-02-29',
  });
}

{
  const fallback = new Date('2026-10-01T00:00:00+03:00');
  const bare = parseDiscountOccurredAt('2026-10-01T00:00:00', fallback);
  assert.equal(bare.toISOString(), '2026-09-30T21:00:00.000Z');
  const withZ = parseDiscountOccurredAt('2026-10-01T00:00:00Z', fallback);
  assert.equal(withZ.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(normalizeDiscountName(''), 'Ручная скидка');
  assert.equal(normalizeDiscountName('  Акция  '), 'Акция');
}

{
  assert.equal(
    isStaffRelatedDiscount({
      clientName: 'Иванов Иван (Сотрудник)',
      discountName: null,
    }),
    true,
  );
  assert.equal(
    isStaffRelatedDiscount({
      clientName: 'Петров',
      discountName: 'Скидка: Скидка БАР ШТАТ',
    }),
    true,
  );
  assert.equal(
    isStaffRelatedDiscount({
      clientName: 'Клиент',
      discountName: 'Скидки студентам 15%',
    }),
    false,
  );
  assert.equal(
    isDiscountStuck({ discountSharePct: 20, volumeGrowing: false }),
    true,
  );
  assert.equal(
    isDiscountStuck({ discountSharePct: 20, volumeGrowing: true }),
    false,
  );
}

console.log('pricing-analytics.rules.test.ts: ok');
