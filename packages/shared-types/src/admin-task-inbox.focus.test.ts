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
  it('ranks manager first, then confirm, renewals, visit money, control', () => {
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
          kind: 'control',
          topic: 'group_approval',
          bucket: 'today',
        }),
      ),
      4,
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
});
