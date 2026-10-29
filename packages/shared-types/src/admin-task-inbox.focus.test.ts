/**
 * Focus queue lanes for admin «Мой фокус».
 * Run: npx tsx --test packages/shared-types/src/admin-task-inbox.focus.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  adminFocusLane,
  filterAdminInboxItems,
  inboxCountsFromItems,
  primaryActionForTask,
  sortAdminFocusItems,
  type AdminInboxItem,
} from './admin-task-inbox';

function item(
  partial: Partial<AdminInboxItem> & Pick<AdminInboxItem, 'id' | 'kind'>,
): AdminInboxItem {
  return {
    virtual: false,
    bucket: 'today',
    owner: 'pool',
    primaryAction: 'complete',
    title: partial.id,
    outcomes: [],
    ...partial,
  };
}

describe('adminFocusLane', () => {
  it('ranks manager first, then confirm, renewals, visit money, booking control', () => {
    assert.equal(
      adminFocusLane(item({ id: 'm', kind: 'manager' })),
      0,
    );
    assert.equal(
      adminFocusLane(
        item({
          id: 'c',
          kind: 'control',
          source: 'BOOKING_CONFIRM',
          topic: 'confirmation',
          bucket: 'upcoming',
        }),
      ),
      1,
    );
    assert.equal(
      adminFocusLane(
        item({
          id: 'stale',
          kind: 'control',
          source: 'BOOKING_CONFIRM',
          topic: 'confirmation',
          bucket: 'overdue',
        }),
      ),
      null,
    );
    assert.equal(
      adminFocusLane(
        item({
          id: 'a',
          kind: 'calls',
          topic: 'membership',
          source: 'MEMBERSHIP_EXPIRING',
          bucket: 'overdue',
        }),
      ),
      2,
    );
    assert.equal(
      adminFocusLane(
        item({
          id: 'd',
          kind: 'money',
          topic: 'installment',
          source: 'INSTALLMENT_PAYMENT',
          bucket: 'overdue',
          visitToday: true,
        }),
      ),
      3,
    );
    assert.equal(
      adminFocusLane(
        item({
          id: 'x',
          kind: 'money',
          topic: 'installment',
          source: 'INSTALLMENT_PAYMENT',
          bucket: 'overdue',
          visitToday: false,
        }),
      ),
      null,
    );
    assert.equal(
      adminFocusLane(
        item({
          id: 'g',
          kind: 'booking',
          topic: 'group_approval',
          bucket: 'today',
        }),
      ),
      4,
    );
  });
});

describe('filterAdminInboxItems control vs booking', () => {
  it('kind=control keeps only non-overdue BOOKING_CONFIRM', () => {
    const rows = [
      item({
        id: 'cfm',
        kind: 'control',
        source: 'BOOKING_CONFIRM',
        topic: 'confirmation',
        bucket: 'upcoming',
      }),
      item({
        id: 'old',
        kind: 'control',
        source: 'BOOKING_CONFIRM',
        topic: 'confirmation',
        bucket: 'overdue',
      }),
      item({
        id: 'spa',
        kind: 'booking',
        topic: 'spa_approval',
        source: 'BOOKING_SPA',
        bucket: 'overdue',
      }),
    ];
    const list = filterAdminInboxItems(rows, { view: 'now', kind: 'control' });
    assert.deepEqual(
      list.map((r) => r.id),
      ['cfm'],
    );
  });

  it('kind=booking keeps GP/PT/SPA approvals including overdue', () => {
    const rows = [
      item({
        id: 'cfm',
        kind: 'control',
        source: 'BOOKING_CONFIRM',
        topic: 'confirmation',
        bucket: 'upcoming',
      }),
      item({
        id: 'spa',
        kind: 'booking',
        topic: 'spa_approval',
        source: 'BOOKING_SPA',
        bucket: 'overdue',
      }),
      item({
        id: 'gp',
        kind: 'booking',
        topic: 'group_approval',
        source: 'BOOKING_GROUP',
        bucket: 'today',
      }),
    ];
    const list = filterAdminInboxItems(rows, { view: 'now', kind: 'booking' });
    assert.deepEqual(
      list.map((r) => r.id).sort(),
      ['gp', 'spa'],
    );
  });
});

describe('filterAdminInboxItems membership / birthday kinds', () => {
  it('keeps upcoming renewals when kind=calls', () => {
    const rows = [
      item({
        id: 'm',
        kind: 'calls',
        source: 'MEMBERSHIP_EXPIRING',
        topic: 'membership',
        bucket: 'upcoming',
      }),
      item({
        id: 'b',
        kind: 'birthday',
        source: 'BIRTHDAY',
        topic: 'birthday',
        bucket: 'today',
      }),
    ];
    const abon = filterAdminInboxItems(rows, { view: 'now', kind: 'calls' });
    assert.deepEqual(
      abon.map((r) => r.id),
      ['m'],
    );
    const dr = filterAdminInboxItems(rows, { view: 'now', kind: 'birthday' });
    assert.deepEqual(
      dr.map((r) => r.id),
      ['b'],
    );
  });
});

describe('filterAdminInboxItems focus', () => {
  it('excludes old installments from view=now without kind', () => {
    const rows = [
      item({
        id: 'old',
        kind: 'money',
        source: 'INSTALLMENT_PAYMENT',
        topic: 'installment',
        bucket: 'overdue',
      }),
      item({
        id: 'cfm',
        kind: 'control',
        source: 'BOOKING_CONFIRM',
        topic: 'confirmation',
        bucket: 'upcoming',
      }),
    ];
    const focus = filterAdminInboxItems(rows, { view: 'now' });
    assert.deepEqual(
      focus.map((r) => r.id),
      ['cfm'],
    );
  });

  it('keeps all money when kind=money', () => {
    const rows = [
      item({
        id: 'old',
        kind: 'money',
        source: 'INSTALLMENT_PAYMENT',
        topic: 'installment',
        bucket: 'overdue',
      }),
    ];
    const money = filterAdminInboxItems(rows, { view: 'now', kind: 'money' });
    assert.equal(money.length, 1);
  });
});

describe('sortAdminFocusItems', () => {
  it('orders manager before confirmation', () => {
    const sorted = sortAdminFocusItems([
      item({
        id: 'cfm',
        kind: 'control',
        source: 'BOOKING_CONFIRM',
        topic: 'confirmation',
        bucket: 'upcoming',
        dueAt: '2026-10-30T10:00:00+03:00',
      }),
      item({
        id: 'mgr',
        kind: 'manager',
        dueAt: '2026-10-29T12:00:00+03:00',
      }),
    ]);
    assert.deepEqual(
      sorted.map((r) => r.id),
      ['mgr', 'cfm'],
    );
  });
});

describe('primaryActionForTask money', () => {
  it('does not force call for debts', () => {
    assert.equal(
      primaryActionForTask({
        source: 'INSTALLMENT_PAYMENT',
        phone: '+375291112233',
      }),
      'complete',
    );
    assert.equal(
      primaryActionForTask({
        source: 'CLIENT_DEBT',
        phone: '+375291112233',
      }),
      'complete',
    );
  });
});

describe('inboxCountsFromItems focus totals', () => {
  it('counts only focus-queue rows in total/overdue', () => {
    const counts = inboxCountsFromItems([
      item({
        id: 'old',
        kind: 'money',
        source: 'INSTALLMENT_PAYMENT',
        topic: 'installment',
        bucket: 'overdue',
      }),
      item({
        id: 'mgr',
        kind: 'manager',
        bucket: 'today',
      }),
    ]);
    assert.equal(counts.byKind.money, 1);
    assert.equal(counts.total, 1);
    assert.equal(counts.today, 1);
    assert.equal(counts.overdue, 0);
  });

  it('excludes visit debts from overdue/today focus counters', () => {
    const counts = inboxCountsFromItems([
      item({
        id: 'debt',
        kind: 'money',
        source: 'CLIENT_DEBT',
        topic: 'client_debt',
        bucket: 'overdue',
        visitToday: true,
      }),
      item({
        id: 'cfm',
        kind: 'control',
        source: 'BOOKING_CONFIRM',
        topic: 'confirmation',
        bucket: 'upcoming',
      }),
    ]);
    assert.equal(counts.total, 2);
    assert.equal(counts.overdue, 0);
    assert.equal(counts.byKind.money, 1);
    assert.equal(counts.byKind.control, 1);
  });
});
