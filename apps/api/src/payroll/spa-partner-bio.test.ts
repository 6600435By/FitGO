/**
 * Free AllSports биоимпеданс must stay PARTNER (not gift) and pay spaPartnerRate.
 * Run: npx ts-node --transpile-only apps/api/src/payroll/spa-partner-bio.test.ts
 */
import assert from 'node:assert/strict';
import {
  inferPaymentFromBasis,
  isComplimentarySessionTitle,
  isSpaAllSportsBioimpedance,
} from '@fitgo/shared-types';

assert.equal(
  inferPaymentFromBasis('Allsports БИОИМПЕДАНС беспл.'),
  'PARTNER',
  'basis with беспл. + биоимпеданс → PARTNER',
);
assert.equal(
  inferPaymentFromBasis('занятие в подарок'),
  'GIFT',
  'gift PT stays GIFT',
);
assert.equal(
  isComplimentarySessionTitle('Allsports БИОИМПЕДАНС'),
  false,
  'bio title is not complimentary gift',
);
assert.equal(
  isComplimentarySessionTitle('Allsports БИОИМПЕДАНС · бесплатно'),
  false,
  'bio + бесплатно still not gift',
);
assert.equal(
  isComplimentarySessionTitle('Подарочная тренировка'),
  true,
);
assert.equal(
  isSpaAllSportsBioimpedance({ title: 'Allsports БИОИМПЕДАНС' }),
  true,
);

console.log('spa-partner-bio.test.ts: ok');
