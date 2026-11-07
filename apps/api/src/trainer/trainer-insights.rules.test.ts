/**
 * Run: cd apps/api && npx ts-node --transpile-only src/trainer/trainer-insights.rules.test.ts
 */
import assert from 'node:assert/strict';
import {
  daysUntilYmd,
  hasWorkoutPlan,
  matchesClientGhosting,
  matchesControlPendingOverdue,
  matchesGoalDeadline,
  matchesHoldSlotFreed,
  matchesPackageExpiring,
  matchesVisitFrequencyDrop,
  parseGoalDeadlineYmd,
  rangesOverlap,
} from './trainer-insights.rules';

const now = new Date('2026-11-07T12:00:00');

{
  assert.equal(parseGoalDeadlineYmd('2026-11-15'), '2026-11-15');
  assert.equal(parseGoalDeadlineYmd('к 15.11.26'), '2026-11-15');
  assert.equal(parseGoalDeadlineYmd('до 01.12.2026'), '2026-12-01');
  assert.equal(parseGoalDeadlineYmd('без даты'), null);
}

{
  assert.equal(daysUntilYmd('2026-11-07', now), 0);
  assert.equal(daysUntilYmd('2026-11-14', now), 7);
  assert.equal(daysUntilYmd('2026-10-24', now), -14);
}

assert.equal(
  matchesPackageExpiring({ sessionsRemaining: 2, now }),
  true,
);
assert.equal(
  matchesPackageExpiring({
    sessionsRemaining: 5,
    membershipValidUntil: '2026-11-10',
    now,
  }),
  true,
);
assert.equal(
  matchesPackageExpiring({
    sessionsRemaining: 5,
    membershipValidUntil: '2026-12-01',
    now,
  }),
  false,
);

assert.equal(
  matchesClientGhosting({ lastVisitYmd: '2026-10-24', now }),
  true,
);
assert.equal(
  matchesClientGhosting({ lastVisitYmd: '2026-11-01', now }),
  false,
);

assert.equal(
  matchesGoalDeadline({ target: '2026-11-15', now }),
  true,
);
assert.equal(
  matchesGoalDeadline({ target: '15.11.26', now }),
  true,
);
assert.equal(
  matchesGoalDeadline({ target: '2026-12-30', now }),
  false,
);
assert.equal(
  matchesGoalDeadline({ target: '2026-10-01', now }),
  false,
);

assert.equal(
  matchesVisitFrequencyDrop({
    prior28dCount: 4,
    recent14dCount: 0,
    lastVisitYmd: '2026-11-01',
    now,
  }),
  true,
);
assert.equal(
  matchesVisitFrequencyDrop({
    prior28dCount: 4,
    recent14dCount: 2,
    lastVisitYmd: '2026-11-05',
    now,
  }),
  false,
);
assert.equal(
  matchesVisitFrequencyDrop({
    prior28dCount: 4,
    recent14dCount: 0,
    lastVisitYmd: '2026-10-20',
    now,
  }),
  false,
  'ghosting already covers 14+ days away',
);

{
  const holdStart = new Date('2026-11-10T10:00:00');
  const holdEnd = new Date('2026-11-10T11:00:00');
  const cancelledStart = new Date('2026-11-10T10:30:00');
  const cancelledEnd = new Date('2026-11-10T11:30:00');
  assert.equal(
    matchesHoldSlotFreed({
      cancelledStart,
      cancelledEnd,
      holdStart,
      holdEnd,
      holdExpiresAt: new Date('2026-11-11T12:00:00'),
      now,
    }),
    true,
  );
  assert.equal(
    matchesHoldSlotFreed({
      cancelledStart: new Date('2026-11-10T12:00:00'),
      cancelledEnd: new Date('2026-11-10T13:00:00'),
      holdStart,
      holdEnd,
      holdExpiresAt: new Date('2026-11-11T12:00:00'),
      now,
    }),
    false,
  );
  assert.equal(
    matchesHoldSlotFreed({
      cancelledStart,
      cancelledEnd,
      holdStart,
      holdEnd,
      holdExpiresAt: new Date('2026-11-01T12:00:00'),
      now,
    }),
    false,
    'expired hold is not offered',
  );
}

assert.equal(
  rangesOverlap(
    new Date('2026-11-10T10:00:00'),
    new Date('2026-11-10T11:00:00'),
    new Date('2026-11-10T10:59:00'),
    new Date('2026-11-10T12:00:00'),
  ),
  true,
);

assert.equal(hasWorkoutPlan({ strength: { exercises: [{ name: 'Squat' }] } }), true);
assert.equal(hasWorkoutPlan({ strength: { exercises: [] } }), false);

assert.equal(
  matchesControlPendingOverdue({
    sessionStartAt: new Date('2026-11-04T10:00:00'),
    performerConfirmed: true,
    adminApproved: false,
    overrideApproved: false,
    now,
  }),
  true,
);
assert.equal(
  matchesControlPendingOverdue({
    sessionStartAt: new Date('2026-11-06T10:00:00'),
    performerConfirmed: true,
    adminApproved: false,
    overrideApproved: false,
    now,
  }),
  false,
);
assert.equal(
  matchesControlPendingOverdue({
    sessionStartAt: new Date('2026-11-01T10:00:00'),
    performerConfirmed: true,
    adminApproved: true,
    overrideApproved: false,
    now,
  }),
  false,
);

console.log('trainer-insights.rules.test.ts: ok');
