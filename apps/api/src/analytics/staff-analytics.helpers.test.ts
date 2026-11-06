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
  // 1C tags one-shot «Продажа» write-offs as PACKAGE — basis wins.
  assert.equal(
    classifySpaPaymentBucket({
      paymentBasis: 'Продажа 24679 от 04.08.2023',
      paySource: 'PACKAGE',
    }),
    'PAID',
  );
  // Massage block → PAID (not membership quota).
  assert.equal(
    classifySpaPaymentBucket({
      paymentBasis: 'Пакет услуг "Блок массажа 5 новый" 73910 от 16.07.2026',
      paySource: 'PACKAGE',
    }),
    'PAID',
  );
  assert.equal(
    classifySpaPaymentBucket({
      paymentBasis: 'Пакет услуг "Блок массажа 5 новый"',
      paymentType: SpaPaymentType.QUOTA,
    }),
    'PAID',
  );
  // Bare AllSports visit without биоимпеданс → not PARTNER.
  assert.equal(
    classifySpaPaymentBucket({
      paymentBasis: 'AllSports визит',
    }),
    'UNKNOWN',
  );
  assert.equal(
    classifySpaPaymentBucket({
      paymentBasis: 'Allsports БИОИМПЕДАНС',
    }),
    'PARTNER',
  );
  assert.equal(
    classifySpaPaymentBucket({
      paymentType: SpaPaymentType.QUOTA,
      paymentBasis: 'Членство VIP',
    }),
    'QUOTA',
  );
  assert.equal(
    classifySpaPaymentBucket({
      paymentType: SpaPaymentType.QUOTA,
    }),
    'UNKNOWN',
  );
  assert.equal(
    classifySpaPaymentBucket({
      partnerSource: 'ALLSPORTS',
      serviceTitle: 'Allsports БИОИМПЕДАНС',
    }),
    'PARTNER',
  );
  assert.equal(
    classifySpaPaymentBucket({
      partnerSource: 'ALLSPORTS',
    }),
    'UNKNOWN',
  );
  assert.equal(
    classifySpaPaymentBucket({
      paySource: 'PACKAGE',
    }),
    'UNKNOWN',
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
}

console.log('staff-analytics.helpers.test.ts: ok');
