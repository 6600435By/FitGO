/**
 * Run: cd apps/api && npx ts-node --transpile-only -r tsconfig-paths/register src/features/features-pilot.util.test.ts
 */
import assert from 'node:assert/strict';
import {
  DEFAULT_PRODUCT_MODULES,
  type ProductModulesState,
} from '@fitgo/shared-types';
import {
  applyPilotsForUser,
  isPilotableKey,
  parsePilots,
} from './features-pilot.util';

const base = {
  ...DEFAULT_PRODUCT_MODULES,
  trainer_ui_v2: false,
} as ProductModulesState;

{
  const pilots = parsePilots({
    trainer_ui_v2: ['a', 'b', 'a', '', 1, null],
    trainer_pt_control: ['should-ignore'],
    junk: ['x'],
  });
  assert.deepEqual(pilots, { trainer_ui_v2: ['a', 'b'] });
}

assert.equal(isPilotableKey('trainer_ui_v2'), true);
assert.equal(isPilotableKey('trainer_pt_control'), false);
assert.equal(isPilotableKey('club_ops'), false);

{
  const off = applyPilotsForUser(base, {}, 'u1');
  assert.equal(off.trainer_ui_v2, false);
}

{
  const pilot = applyPilotsForUser(
    base,
    { trainer_ui_v2: ['u1', 'u2'] },
    'u1',
  );
  assert.equal(pilot.trainer_ui_v2, true);
  const other = applyPilotsForUser(
    base,
    { trainer_ui_v2: ['u1', 'u2'] },
    'u3',
  );
  assert.equal(other.trainer_ui_v2, false);
}

{
  const globalOn = {
    ...base,
    trainer_ui_v2: true,
  } as ProductModulesState;
  const stillOn = applyPilotsForUser(
    globalOn,
    { trainer_ui_v2: ['someone-else'] },
    'u1',
  );
  assert.equal(stillOn.trainer_ui_v2, true);
}

console.log('features-pilot.util.test.ts: ok');
