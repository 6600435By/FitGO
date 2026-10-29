/**
 * Run: cd apps/api && npx ts-node --transpile-only src/spa-booking/spa-client-identity.util.test.ts
 */
import assert from 'node:assert/strict';
import {
  guestMatchLabel,
  normalizeGuestLabel,
  shouldAutoCascadeByName,
  spaClientGroupKey,
} from './spa-client-identity.util';

assert.equal(normalizeGuestLabel('  Ёлка   Анна '), 'елка анна');

assert.equal(
  guestMatchLabel({ guestAlias: 'Аня', guestName: 'Иванова Анна' }),
  'аня',
);
assert.equal(guestMatchLabel({ guestName: 'Иванова Анна' }), 'иванова анна');

assert.equal(shouldAutoCascadeByName('Иванова Анна'), true);
assert.equal(shouldAutoCascadeByName('Аня'), false);
assert.equal(shouldAutoCascadeByName(''), false);

assert.equal(
  spaClientGroupKey({
    clientExternalId: 'ext-1',
    clientId: 'u1',
    guestPhone: '+375291112233',
    guestName: 'Аня',
  }),
  'ext:ext-1',
);
assert.equal(
  spaClientGroupKey({
    clientId: 'u1',
    guestPhone: '+375291112233',
    guestName: 'Аня',
  }),
  'user:u1',
);
assert.equal(
  spaClientGroupKey({
    guestPhone: '+375 29 111-22-33',
    guestName: 'Аня',
  }),
  'phone:375291112233',
);
assert.equal(spaClientGroupKey({ guestAlias: 'Аня' }), 'name:аня');

console.log('spa-client-identity.util.test.ts: ok');
