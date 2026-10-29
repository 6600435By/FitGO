/**
 * Run: cd apps/api && npx ts-node --transpile-only src/admin-sales/solarium-trainer-hide.test.ts
 */
import assert from 'node:assert/strict';
import {
  isHiddenFromTrainerBookingControl,
  isSolariumSessionTitle,
} from './trainer-pt-sales-from-revenue';

assert.equal(isSolariumSessionTitle('Солярий'), true);
assert.equal(isSolariumSessionTitle('Солярий 10 мин'), true);
assert.equal(isSolariumSessionTitle('Vertical solarium'), true);
assert.equal(isSolariumSessionTitle('Персональная тренировка'), false);

assert.equal(
  isHiddenFromTrainerBookingControl({ kind: 'SOLARIUM', title: 'Солярий' }),
  true,
);
assert.equal(
  isHiddenFromTrainerBookingControl({ kind: 'SPA', title: 'Массаж' }),
  true,
);
assert.equal(
  isHiddenFromTrainerBookingControl({
    kind: 'PT',
    title: 'Солярий 10 мин',
  }),
  true,
);
assert.equal(
  isHiddenFromTrainerBookingControl({
    kind: 'PT',
    title: 'Персональная тренировка',
  }),
  false,
);
assert.equal(
  isHiddenFromTrainerBookingControl({
    kind: 'GROUP',
    title: 'Йога',
  }),
  false,
);

console.log('solarium-trainer-hide.test.ts: ok');
