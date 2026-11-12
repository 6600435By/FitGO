/**
 * Run: cd apps/api && npx ts-node --transpile-only src/club-sync/trainer-pt-sales-sync.util.test.ts
 */
import assert from 'node:assert/strict';
import {
  shouldSoftDeactivateTrainerPtSales,
  splitYmdRangeInclusive,
} from './trainer-pt-sales-sync.util';

assert.equal(
  shouldSoftDeactivateTrainerPtSales({ seenCount: 0, existingActiveCount: 40 }),
  false,
  'empty pull must not wipe cache',
);
assert.equal(
  shouldSoftDeactivateTrainerPtSales({ seenCount: 0, existingActiveCount: 0 }),
  false,
  'empty period stays without deactivate',
);
assert.equal(
  shouldSoftDeactivateTrainerPtSales({
    seenCount: 10,
    existingActiveCount: 40,
  }),
  false,
  'truncated pull (<50%) must not wipe',
);
assert.equal(
  shouldSoftDeactivateTrainerPtSales({
    seenCount: 30,
    existingActiveCount: 40,
  }),
  true,
  'complete-enough pull may deactivate missing keys',
);
assert.equal(
  shouldSoftDeactivateTrainerPtSales({ seenCount: 2, existingActiveCount: 3 }),
  true,
  'small windows still deactivate when pull is non-empty',
);

assert.deepEqual(splitYmdRangeInclusive('2026-10-01', '2026-10-01', 5), [
  { from: '2026-10-01', to: '2026-10-01' },
]);
assert.deepEqual(splitYmdRangeInclusive('2026-10-01', '2026-10-12', 5), [
  { from: '2026-10-01', to: '2026-10-05' },
  { from: '2026-10-06', to: '2026-10-10' },
  { from: '2026-10-11', to: '2026-10-12' },
]);
assert.deepEqual(splitYmdRangeInclusive('2026-11-01', '2026-10-01', 5), []);

console.log('trainer-pt-sales-sync.util.test.ts: ok');
