/**
 * Pure helpers for trainer month analytics.
 * Run: npx ts-node --transpile-only apps/api/src/analytics/trainer-month-analytics.test.ts
 */
import assert from 'node:assert/strict';
import {
  computeGiftToPaidConversion,
  DEFAULT_PT_TIERS,
  filterControlByHall,
  isConductedControlRow,
  isReformerPersonalTitle,
  resolveLadderProgress,
  sameDayPreviousMonthWindow,
  summarizeConductedItems,
  type BookingControlListItem,
} from '@fitgo/shared-types';

// --- period ---
{
  const w = sameDayPreviousMonthWindow('2026-10-01', '2026-10-25');
  assert.equal(w.previousFrom, '2026-09-01');
  assert.equal(w.previousTo, '2026-09-25');
}
{
  const w = sameDayPreviousMonthWindow('2026-03-01', '2026-03-31');
  assert.equal(w.previousFrom, '2026-02-01');
  assert.equal(w.previousTo, '2026-02-28');
}

// --- conducted filter (incl. one-off PT sales — align with ЗП / лестница) ---
assert.equal(isConductedControlRow({ source: '1C', payTag: 'PACKAGE' }), true);
assert.equal(isConductedControlRow({ source: 'SALE', payTag: 'SALE' }), true);
assert.equal(isConductedControlRow({ source: '1C', payTag: 'SALE' }), true);

// --- summarize ---
{
  const items: Array<Partial<BookingControlListItem>> = [
    {
      kind: 'PT',
      payment: 'PAID',
      title: 'Персональная тренировка',
      clientName: 'Иванов',
      sessionKey: '1c:a',
    },
    {
      kind: 'PT',
      payment: 'GIFT',
      title: 'Подарочная ПТ',
      clientName: 'Петров',
      sessionKey: '1c:b',
    },
    {
      kind: 'PT',
      payment: 'QUOTA',
      title: 'Индивидуальное занятие реформер',
      clientName: 'Сидоров',
      sessionKey: '1c:c',
    },
    {
      kind: 'GROUP',
      title: 'Stretch',
      roomTitle: 'Зал реформеров',
      arrivedCount: 4,
      sessionKey: '1c:d',
    },
    {
      kind: 'GROUP',
      title: 'Yoga',
      roomTitle: 'Большой зал',
      arrivedCount: 8,
      sessionKey: '1c:e',
    },
  ];
  const s = summarizeConductedItems(items as BookingControlListItem[]);
  assert.equal(s.pt, 3);
  assert.equal(s.gift, 1);
  assert.equal(s.group, 2);
  assert.equal(s.reformerGroup, 1);
  assert.equal(s.reformerPersonal, 1);
  assert.equal(s.uniquePt.size, 3);
}

assert.equal(
  isReformerPersonalTitle('Индивидуальное занятие реформер 8'),
  true,
);
assert.equal(isReformerPersonalTitle('Stretch реформер'), false);

// --- hall filter ---
{
  const items = [
    {
      kind: 'GROUP' as const,
      title: 'Stretch',
      roomTitle: 'Зал реформеров',
      sessionKey: '1',
      source: '1C' as const,
      status: 'COMPLETED' as const,
      performerName: 'A',
      needsReview: false,
      startAt: '2026-10-01T10:00:00',
    },
    {
      kind: 'GROUP' as const,
      title: 'Yoga',
      roomTitle: 'Большой зал',
      sessionKey: '2',
      source: '1C' as const,
      status: 'COMPLETED' as const,
      performerName: 'A',
      needsReview: false,
      startAt: '2026-10-01T11:00:00',
    },
    {
      kind: 'PT' as const,
      title: 'Индивидуальное занятие реформер',
      sessionKey: '3',
      source: '1C' as const,
      status: 'COMPLETED' as const,
      performerName: 'A',
      needsReview: false,
      startAt: '2026-10-01T12:00:00',
    },
  ];
  // Hall filter also matches PT titles with «реформер»; deep-links add kind=GROUP.
  assert.equal(filterControlByHall(items, 'REFORMER').length, 2);
  assert.equal(
    filterControlByHall(items, 'REFORMER').filter((i) => i.kind === 'GROUP')
      .length,
    1,
  );
  assert.equal(filterControlByHall(items, null, 'personal').length, 1);
}

// --- ladder ---
{
  const mid = resolveLadderProgress(100, DEFAULT_PT_TIERS);
  assert.equal(mid.percent, 50);
  assert.equal(mid.remaining, 1);
  assert.equal(mid.nextMinSessions, 101);
  assert.equal(mid.isTop, false);

  const sixty = resolveLadderProgress(101, DEFAULT_PT_TIERS);
  assert.equal(sixty.percent, 60);
  assert.equal(sixty.remaining, 50);
  assert.equal(sixty.nextMinSessions, 151);

  const top = resolveLadderProgress(200, DEFAULT_PT_TIERS);
  assert.equal(top.percent, 70);
  assert.equal(top.isTop, true);
  assert.equal(top.remaining, null);
}

// --- gift → paid ---
{
  const t0 = new Date('2026-10-05T10:00:00');
  const t1 = new Date('2026-10-12T10:00:00');
  const r = computeGiftToPaidConversion([
    { clientKey: 'name:a', at: t0, payment: 'GIFT' },
    { clientKey: 'name:a', at: t1, payment: 'PAID' },
    { clientKey: 'name:b', at: t0, payment: 'GIFT' },
    { clientKey: 'name:c', at: t0, payment: 'GIFT' },
    { clientKey: 'name:c', at: t1, payment: 'SALE' },
    { clientKey: 'name:d', at: t0, payment: 'GIFT' },
    { clientKey: 'name:d', at: t1, payment: 'PARTNER' },
  ]);
  assert.equal(r.giftedClients, 4);
  assert.equal(r.convertedClients, 2); // a + c; b none; d partner only
  assert.equal(r.pct, 50);
}

console.log('trainer-month-analytics.test.ts: ok');
