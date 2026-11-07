/**
 * Run: cd apps/api && npx ts-node --transpile-only src/personal-training/schedule-hold.rules.test.ts
 */
import assert from 'node:assert/strict';
import {
  HOLD_WARN_BEFORE_MS,
  expiredHoldWhere,
  isHoldExpired,
  isHoldInWarnWindow,
} from './schedule-hold.rules';

const now = new Date('2026-11-07T12:00:00.000Z');

assert.equal(isHoldExpired(null, now), false);
assert.equal(isHoldExpired(new Date('2026-11-07T11:59:00.000Z'), now), true);
assert.equal(isHoldExpired(new Date('2026-11-07T12:00:00.000Z'), now), true);
assert.equal(isHoldExpired(new Date('2026-11-07T12:01:00.000Z'), now), false);

assert.equal(
  isHoldInWarnWindow({
    holdExpiresAt: new Date(now.getTime() + 30 * 60_000),
    holdExpiryWarnedAt: null,
    now,
  }),
  true,
);
assert.equal(
  isHoldInWarnWindow({
    holdExpiresAt: new Date(now.getTime() + HOLD_WARN_BEFORE_MS + 60_000),
    holdExpiryWarnedAt: null,
    now,
  }),
  false,
);
assert.equal(
  isHoldInWarnWindow({
    holdExpiresAt: new Date(now.getTime() + 30 * 60_000),
    holdExpiryWarnedAt: new Date(now.getTime() - 60_000),
    now,
  }),
  false,
  'already warned',
);
assert.equal(
  isHoldInWarnWindow({
    holdExpiresAt: new Date(now.getTime() - 60_000),
    holdExpiryWarnedAt: null,
    now,
  }),
  false,
  'already expired → release path, not warn',
);

{
  const where = expiredHoldWhere(now);
  assert.equal(where.kind, 'HOLD_CLIENT'); // AvailabilityBlockKind.HOLD_CLIENT
  assert.equal(where.holdExpiresAt.lte.getTime(), now.getTime());
}

console.log('schedule-hold.rules.test.ts: ok');
