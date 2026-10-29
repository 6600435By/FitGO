/**
 * SessionApprovalService.performerRevise / clearAdminAfterMaterialEdit rules.
 * Run: cd apps/api && npx tsx --test src/booking-control/session-approval.revise.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isSessionPayrollEligible,
  sessionApprovalPhase,
} from '@fitgo/shared-types';

type Row = {
  performerConfirmedAt: Date | null;
  adminApprovedAt: Date | null;
  overrideApprovedAt: Date | null;
  returnReason?: string | null;
};

function phaseOf(row: Row) {
  return sessionApprovalPhase({
    performerConfirmedAt: row.performerConfirmedAt?.toISOString() ?? null,
    adminApprovedAt: row.adminApprovedAt?.toISOString() ?? null,
    overrideApprovedAt: row.overrideApprovedAt?.toISOString() ?? null,
  });
}

/** Pure mirror of performerRevise update branch. */
function applyUpdate(row: Row, comment?: string): Row {
  const phase = phaseOf(row);
  assert.equal(phase, 'PENDING_ADMIN');
  const now = new Date();
  return {
    ...row,
    performerConfirmedAt: now,
    ...(comment?.trim()
      ? { returnReason: comment.trim() }
      : {}),
  };
}

/** Pure mirror of performerRevise rereview branch. */
function applyRereview(row: Row, comment: string): Row {
  const phase = phaseOf(row);
  assert.equal(phase, 'APPROVED');
  assert.ok(comment.trim().length >= 2);
  return {
    performerConfirmedAt: row.performerConfirmedAt ?? new Date(),
    adminApprovedAt: null,
    overrideApprovedAt: null,
    returnReason: comment.trim(),
  };
}

/** Pure mirror of clearAdminAfterMaterialEdit. */
function applyMaterialClear(row: Row): { cleared: boolean; row: Row } {
  if (phaseOf(row) !== 'APPROVED') return { cleared: false, row };
  return {
    cleared: true,
    row: {
      ...row,
      adminApprovedAt: null,
      overrideApprovedAt: null,
      returnReason: 'Изменена запись',
    },
  };
}

describe('performerRevise mirrors', () => {
  it('update bumps stamp while PENDING_ADMIN', () => {
    const row: Row = {
      performerConfirmedAt: new Date('2026-10-01T10:00:00Z'),
      adminApprovedAt: null,
      overrideApprovedAt: null,
    };
    const next = applyUpdate(row, 'исправил услугу');
    assert.equal(phaseOf(next), 'PENDING_ADMIN');
    assert.equal(next.returnReason, 'исправил услугу');
    assert.equal(isSessionPayrollEligible(next), false);
  });

  it('update rejects when APPROVED', () => {
    const row: Row = {
      performerConfirmedAt: new Date('2026-10-01T10:00:00Z'),
      adminApprovedAt: new Date('2026-10-01T12:00:00Z'),
      overrideApprovedAt: null,
    };
    assert.throws(() => applyUpdate(row), /PENDING_ADMIN|equal/);
  });

  it('rereview clears admin and payroll', () => {
    const row: Row = {
      performerConfirmedAt: new Date('2026-10-01T10:00:00Z'),
      adminApprovedAt: new Date('2026-10-01T12:00:00Z'),
      overrideApprovedAt: null,
    };
    const next = applyRereview(row, 'ошибка в клиенте');
    assert.equal(phaseOf(next), 'PENDING_ADMIN');
    assert.equal(isSessionPayrollEligible(next), false);
    assert.equal(next.returnReason, 'ошибка в клиенте');
    assert.ok(next.performerConfirmedAt);
  });

  it('material edit clears only when APPROVED', () => {
    const pending: Row = {
      performerConfirmedAt: new Date('2026-10-01T10:00:00Z'),
      adminApprovedAt: null,
      overrideApprovedAt: null,
    };
    assert.equal(applyMaterialClear(pending).cleared, false);

    const approved: Row = {
      performerConfirmedAt: new Date('2026-10-01T10:00:00Z'),
      adminApprovedAt: new Date('2026-10-01T12:00:00Z'),
      overrideApprovedAt: null,
    };
    const { cleared, row } = applyMaterialClear(approved);
    assert.equal(cleared, true);
    assert.equal(phaseOf(row), 'PENDING_ADMIN');
    assert.equal(isSessionPayrollEligible(row), false);
  });
});
