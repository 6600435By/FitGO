/**
 * Performer revise / rereview phase + payroll rules.
 * Run: npx tsx --test packages/shared-types/src/session-approval-revise.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isSessionPayrollEligible,
  sessionApprovalPhase,
} from './club-schedule';

/** Mimic SessionApproval row after performer revise modes. */
function afterUpdate(row: {
  performerConfirmedAt: string;
  adminApprovedAt?: string | null;
  overrideApprovedAt?: string | null;
}) {
  return {
    performerConfirmedAt: new Date().toISOString(),
    adminApprovedAt: row.adminApprovedAt ?? null,
    overrideApprovedAt: row.overrideApprovedAt ?? null,
  };
}

function afterRereview(row: {
  performerConfirmedAt: string;
}) {
  return {
    performerConfirmedAt: row.performerConfirmedAt,
    adminApprovedAt: null,
    overrideApprovedAt: null,
  };
}

describe('session approval revise', () => {
  it('update keeps PENDING_ADMIN and not payroll-eligible', () => {
    const before = {
      performerConfirmedAt: '2026-10-01T10:00:00.000Z',
      adminApprovedAt: null,
      overrideApprovedAt: null,
    };
    assert.equal(sessionApprovalPhase(before), 'PENDING_ADMIN');
    const next = afterUpdate(before);
    assert.equal(sessionApprovalPhase(next), 'PENDING_ADMIN');
    assert.equal(isSessionPayrollEligible(next), false);
  });

  it('rereview from APPROVED → PENDING_ADMIN and clears payroll', () => {
    const before = {
      performerConfirmedAt: '2026-10-01T10:00:00.000Z',
      adminApprovedAt: '2026-10-01T12:00:00.000Z',
      overrideApprovedAt: null,
    };
    assert.equal(sessionApprovalPhase(before), 'APPROVED');
    assert.equal(isSessionPayrollEligible(before), true);
    const next = afterRereview(before);
    assert.equal(sessionApprovalPhase(next), 'PENDING_ADMIN');
    assert.equal(isSessionPayrollEligible(next), false);
  });

  it('rereview clears override stamp too', () => {
    const before = {
      performerConfirmedAt: '2026-10-01T10:00:00.000Z',
      adminApprovedAt: null,
      overrideApprovedAt: '2026-10-01T12:00:00.000Z',
    };
    assert.equal(sessionApprovalPhase(before), 'APPROVED');
    const next = afterRereview(before);
    assert.equal(sessionApprovalPhase(next), 'PENDING_ADMIN');
    assert.equal(isSessionPayrollEligible(next), false);
  });
});
