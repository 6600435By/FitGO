/**
 * Run: cd apps/api && npx ts-node --transpile-only -r tsconfig-paths/register src/payroll/advance-wave.test.ts
 */
import assert from 'node:assert/strict';
import {
  payProfileForAdvanceHalf,
  splitAdvanceWave,
  trainerPayFlags,
  type StaffPayProfile,
} from '@fitgo/shared-types';

{
  const a = splitAdvanceWave({ accrualMinor: 100_000, cardAdvanceMinor: 10_000 });
  assert.equal(a.earnedMinor, 100_000);
  assert.equal(a.cardMinor, 10_000);
  assert.equal(a.cashMinor, 90_000);
}

{
  // Accrual below card → pay the card amount, cash 0 (not card + accrual).
  const b = splitAdvanceWave({ accrualMinor: 50_000, cardAdvanceMinor: 100_000 });
  assert.equal(b.earnedMinor, 100_000);
  assert.equal(b.cardMinor, 100_000);
  assert.equal(b.cashMinor, 0);
}

{
  const c = splitAdvanceWave({ accrualMinor: 150_000, cardAdvanceMinor: 10_000 });
  assert.equal(c.earnedMinor, 150_000);
  assert.equal(c.cardMinor, 10_000);
  assert.equal(c.cashMinor, 140_000);
}

{
  const d = splitAdvanceWave({ accrualMinor: 0, cardAdvanceMinor: 0 });
  assert.equal(d.earnedMinor, 0);
  assert.equal(d.cardMinor, 0);
  assert.equal(d.cashMinor, 0);
}

{
  // Admin settlement: earned full month, prior paid advance subtracts from total.
  const monthEarned = 500_000;
  const priorPaidAdvance = 100_000; // confirmed ADVANCE_HALF.totalMinor
  const totalMinor = Math.max(0, monthEarned - priorPaidAdvance);
  assert.equal(totalMinor, 400_000);
}

{
  const flags = trainerPayFlags({
    roles: ['TRAINER'],
    groupPrograms: true,
    trainerStaff: true,
    trainerReformers: true,
    trainerGroupsSet: true,
  });
  const profile: StaffPayProfile = {
    track: 'GROUP_TRAINER',
    groupSessionRateMinor: 2000,
    fixedAdvanceMinor: 15_000,
    byTrack: {
      GROUP_TRAINER: {
        track: 'GROUP_TRAINER',
        groupSessionRateMinor: 2000,
        fixedAdvanceMinor: 15_000,
      },
      PT: {
        track: 'PT',
        ptPercentTiers: [{ minSessions: 0, percent: 50 }],
        fixedAdvanceMinor: 15_000,
      },
      REFORMER: {
        track: 'REFORMER',
        reformerPersonalPercent: 40,
        fixedAdvanceMinor: 15_000,
      },
    },
  };
  const advance = payProfileForAdvanceHalf(profile, flags);
  assert.ok(advance);
  const tracks = Object.keys(advance!.byTrack ?? {});
  assert.ok(tracks.includes('GROUP_TRAINER'));
  assert.equal(tracks.includes('REFORMER'), false);
  assert.equal(tracks.includes('PT'), false);
}

console.log('advance-wave.test.ts: ok');
