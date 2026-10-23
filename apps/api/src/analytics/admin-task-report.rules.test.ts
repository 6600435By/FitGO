/**
 * Run: cd apps/api && npx ts-node --transpile-only src/analytics/admin-task-report.rules.test.ts
 */
import assert from 'node:assert/strict';
import {
  collapseSharedGroups,
  computeRating,
  isOnTime,
  median,
  onTimePct,
  RATING_MIN_CLOSED,
} from './admin-task-report.rules';

{
  const map = collapseSharedGroups([
    {
      id: 'a',
      groupId: 'g1',
      completionMode: 'SHARED',
      assigneeId: 'u1',
      status: 'DONE',
      completedAt: new Date('2026-01-02'),
      closerActorId: 'u1',
    },
    {
      id: 'b',
      groupId: 'g1',
      completionMode: 'SHARED',
      assigneeId: 'u2',
      status: 'DONE',
      completedAt: new Date('2026-01-02'),
      closerActorId: null,
    },
  ]);
  assert.equal(map.size, 1);
  const g = map.get('group:g1');
  assert.equal(g?.creditUserId, 'u1');
  assert.deepEqual(g?.memberIds, ['a', 'b']);
}

assert.equal(isOnTime(null, new Date()), null);
assert.equal(
  isOnTime(new Date('2026-01-02'), new Date('2026-01-01')),
  true,
);
assert.equal(
  isOnTime(new Date('2026-01-01'), new Date('2026-01-02')),
  false,
);

assert.equal(computeRating(RATING_MIN_CLOSED - 1, 100, 5), null);
assert.equal(computeRating(5, 100, 5), 100);
assert.equal(computeRating(5, 0, 5), 50);
assert.equal(computeRating(5, 100, 5, 100), 85);

assert.equal(median([]), null);
assert.equal(median([1, 3, 2]), 2);
assert.equal(onTimePct(3, 4), 75);
assert.equal(onTimePct(0, 0), null);

console.log('admin-task-report.rules.test.ts: ok');
