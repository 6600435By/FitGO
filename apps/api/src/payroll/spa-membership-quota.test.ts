/**
 * VIP SPA membership quota must pay spaQuotaRates even when 1C attached a unit price.
 * Run: npx ts-node --transpile-only apps/api/src/payroll/spa-membership-quota.test.ts
 */
import {
  isSpaVipMembershipQuota,
  resolveSpaSessionEarnMinor,
} from './spa-membership-quota';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(
  isSpaVipMembershipQuota({
    writeOffOrigin: 'MEMBERSHIP',
    sessionTitle: 'Массаж классический общий',
    payment: 'QUOTA',
  }),
  'MEMBERSHIP origin is VIP quota',
);

assert(
  isSpaVipMembershipQuota({
    writeOffOrigin: 'UNKNOWN',
    sessionTitle: 'Массаж классический общий',
    payment: 'QUOTA',
  }),
  'known VIP SPA line + QUOTA is VIP quota',
);

assert(
  !isSpaVipMembershipQuota({
    writeOffOrigin: 'BLOCK',
    sessionTitle: 'Массаж классический общий',
    payment: 'QUOTA',
    isServiceBlock: true,
  }),
  'massage block is not VIP quota',
);

assert(
  !isSpaVipMembershipQuota({
    writeOffOrigin: 'UNKNOWN',
    sessionTitle: 'Расслабляющий массаж 80 мин',
    payment: 'QUOTA',
  }),
  'timed retail massage is not VIP quota',
);

const vipWithCatalogPrice = resolveSpaSessionEarnMinor({
  spaMembershipQuota: true,
  priceMinor: 6500,
  title: 'Массаж классический общий (абонемент)',
  spaSoldPercent: 50,
  spaQuotaRates: [{ serviceKey: 'CLASSIC_MASSAGE', rateMinor: 2000 }],
});
assert(
  vipWithCatalogPrice.earnMinor === 2000 &&
    vipWithCatalogPrice.ratePercent == null,
  `VIP with catalog unit must pay 20 BYN fix, got ${JSON.stringify(vipWithCatalogPrice)}`,
);

const blockPct = resolveSpaSessionEarnMinor({
  spaMembershipQuota: false,
  priceMinor: 14000,
  title: 'Расслабляющий массаж 80 мин (блок)',
  spaSoldPercent: 50,
  spaQuotaRates: [{ serviceKey: 'CLASSIC_MASSAGE', rateMinor: 2000 }],
});
assert(
  blockPct.earnMinor === 7000 && blockPct.ratePercent === 50,
  `block keeps %, got ${JSON.stringify(blockPct)}`,
);

console.log('spa-membership-quota.test.ts: ok');
