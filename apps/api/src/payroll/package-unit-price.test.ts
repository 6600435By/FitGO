/**
 * Run: cd apps/api && npx ts-node --transpile-only -r tsconfig-paths/register src/payroll/package-unit-price.test.ts
 */
import assert from 'node:assert/strict';
import {
  applyPackListUnitDiscountMinor,
  resolvePackageUnitPriceMinor,
} from '@fitgo/shared-types';

{
  // 10 ПТ (50р.) list → 45 after 10%
  assert.equal(applyPackListUnitDiscountMinor(5000, 10), 4500);
  // 5 ПТ (40р.) list → 38 after 5%
  assert.equal(applyPackListUnitDiscountMinor(4000, 5), 3800);
  assert.equal(applyPackListUnitDiscountMinor(5000, 1), 5000);
}

{
  // Тишалович: 1C membership stored list 500 / unit 50; sale was 450.
  const unit = resolvePackageUnitPriceMinor({
    unitPriceMinor: 5000,
    packageAmountMinor: 50000,
    packageQty: 10,
    paymentBasis: 'Пакет услуг "10 ПТ (50р.)" 73258 от 05.10.2026',
    sessionTitle: 'Занятие с тренером 50р.',
  });
  assert.equal(unit, 4500);
}

{
  // 5-pack at 40 list → 38 (5%)
  const unit = resolvePackageUnitPriceMinor({
    unitPriceMinor: 4000,
    packageAmountMinor: 20000,
    packageQty: 5,
    paymentBasis: 'Пакет услуг "5 ПТ (40р.)" 10001 от 06.10.2026',
    sessionTitle: 'Занятие с тренером 40р.',
  });
  assert.equal(unit, 3800);
}

{
  // Membership already has discounted total (450) → trust 450/10, no double discount.
  const unit = resolvePackageUnitPriceMinor({
    unitPriceMinor: 4500,
    packageAmountMinor: 45000,
    packageQty: 10,
    paymentBasis: 'Пакет услуг "10 ПТ (50р.)" 73258 от 05.10.2026',
    sessionTitle: 'Занятие с тренером 50р.',
  });
  assert.equal(unit, 4500);
}

{
  // One-shot PT (no pack count) — keep listed/unit as-is.
  const unit = resolvePackageUnitPriceMinor({
    unitPriceMinor: 5000,
    paymentBasis: null,
    sessionTitle: 'Занятие с тренером 50р.',
  });
  assert.equal(unit, 5000);
}

{
  // Listed only in title, no unit/package from sync.
  const unit = resolvePackageUnitPriceMinor({
    paymentBasis: 'Пакет услуг "10 ПТ (50р.)" 1 от 01.10.2026',
    sessionTitle: 'Занятие с тренером 50р.',
  });
  assert.equal(unit, 4500);
}

console.log('package-unit-price.test.ts: ok');
