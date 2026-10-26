/**
 * Run: cd apps/api && npx ts-node --transpile-only src/analytics/membership-efficiency.helpers.test.ts
 */
import assert from 'node:assert/strict';
import { DEFAULT_MEMBERSHIP_FAMILIES } from './membership-efficiency.defaults';
import {
  allocateRetailPrice,
  breakevenVisits,
  burnedValueMinor,
  buildWaterfall,
  computeCostBreakdown,
  gpCostPerVisit,
  matchFamily,
  matchSaleToMembership,
  parseMonthsFromTitle,
  parseStartFromBasis,
  utilizationIndex,
  utilizationSegment,
  visitDistributionBuckets,
} from './membership-efficiency.helpers';

const vip = DEFAULT_MEMBERSHIP_FAMILIES.find((f) => f.id === 'vip')!;
const ediny = DEFAULT_MEMBERSHIP_FAMILIES.find((f) => f.id === 'ediny')!;

{
  assert.equal(matchFamily('VIP 3 мес', [vip, ediny])?.id, 'vip');
  assert.equal(matchFamily('Единый 6', [vip, ediny])?.id, 'ediny');
  assert.equal(
    matchFamily('Пакет услуг "VIP 1 мес" 123 от 01.01.2026', [vip])?.id,
    'vip',
  );
  assert.equal(matchFamily('Карта посещения (4)', [vip, ediny]), null);
}

{
  assert.equal(parseMonthsFromTitle('VIP 3 мес', 1), 3);
  assert.equal(parseMonthsFromTitle('Единый 12 месяцев', 1), 12);
  assert.equal(parseMonthsFromTitle('VIP', 1), 1);
  assert.equal(parseStartFromBasis('Пакет услуг "VIP" 1 от 27.08.2026'), '2026-08-27');
}

{
  const sales = [
    {
      productName: 'VIP 1 мес',
      paidAmount: 200,
      saleAmount: 200,
      refundAmount: 0,
      occurredAt: new Date('2026-08-26T10:00:00Z'),
      clientExternalId: 'c1',
      clientName: 'Test',
    },
    {
      productName: 'VIP 1 мес',
      paidAmount: 210,
      saleAmount: 210,
      refundAmount: 0,
      occurredAt: new Date('2026-07-01T10:00:00Z'),
      clientExternalId: 'c1',
      clientName: 'Test',
    },
  ];
  const matched = matchSaleToMembership({
    clientExternalId: 'c1',
    family: vip,
    startDate: '2026-08-27',
    sales,
  });
  assert.ok(matched);
  assert.equal(matched!.sale.paidAmount, 200);
  assert.equal(matched!.estimated, false);
}

{
  const alloc = allocateRetailPrice({
    paidMinor: 30000, // 300 BYN
    months: 1,
    family: vip,
    massageRetailMinor: 4000, // 40
    solariumMinuteRetailMinor: 50, // 0.50
    gpVisits: 8,
    gymVisits: 2,
  });
  // PA 16 BYN = 1600; massage 4*40=16000; solarium 60*0.5=3000 → reserved 20600; access 9400
  assert.equal(alloc.personalAccountAllocatedMinor, 1600);
  assert.equal(alloc.massageAllocatedMinor, 16000);
  assert.equal(alloc.solariumAllocatedMinor, 3000);
  assert.equal(alloc.accessMinor, 9400);
  assert.equal(alloc.accessGpMinor + alloc.accessGymMinor, 9400);
  assert.equal(alloc.accessGpMinor, Math.round((9400 * 8) / 10));
}

{
  const cost = computeCostBreakdown({
    trainerMinor: 5000,
    massageUsed: 2,
    massageCostMinor: 1500,
    solariumMinutesUsed: 20,
    solariumMinuteCostMinor: 10,
    personalAccountSpentMinor: 800,
    personalAccountCogsShare: 0.35,
    visitCount: 10,
    overheadPerVisitMinor: 0,
  });
  assert.equal(cost.massageMinor, 3000);
  assert.equal(cost.solariumMinor, 200);
  assert.equal(cost.personalAccountCogsMinor, 280);
  assert.equal(cost.totalMinor, 5000 + 3000 + 200 + 280);
}

{
  assert.equal(gpCostPerVisit(8000, 8), 1000);
  assert.equal(gpCostPerVisit(8000, 0), null);
  assert.equal(breakevenVisits(8000, 1000), 8);
  assert.equal(breakevenVisits(8000, 0), null);
}

{
  const idx = utilizationIndex(8, 1, 2); // ~8 visits / ~4.35 weeks ≈ 1.84/week → index ~0.92
  assert.ok(idx > 0.7 && idx < 1.2);
  assert.equal(
    utilizationSegment(1.5, { max: 1.2, normal: 0.6, under: 0.2 }, null, 21),
    'max',
  );
  assert.equal(
    utilizationSegment(0.1, { max: 1.2, normal: 0.6, under: 0.2 }, 30, 21),
    'sleeping',
  );
}

{
  const burned = burnedValueMinor({
    personalAccountBurnedMinor: 1000,
    massageQuota: 4,
    massageUsed: 1,
    massageRetailMinor: 4000,
    solariumMinutesQuota: 60,
    solariumMinutesUsed: 60,
    solariumMinuteRetailMinor: 50,
  });
  assert.equal(burned, 1000 + 3 * 4000);
}

{
  const wf = buildWaterfall({
    paidMinor: 20000,
    trainerMinor: 5000,
    massageMinor: 2000,
    solariumMinor: 500,
    personalAccountCogsMinor: 300,
    overheadMinor: 0,
  });
  assert.equal(wf[0]!.key, 'paid');
  assert.equal(wf[wf.length - 1]!.key, 'margin');
  assert.equal(wf[wf.length - 1]!.runningMinor, 20000 - 5000 - 2000 - 500 - 300);
}

{
  const buckets = visitDistributionBuckets([0, 0, 3, 6, 10, 15]);
  assert.equal(buckets.find((b) => b.key === '0')!.count, 2);
  assert.equal(buckets.find((b) => b.key === '13+')!.count, 1);
}

console.log('membership-efficiency.helpers.test.ts: ok');
