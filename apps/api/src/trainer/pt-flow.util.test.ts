/**
 * Run: cd apps/api && npx ts-node --transpile-only src/trainer/pt-flow.util.test.ts
 */
import assert from 'node:assert/strict';
import {
  canChoosePtFlow,
  canClubTrainerDeletePtBooking,
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

assert.equal(
  canClubTrainerDeletePtBooking({
    trainerId: 't1',
    trainerClub: true,
    origin: 'TRAINER_ASSIGNED',
  }),
  true,
);
assert.equal(
  canClubTrainerDeletePtBooking({
    trainerId: 't1',
    trainerClub: true,
    origin: 'CLIENT_BOOKED',
    status: 'CONFIRMED',
    endAt: new Date(Date.now() + 3600_000),
  }),
  false,
);
assert.equal(
  canClubTrainerDeletePtBooking({
    trainerId: 't1',
    trainerClub: true,
    origin: 'CLIENT_BOOKED',
    usageStatus: 'NO_SHOW',
  }),
  true,
);
assert.equal(
  canClubTrainerDeletePtBooking({
    trainerId: 't1',
    trainerClub: true,
    origin: 'TRAINER_ASSIGNED',
    linkedDocExternalId: 'doc-1',
  }),
  false,
);

console.log('pt-flow.util.test.ts: ok');
