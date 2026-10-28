/**
 * Run: cd apps/api && npx ts-node --transpile-only src/admin-sales/admin-desk-excluded.test.ts
 */
import assert from 'node:assert/strict';
import {
  ADMIN_DESK_EXCLUDED_PRODUCT_UUID,
  isExcludedFromAdminDeskSales,
} from './admin-sales-segments';

assert.equal(
  isExcludedFromAdminDeskSales(
    'Безлимит с арендой шкафчика (1месяц)',
    ADMIN_DESK_EXCLUDED_PRODUCT_UUID,
  ),
  true,
);
assert.equal(
  isExcludedFromAdminDeskSales(
    'Безлимит с арендой шкафчика (1 месяц)',
    null,
  ),
  true,
);
assert.equal(
  isExcludedFromAdminDeskSales(
    null,
    ADMIN_DESK_EXCLUDED_PRODUCT_UUID.replace(/-/g, ''),
  ),
  true,
);
assert.equal(
  isExcludedFromAdminDeskSales('VIP ( 6 месяцев )', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
  false,
);

console.log('admin-desk-excluded: ok');
