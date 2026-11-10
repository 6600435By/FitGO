/**
 * PT «Занятие с тренером ALL SPORTS» — nomenclature match + fixed rate path.
 * Run: npx ts-node --transpile-only apps/api/src/payroll/pt-allsports-rate.test.ts
 */
import assert from 'node:assert/strict';
import {
  isPtAllSportsSession,
  PT_ALLSPORTS_SESSION_IDS,
  serviceExternalIdInList,
} from '@fitgo/shared-types';

assert.equal(
  serviceExternalIdInList(
    '8de2a45d36c32cf111f1318fdac9a158',
    PT_ALLSPORTS_SESSION_IDS,
  ),
  true,
  '1C ref without dashes matches',
);
assert.equal(
  isPtAllSportsSession({
    serviceExternalId: '8de2a45d-36c3-2cf1-11f1-318fdac9a158',
  }),
  true,
  'dashed UUID matches',
);
assert.equal(
  isPtAllSportsSession({
    title: 'Занятие с тренером ALL SPORTS',
  }),
  true,
  'title matches',
);
assert.equal(
  isPtAllSportsSession({
    serviceName: 'Занятие с тренером All Sports',
  }),
  true,
  'serviceName matches case-insensitive',
);
assert.equal(
  isPtAllSportsSession({ title: 'Персональная тренировка' }),
  false,
  'ordinary PT is not ALL SPORTS',
);
assert.equal(
  isPtAllSportsSession({
    title: 'Allsports БИОИМПЕДАНС',
  }),
  false,
  'SPA bioimpedance is not PT ALL SPORTS',
);

console.log('pt-allsports-rate.test.ts: ok');
