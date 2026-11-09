/**
 * Run: cd apps/api && npx ts-node --transpile-only src/trainer/personal-package-debit.rules.test.ts
 */
import assert from 'node:assert/strict';
import {
  afterPackageDebit,
  decidePersonalSessionSettle,
  pickActivePackage,
  shouldDebitPackageOnCancel,
} from './personal-package-debit.rules';

const now = new Date('2026-11-07T12:00:00.000Z');

{
  const next = afterPackageDebit(3);
  assert.deepEqual(next, {
    remaining: 2,
    exhausted: false,
    status: 'ACTIVE',
  });
  assert.deepEqual(afterPackageDebit(1), {
    remaining: 0,
    exhausted: true,
    status: 'EXHAUSTED',
  });
}

{
  const picked = pickActivePackage(
    [
      {
        id: 'expired',
        sessionsRemaining: 5,
        status: 'ACTIVE',
        validUntil: new Date('2026-11-01T00:00:00.000Z'),
      },
      {
        id: 'soon',
        sessionsRemaining: 2,
        status: 'ACTIVE',
        validUntil: new Date('2026-11-20T00:00:00.000Z'),
      },
      {
        id: 'later',
        sessionsRemaining: 4,
        status: 'ACTIVE',
        validUntil: new Date('2026-12-01T00:00:00.000Z'),
      },
      {
        id: 'empty',
        sessionsRemaining: 0,
        status: 'ACTIVE',
        validUntil: null,
      },
    ],
    now,
  );
  assert.equal(picked?.id, 'soon');
}

assert.equal(
  decidePersonalSessionSettle({ booking: null }).action,
  'skip',
);
{
  // Retry after successful settle (or after partial failure once ledgerSettledAt is set):
  // second completeSession must not debit package / raise debt again.
  const first = decidePersonalSessionSettle({
    booking: { ptFlow: 'PERSONAL', status: 'COMPLETED' },
    activePackage: {
      id: 'pkg1',
      sessionsRemaining: 2,
      status: 'ACTIVE',
      validUntil: null,
    },
    now,
  });
  assert.equal(first.action, 'debit_package');
  const retry = decidePersonalSessionSettle({
    booking: {
      ledgerSettledAt: now,
      ptFlow: 'PERSONAL',
      status: 'COMPLETED',
    },
    activePackage: {
      id: 'pkg1',
      sessionsRemaining: 1,
      status: 'ACTIVE',
      validUntil: null,
    },
    now,
  });
  assert.equal(retry.action, 'skip');
  if (retry.action === 'skip') assert.equal(retry.reason, 'already_settled');
}
assert.deepEqual(
  decidePersonalSessionSettle({
    booking: {
      isComplimentary: true,
      ptFlow: 'PERSONAL',
      status: 'COMPLETED',
    },
  }),
  { action: 'mark_complimentary' },
);
{
  const d = decidePersonalSessionSettle({
    booking: { ptFlow: 'CLUB', status: 'COMPLETED' },
  });
  assert.equal(d.action, 'skip');
  if (d.action === 'skip') assert.equal(d.reason, 'not_personal');
}
{
  const d = decidePersonalSessionSettle({
    booking: { ptFlow: 'PERSONAL', status: 'CANCELLED' },
  });
  assert.equal(d.action, 'skip');
  if (d.action === 'skip') assert.equal(d.reason, 'cancelled');
}

{
  const d = decidePersonalSessionSettle({
    booking: { ptFlow: 'PERSONAL', status: 'COMPLETED' },
    activePackage: {
      id: 'pkg1',
      sessionsRemaining: 1,
      status: 'ACTIVE',
      validUntil: null,
    },
    now,
  });
  assert.deepEqual(d, {
    action: 'debit_package',
    packageId: 'pkg1',
    remaining: 0,
    exhausted: true,
  });
}

{
  const d = decidePersonalSessionSettle({
    booking: {
      ptFlow: 'PERSONAL',
      status: 'COMPLETED',
      priceMinor: null,
    },
    activePackage: null,
    defaultSessionPriceMinor: 4500,
    now,
  });
  assert.deepEqual(d, { action: 'raise_debt', priceMinor: 4500 });
}

{
  const d = decidePersonalSessionSettle({
    booking: {
      ptFlow: 'PERSONAL',
      status: 'COMPLETED',
      priceMinor: null,
    },
    activePackage: null,
    defaultSessionPriceMinor: 4500,
    clientSessionPriceMinor: 6000,
    now,
  });
  assert.deepEqual(d, { action: 'raise_debt', priceMinor: 6000 });
}

assert.deepEqual(
  decidePersonalSessionSettle({
    booking: {
      ptFlow: 'PERSONAL',
      status: 'COMPLETED',
      priceMinor: null,
    },
    activePackage: null,
    defaultSessionPriceMinor: null,
    now,
  }),
  { action: 'mark_settled_zero' },
);

assert.equal(
  shouldDebitPackageOnCancel({
    debitPackage: true,
    ptFlow: 'PERSONAL',
  }),
  true,
);
assert.equal(
  shouldDebitPackageOnCancel({
    debitPackage: true,
    ptFlow: 'CLUB',
  }),
  false,
);
assert.equal(
  shouldDebitPackageOnCancel({
    debitPackage: false,
    ptFlow: 'PERSONAL',
  }),
  false,
);

console.log('personal-package-debit.rules.test.ts: ok');