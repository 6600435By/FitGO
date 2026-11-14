import assert from 'node:assert/strict';
import {
  isPayoutOverTolerance,
  PAYOUT_OVERPAY_TOLERANCE_MINOR,
  resolveSettlementCarryInMinor,
} from './payroll';

{
  assert.equal(PAYOUT_OVERPAY_TOLERANCE_MINOR, 15_00);
  assert.equal(isPayoutOverTolerance(100_00, 115_00), false);
  assert.equal(isPayoutOverTolerance(100_00, 115_01), true);
  assert.equal(isPayoutOverTolerance(100_00, 100_00), false);
  assert.equal(isPayoutOverTolerance(100_00, 90_00), false);
}

{
  // Fresh wave: use live balance.
  assert.equal(
    resolveSettlementCarryInMinor({
      liveBalanceMinor: 970_03,
      existing: null,
      priorSettlementCarryOutMinor: 970_03,
    }),
    970_03,
  );
}

{
  // Amend: use snapshotted carryIn, ignore live balance (would double-count).
  assert.equal(
    resolveSettlementCarryInMinor({
      liveBalanceMinor: 580_00,
      existing: { carryInMinor: 0, carryOutMinor: 580_00 },
      priorSettlementCarryOutMinor: 0,
    }),
    0,
  );
}

{
  // Ghost: snap ≈ carryOut and no prior debt → heal to 0.
  assert.equal(
    resolveSettlementCarryInMinor({
      liveBalanceMinor: 5489_30,
      existing: { carryInMinor: 5491_84, carryOutMinor: 5489_30 },
      priorSettlementCarryOutMinor: 0,
    }),
    0,
  );
  assert.equal(
    resolveSettlementCarryInMinor({
      liveBalanceMinor: 970_04,
      existing: { carryInMinor: 970_03, carryOutMinor: 970_04 },
      priorSettlementCarryOutMinor: null,
    }),
    0,
  );
}

{
  // Real prior debt kept on amend even when carryIn ≈ carryOut.
  assert.equal(
    resolveSettlementCarryInMinor({
      liveBalanceMinor: 970_00,
      existing: { carryInMinor: 970_00, carryOutMinor: 970_00 },
      priorSettlementCarryOutMinor: 970_00,
    }),
    970_00,
  );
}

console.log('payroll-payout-guards: ok');
