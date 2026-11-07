/**
 * Run: cd apps/api && npx ts-node --transpile-only src/trainer/pt-flow.util.test.ts
 */
import assert from 'node:assert/strict';
import {
  canChoosePtFlow,
  isPersonalPtBooking,
  resolvePtFlow,
} from './pt-flow.util';

assert.equal(
  resolvePtFlow({ trainerClub: true, trainerStaff: false }),
  'PERSONAL',
);
assert.equal(
  resolvePtFlow({ trainerClub: false, trainerStaff: true }),
  'CLUB',
);
{
  const dual = { trainerClub: true, trainerStaff: true };
  assert.equal(resolvePtFlow(dual), 'CLUB');
  assert.equal(resolvePtFlow(dual, 'PERSONAL'), 'PERSONAL');
  assert.equal(canChoosePtFlow(dual), true);
}
assert.equal(
  isPersonalPtBooking(
    { ptFlow: null },
    { trainerClub: true, trainerStaff: false },
  ),
  true,
);
assert.equal(
  isPersonalPtBooking(
    { ptFlow: null },
    { trainerClub: true, trainerStaff: true },
  ),
  false,
);

console.log('pt-flow.util.test.ts: ok');
