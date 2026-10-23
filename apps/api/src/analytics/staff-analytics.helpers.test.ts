/**
 * Run: cd apps/api && npx ts-node --transpile-only -r tsconfig-paths/register src/analytics/staff-analytics.helpers.test.ts
 */
import assert from 'node:assert/strict';
import { OnexClassKind, SpaPaymentType } from '@prisma/client';
import {
  classifySpaPaymentBucket,
  isSpaAnalyticsSession,
  resolveStaffUserId,
  staffDisplayNames,
} from './staff-analytics.helpers';

{
  const names = staffDisplayNames({ firstName: 'Екатерина', lastName: 'Бирюкова' });
  assert.deepEqual(names, ['Бирюкова Екатерина', 'Екатерина Бирюкова']);
}

{
  const byExternal = new Map<string, string>([['42', 'u1']]);
  const staff = [{ id: 'u2', firstName: 'Егор', lastName: 'Абрамчик' }];
  assert.equal(
    resolveStaffUserId(byExternal, staff, '042', null),
    'u1',
  );
  assert.equal(
    resolveStaffUserId(byExternal, staff, null, 'Абрамчик Егор Викторович'),
    'u2',
  );
  assert.equal(
    resolveStaffUserId(byExternal, staff, null, 'Егор Абрамчик'),
    'u2',
  );
}

{
  assert.equal(
    classifySpaPaymentBucket({
      paymentBasis: 'Членство "VIP ( 6 месяцев )"',
      paySource: 'PACKAGE',
    }),
    'QUOTA',
  );
  assert.equal(
    classifySpaPaymentBucket({
      paymentBasis: 'Продажа 28885',
      paySource: 'SALE',
    }),
    'PAID',
  );
  assert.equal(
    classifySpaPaymentBucket({
      paymentBasis: 'AllSports визит',
    }),
    'PARTNER',
  );
  assert.equal(
    classifySpaPaymentBucket({
      paymentType: SpaPaymentType.QUOTA,
    }),
    'QUOTA',
  );
  assert.equal(
    classifySpaPaymentBucket({
      partnerSource: 'ALLSPORTS',
    }),
    'PARTNER',
  );
}

{
  assert.equal(
    isSpaAnalyticsSession({ kind: OnexClassKind.SPA, title: 'Массаж' }),
    true,
  );
  assert.equal(
    isSpaAnalyticsSession({
      kind: OnexClassKind.PT,
      title: 'Массаж классический',
    }),
    true,
  );
  assert.equal(
    isSpaAnalyticsSession({
      kind: OnexClassKind.PT,
      title: 'Персональная тренировка',
    }),
    false,
  );
}

console.log('staff-analytics.helpers.test.ts: ok');
