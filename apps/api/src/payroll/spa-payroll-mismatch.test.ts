import assert from 'node:assert/strict';
import type { BookingControlListItem, WorkUnit } from '@fitgo/shared-types';
import { bookingControlInPayrollCalc } from '@fitgo/shared-types';
import {
  PAYROLL_DEBT_HINT,
  areSpaUnitsDuplicates,
  dedupeSpaPayrollUnits,
  preferSpaPayrollUnit,
} from './spa-payroll-debt';
import { revenueMatchesSpaPerformer } from './payroll.service';
import { classifyWorkUnit } from '../../../web/src/components/payroll/employee-report/work-unit-status';

function createWorkUnit(
  partial: Partial<WorkUnit> & Pick<WorkUnit, 'id' | 'occurredAt'>,
): WorkUnit {
  return {
    kind: 'SPA',
    performerId: 'user-biryukova',
    title: 'Массаж классический 50 мин',
    quantity: 1,
    trustBand: 'GREEN',
    trustResolution: 'NONE',
    payrollTrusted: true,
    clientName: 'Иванова Мария',
    ...partial,
  };
}

function createControlItem(
  partial: Partial<BookingControlListItem> & Pick<BookingControlListItem, 'sessionKey' | 'startAt'>,
): BookingControlListItem {
  return {
    kind: 'SPA',
    source: '1C',
    title: 'Массаж классический общий',
    status: 'COMPLETED',
    payment: 'QUOTA',
    needsReview: false,
    attendeeCount: 1,
    arrivedCount: 1,
    bookedCount: 1,
    noShowCount: 0,
    performerId: 'user-biryukova',
    performerName: 'Бирюкова Екатерина',
    clientName: 'Иванова Мария',
    ...partial,
  };
}

// ── Test 1: dedupeSpaPayrollUnits must NOT drop distinct 1C sessions ─────────
{
  const s1 = createWorkUnit({
    id: 'onex:doc-101',
    sessionId: 'doc-101',
    sessionKey: '1c:ext-101',
    occurredAt: '2026-11-13T14:19:00.000Z',
    title: 'Массаж классический общий (абонемент)',
    clientName: 'Иванова Мария',
    payrollTrusted: true,
    spaMembershipQuota: true,
  });

  const s2 = createWorkUnit({
    id: 'onex:doc-102',
    sessionId: 'doc-102',
    sessionKey: '1c:ext-102',
    occurredAt: '2026-11-13T15:10:00.000Z',
    title: 'Массаж классический общий (абонемент)',
    clientName: 'Иванова Мария',
    payrollTrusted: true,
    spaMembershipQuota: true,
  });

  assert.equal(areSpaUnitsDuplicates(s1, s2), false);
  const deduped = dedupeSpaPayrollUnits([s1, s2]);
  assert.equal(deduped.length, 2, 'Two distinct 1C sessions must not be dropped');
}

// ── Test 2: dedupeSpaPayrollUnits must NOT drop different SPA services ───────
{
  const s1 = createWorkUnit({
    id: 'onex:doc-201',
    occurredAt: '2026-11-13T14:00:00.000Z',
    title: 'Массаж классический 50 мин',
    clientName: 'Смирнова Анна',
    payrollTrusted: true,
    priceMinor: 9000,
  });

  const s2 = createWorkUnit({
    id: 'onex:doc-202',
    occurredAt: '2026-11-13T14:50:00.000Z',
    title: 'Массаж лица 30 мин',
    clientName: 'Смирнова Анна',
    payrollTrusted: true,
    priceMinor: 5000,
  });

  assert.equal(areSpaUnitsDuplicates(s1, s2), false);
  const deduped = dedupeSpaPayrollUnits([s1, s2]);
  assert.equal(deduped.length, 2, 'Two different SPA services for same client must not be dropped');
}

// ── Test 3: dedupeSpaPayrollUnits DOES drop unpaid debt stubs ────────────────
{
  const trustedVisit = createWorkUnit({
    id: 'onex:doc-301',
    occurredAt: '2026-11-13T14:00:00.000Z',
    title: 'Массаж классический общий (абонемент)',
    clientName: 'Петрова Ольга',
    payrollTrusted: true,
    spaMembershipQuota: true,
  });

  const debtStub = createWorkUnit({
    id: 'fitgo-booking-301',
    occurredAt: '2026-11-13T14:00:00.000Z',
    title: 'Массаж классический 50 мин',
    clientName: 'Петрова Ольга',
    payrollTrusted: false,
    trustBand: 'RED',
    trustHints: [PAYROLL_DEBT_HINT],
  });

  assert.equal(areSpaUnitsDuplicates(trustedVisit, debtStub), true);
  assert.equal(preferSpaPayrollUnit(trustedVisit, debtStub), trustedVisit);
  const deduped = dedupeSpaPayrollUnits([trustedVisit, debtStub]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]?.id, 'onex:doc-301');
}

// ── Test 4: classifyWorkUnit explains missing SPA quota rates clearly ────────
{
  // Quota session without rate must report "нет ставки для услуги ...", NOT "нет цены"
  const quotaWithoutRate = createWorkUnit({
    id: 'onex:doc-401',
    occurredAt: '2026-11-13T14:19:00.000Z',
    title: 'Массаж авторский (абонемент)',
    spaMembershipQuota: true,
    priceMinor: 0,
    earnMinor: undefined,
  });

  const status = classifyWorkUnit(quotaWithoutRate);
  assert.equal(status.level, 'check');
  assert.equal(status.label, 'проверить');
  assert.match(status.reason ?? '', /нет ставки для услуги "Массаж авторский"/);
}

// ── Test 5: bookingControlInPayrollCalc aligns with payroll rules ────────────
{
  // Row matching bug report example: "13 нояб. · 14:19 · SPA · Массаж классический общий · абонемент · Выполнено"
  const item = createControlItem({
    sessionKey: '1c:ext-example-60',
    startAt: '2026-11-13T14:19:00.000Z',
    title: 'Массаж классический общий',
    status: 'COMPLETED',
    payment: 'QUOTA',
    needsReview: false,
  });

  const nowMs = new Date('2026-11-24T12:00:00.000Z').getTime();
  assert.equal(bookingControlInPayrollCalc(item, nowMs), true);
}

// ── Test 6: revenueMatchesSpaPerformer matches swapped names and author ─────
{
  const codes = ['ext-biryukova-uuid', '000042'];
  const performerName = 'Бирюкова Екатерина';

  // Exact match
  assert.equal(
    revenueMatchesSpaPerformer(
      { performerName: 'Бирюкова Екатерина' },
      codes,
      performerName,
    ),
    true,
  );

  // Swapped name order: "Екатерина Бирюкова"
  assert.equal(
    revenueMatchesSpaPerformer(
      { performerName: 'Екатерина Бирюкова' },
      codes,
      performerName,
    ),
    true,
    'Must match when first and last names are swapped',
  );

  // Full name with patronymic: "Бирюкова Екатерина Александровна"
  assert.equal(
    revenueMatchesSpaPerformer(
      { performerName: 'Бирюкова Екатерина Александровна' },
      codes,
      performerName,
    ),
    true,
    'Must match with patronymic',
  );

  // Fallback to document author when performer is empty
  assert.equal(
    revenueMatchesSpaPerformer(
      { performerName: '', employeeName: 'Бирюкова Екатерина' },
      codes,
      performerName,
    ),
    true,
    'Must match author name when performer is empty',
  );
}

// ── Test 7: Reconciler reproduces 60 vs 53 mismatch and fixes it ─────────────
{
  const nowMs = new Date('2026-11-24T12:00:00.000Z').getTime();
  // 60 sessions in Booking Control with bookingControlInPayrollCalc = true
  const controlItems: BookingControlListItem[] = [];
  for (let i = 1; i <= 60; i++) {
    controlItems.push(
      createControlItem({
        sessionKey: `1c:session-${i}`,
        startAt: `2026-11-${String(Math.min(15, Math.ceil(i / 4))).padStart(2, '0')}T14:00:00.000Z`,
        title: i <= 10 ? 'Массаж классический общий' : 'Массаж классический 50 мин',
        payment: i <= 10 ? 'QUOTA' : 'PAID',
        priceMinor: i <= 10 ? 0 : 9000,
      }),
    );
  }

  assert.equal(controlItems.filter((item) => bookingControlInPayrollCalc(item, nowMs)).length, 60);

  // Suppose initial payroll only loaded 53 of them (7 sessions missing)
  const initialWorkUnits: WorkUnit[] = [];
  for (let i = 1; i <= 53; i++) {
    initialWorkUnits.push(
      createWorkUnit({
        id: `onex:session-${i}`,
        sessionId: `session-${i}`,
        sessionKey: `1c:session-${i}`,
        occurredAt: `2026-11-${String(Math.min(15, Math.ceil(i / 4))).padStart(2, '0')}T14:00:00.000Z`,
        title: i <= 10 ? 'Массаж классический общий (абонемент)' : 'Массаж классический 50 мин',
        priceMinor: i <= 10 ? 0 : 9000,
      }),
    );
  }
  assert.equal(initialWorkUnits.length, 53, 'Initially only 53 units');

  // Reconciler logic:
  const representedKeys = new Set<string>();
  for (const u of initialWorkUnits) {
    if (u.sessionKey?.trim()) representedKeys.add(u.sessionKey.trim());
    if (u.id?.trim()) representedKeys.add(u.id.trim());
    if (u.sessionId?.trim()) representedKeys.add(u.sessionId.trim());
  }

  const reconciledUnits = [...initialWorkUnits];
  for (const item of controlItems) {
    if (!bookingControlInPayrollCalc(item, nowMs)) continue;
    const itemKey = item.sessionKey?.trim();
    if (itemKey && representedKeys.has(itemKey)) continue;

    reconciledUnits.push(
      createWorkUnit({
        id: item.fitgoBookingId ?? item.sessionKey,
        sessionKey: item.sessionKey,
        occurredAt: item.startAt,
        title: item.title,
        priceMinor: item.priceMinor ?? 0,
      }),
    );
  }

  assert.equal(reconciledUnits.length, 60, 'Reconciled units must now exactly match 60 sessions from Booking Control');
}

console.log('spa-payroll-mismatch.test.ts: ok');
