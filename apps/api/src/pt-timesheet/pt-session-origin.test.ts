/**
 * Run: cd apps/api && npx ts-node --transpile-only -r tsconfig-paths/register src/pt-timesheet/pt-session-origin.test.ts
 */
import assert from 'node:assert/strict';
import {
  classifyPtSessionOrigin,
  classifyPtStatsPayment,
} from '@fitgo/shared-types';

{
  assert.equal(
    classifyPtSessionOrigin({
      paymentBasis: 'Членство "VIP ( 6 месяцев )" 65958 от 02.03.2026',
    }),
    'MEMBERSHIP',
  );
  assert.equal(
    classifyPtSessionOrigin({
      paymentBasis: 'Членство "Единый ( 12месяцев )" 62863 от 30.11.2025',
    }),
    'MEMBERSHIP',
  );
  assert.equal(
    classifyPtSessionOrigin({
      paymentBasis:
        'Членство "Все включено ( 3 месяца )" 69107 от 30.05.2026',
    }),
    'MEMBERSHIP',
  );
  assert.equal(
    classifyPtSessionOrigin({
      paymentBasis: 'Пакет услуг "Безлимит (12 месяцев)" 43734 от 14.05.2024',
    }),
    'MEMBERSHIP',
  );
}

{
  assert.equal(
    classifyPtSessionOrigin({
      paymentBasis: 'Пакет услуг "10 ПТ (50р.)" 72019 от 01.09.2026',
    }),
    'BLOCK',
  );
  assert.equal(
    classifyPtSessionOrigin({
      paymentBasis:
        'Пакет услуг "Индивидуальное занятие реформер 8" 73437 от 08.10.2026',
    }),
    'BLOCK',
  );
  assert.equal(
    classifyPtSessionOrigin({
      paymentBasis: 'Пакет услуг "Персональная тренировка"',
      packageQty: 10,
    }),
    'BLOCK',
  );
  assert.equal(
    classifyPtSessionOrigin({
      paymentBasis:
        'Пакет услуг «Блок массажа 10 новый» 73906 от 08.10.2026',
    }),
    'BLOCK',
  );
  assert.equal(
    classifyPtSessionOrigin({
      paymentBasis:
        'Членство "Курс массажа 5  (удален)" 72503 от 05.09.2026',
    }),
    'BLOCK',
  );
}

{
  assert.equal(
    classifyPtSessionOrigin({
      paymentBasis: 'Пакет услуг "1 ПТ (50р.)" 1 от 01.01.2026',
    }),
    'ONE_SHOT',
  );
  assert.equal(
    classifyPtSessionOrigin({
      fromSaleLine: true,
      paymentBasis: 'Оплата картой',
    }),
    'ONE_SHOT',
  );
  assert.equal(
    classifyPtSessionOrigin({
      paymentBasis: 'Оплата наличными',
    }),
    'ONE_SHOT',
  );
}

{
  // Gift PT written off from VIP membership → АБОН, not the gift bucket.
  assert.equal(
    classifyPtSessionOrigin({
      isComplimentary: true,
      paymentBasis: 'Членство "VIP"',
    }),
    'MEMBERSHIP',
  );
  assert.equal(
    classifyPtSessionOrigin({
      isComplimentary: true,
      paymentBasis: 'Членство "VIP ( 6 месяцев )" 65958 от 02.03.2026',
      sessionTitle: 'Подарочная ПТ с тренером',
    }),
    'MEMBERSHIP',
  );
  assert.equal(
    classifyPtSessionOrigin({
      paymentBasis: 'Подарочная тренировка',
    }),
    'GIFT',
  );
  assert.equal(
    classifyPtSessionOrigin({
      sessionTitle: 'Комплимент от клуба',
    }),
    'GIFT',
  );
  assert.equal(
    classifyPtSessionOrigin({
      isComplimentary: true,
      sessionTitle: 'Подарочная ПТ с тренером',
    }),
    'GIFT',
  );
}

{
  assert.equal(classifyPtSessionOrigin({ paymentBasis: '' }), 'UNKNOWN');
  assert.equal(classifyPtSessionOrigin({}), 'UNKNOWN');
}

{
  assert.equal(
    classifyPtStatsPayment({
      origin: 'MEMBERSHIP',
      paymentBasis: 'Членство "VIP"',
    }),
    'WRITTEN_OFF',
  );
  assert.equal(
    classifyPtStatsPayment({
      origin: 'BLOCK',
      paymentBasis: 'Пакет услуг "10 ПТ"',
    }),
    'WRITTEN_OFF',
  );
  assert.equal(
    classifyPtStatsPayment({
      origin: 'ONE_SHOT',
      salePaymentStatus: 'PAID',
      payrollTrusted: true,
    }),
    'PAID',
  );
  assert.equal(
    classifyPtStatsPayment({
      origin: 'ONE_SHOT',
      paymentBasis: 'Долг клиента',
    }),
    'DEBT',
  );
  assert.equal(
    classifyPtStatsPayment({
      origin: 'GIFT',
      isComplimentary: true,
    }),
    'GIFT',
  );
  assert.equal(
    classifyPtStatsPayment({
      origin: 'MEMBERSHIP',
      isComplimentary: true,
      paymentBasis: 'Членство "VIP"',
    }),
    'WRITTEN_OFF',
  );
}

console.log('pt-session-origin.test.ts: ok');
