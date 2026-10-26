/**
 * Run: cd apps/api && npx ts-node --transpile-only -r tsconfig-paths/register src/payroll/spa-block-unit-price.test.ts
 */
import assert from 'node:assert/strict';
import { spaBlockDiscountPct } from '@fitgo/shared-types';
import {
  buildPacksSameDayMap,
  catalogUnitWithBlockDiscount,
  groupMassageSalesToDocs,
  matchSpaBlockSale,
  modeOneShotPriceMinor,
  resolveSpaBlockUnitPrice,
  saleDocumentId,
} from './spa-block-unit-price';

{
  assert.equal(spaBlockDiscountPct(5), 5);
  assert.equal(spaBlockDiscountPct(10), 10);
  assert.equal(spaBlockDiscountPct(8), 8);
  assert.equal(spaBlockDiscountPct(15), 10);
  assert.equal(spaBlockDiscountPct(0), 0);
}

{
  assert.equal(
    saleDocumentId(
      '1281cee1-b544-4785-a928-60e062dceda9:7223308a-a555-11e8-80e8-7085c20c362e:20260908115255:p2026-09-12',
    ),
    '1281cee1-b544-4785-a928-60e062dceda9',
  );
  assert.equal(
    saleDocumentId('3a41cd94-582a-40ef-adff-7eb77fbee230'),
    '3a41cd94-582a-40ef-adff-7eb77fbee230',
  );
}

{
  // Дениченко: base 675 on 04.09 → /10 = 67.50
  const docs = groupMassageSalesToDocs([
    {
      externalSaleId: '3a41cd94-582a-40ef-adff-7eb77fbee230',
      clientName: 'Дениченко Ольга Игоревна',
      soldAt: new Date('2026-09-04T12:00:00Z'),
      amount: 675,
      productName: 'Массаж классический 50 мин',
      productExternalId: '72233086-a555-11e8-80e8-7085c20c362e',
      isActive: false,
    },
    {
      externalSaleId:
        '3a41cd94-582a-40ef-adff-7eb77fbee230:72233086:20260904120037:u2026-09-04',
      clientName: 'Дениченко Ольга Игоревна',
      soldAt: new Date('2026-09-04T12:00:00Z'),
      amount: 675,
      productName: 'Массаж классический 50 мин',
      productExternalId: '72233086-a555-11e8-80e8-7085c20c362e',
      isActive: false,
    },
    {
      externalSaleId:
        '3a41cd94-582a-40ef-adff-7eb77fbee230:72233086:20260904120037:p2026-09-11',
      clientName: 'Дениченко Ольга Игоревна',
      soldAt: new Date('2026-09-04T12:00:00Z'),
      amount: 675,
      productName: 'Массаж классический 50 мин',
      productExternalId: '72233086-a555-11e8-80e8-7085c20c362e',
      isActive: true,
    },
  ]);
  assert.equal(docs.length, 1);
  assert.equal(docs[0]!.amountMinor, 67500);

  const match = matchSpaBlockSale({
    sales: docs,
    clientName: 'Дениченко Ольга Игоревна',
    paymentBasis:
      'Пакет услуг "Блок массажа 10 новый" 73911 от 04.09.2026',
    catalogUnitMinor: 7500,
  });
  assert.ok(match);
  assert.equal(match!.source, 'SALE');
  assert.equal(match!.unitPriceMinor, 6750);
  assert.equal(match!.packQty, 10);
}

{
  // Хлебаказова: 450 / 5 = 90
  const docs = groupMassageSalesToDocs([
    {
      externalSaleId: '1281cee1-b544-4785-a928-60e062dceda9',
      clientName: 'Хлебаказова Оксана',
      soldAt: new Date('2026-09-08T11:52:00Z'),
      amount: 450,
      productName: 'Массаж классический 25 мин',
      productExternalId: '7223308a-a555-11e8-80e8-7085c20c362e',
      isActive: false,
    },
  ]);
  const match = matchSpaBlockSale({
    sales: docs,
    clientName: 'Хлебаказова Оксана',
    paymentBasis:
      'Членство "Курс массажа 5  (удален)" 72293 от 08.09.2026',
  });
  assert.ok(match);
  assert.equal(match!.unitPriceMinor, 9000);
  assert.equal(match!.packQty, 5);
}

{
  // Костюченко: 1170 на 2 курса / 5 = 117
  const docs = groupMassageSalesToDocs([
    {
      externalSaleId: '191b056b-d65e-43db-ab9a-536eb25f3458',
      clientName: 'Костюченко Дмитрий',
      soldAt: new Date('2026-09-05T20:36:00Z'),
      amount: 1170,
      productName: 'Массаж классический 40 мин',
      productExternalId: 'e370fe03-dd0b-11e8-80ea-7085c20c362e',
      isActive: false,
    },
    {
      externalSaleId:
        '191b056b-d65e-43db-ab9a-536eb25f3458:e370fe03:20260905203655:p2026-09-18',
      clientName: 'Костюченко Дмитрий',
      soldAt: new Date('2026-09-05T20:36:00Z'),
      amount: 585,
      productName: 'Массаж классический 40 мин',
      productExternalId: 'e370fe03-dd0b-11e8-80ea-7085c20c362e',
      isActive: true,
    },
  ]);
  assert.equal(docs[0]!.amountMinor, 117000);

  const packs = buildPacksSameDayMap([
    {
      clientName: 'Костюченко Дмитрий',
      paymentBasis:
        'Членство "Курс массажа 5  (удален)" 72503 от 05.09.2026',
      packageDocId: 'b355c8b6-744a-4e29-a4b6-e910fc6baa2e',
    },
    {
      clientName: 'Костюченко Дмитрий',
      paymentBasis:
        'Членство "Курс массажа 5  (удален)" 72502 от 05.09.2026',
      packageDocId: 'd074d499-b906-4a0d-bc0a-9ae35b5b934d',
    },
  ]);
  const key = 'костюченко дмитрий|2026-09-05';
  assert.equal(packs.get(key), 2);

  const match = matchSpaBlockSale({
    sales: docs,
    clientName: 'Костюченко Дмитрий',
    paymentBasis:
      'Членство "Курс массажа 5  (удален)" 72503 от 05.09.2026',
    packsSameDay: 2,
  });
  assert.ok(match);
  assert.equal(match!.unitPriceMinor, 11700);
}

{
  // Продажа не найдена → каталог 75 × 0.95 при N=5
  const cat = catalogUnitWithBlockDiscount(7500, 5);
  assert.ok(cat);
  assert.equal(cat!.source, 'CATALOG');
  assert.equal(cat!.discountPct, 5);
  assert.equal(cat!.unitPriceMinor, 7125);

  const cat10 = catalogUnitWithBlockDiscount(7500, 10);
  assert.ok(cat10);
  assert.equal(cat10!.unitPriceMinor, 6750);
}

{
  // Защита 75/10 = 7.50 (ошибочно взяли разовую как пакет) → sale rejected
  const docs = groupMassageSalesToDocs([
    {
      externalSaleId: 'bad-one-shot',
      clientName: 'Тест Клиент',
      soldAt: new Date('2026-09-04T12:00:00Z'),
      amount: 75,
      productName: 'Массаж классический 50 мин',
      productExternalId: '72233086-a555-11e8-80e8-7085c20c362e',
      isActive: true,
    },
  ]);
  const sale = matchSpaBlockSale({
    sales: docs,
    clientName: 'Тест Клиент',
    paymentBasis:
      'Пакет услуг "Блок массажа 10 новый" 1 от 04.09.2026',
    catalogUnitMinor: 7500,
  });
  assert.equal(sale, undefined);

  const resolved = resolveSpaBlockUnitPrice({
    sales: docs,
    clientName: 'Тест Клиент',
    paymentBasis:
      'Пакет услуг "Блок массажа 10 новый" 1 от 04.09.2026',
    catalogUnitMinor: 7500,
  });
  assert.ok(resolved);
  assert.equal(resolved!.source, 'CATALOG');
  assert.equal(resolved!.unitPriceMinor, 6750);
}

{
  assert.equal(modeOneShotPriceMinor([75, 75, 675, 75, 67.5, 90]), 7500);
  assert.equal(modeOneShotPriceMinor([450, 90, 90, 5]), 9000);
}

{
  // Князева: ЛС 855 + лицо 405 + классика 450 + разовый 75 в один день.
  // Bug was 855÷3÷10 = 28.50 for every visit. Must pick service lines.
  const docs = groupMassageSalesToDocs([
    {
      externalSaleId:
        'ac3c9231-a79f-11f1-8deb-a45d36c32cf1:pa:b8db14c8:20260903170003:personal_credit:u2026-09-03',
      clientName: 'Князева Алёна',
      soldAt: new Date('2026-09-03T17:00:03Z'),
      amount: 855,
      productName: 'Прочие поступления (начисление на ЛС)',
      productExternalId: null,
      isActive: false,
    },
    {
      externalSaleId: 'a56fbc45-54e9-4ca7-9db9-d1513dcd12b4',
      clientName: 'Князева Алёна',
      soldAt: new Date('2026-09-03T14:00:12Z'),
      amount: 405,
      productName: 'Массаж лица 25 мин',
      productExternalId: '72233094-a555-11e8-80e8-7085c20c362e',
      isActive: false,
    },
    {
      externalSaleId: 'a7381403-8180-441f-8b46-53118c863a60',
      clientName: 'Князева Алёна',
      soldAt: new Date('2026-09-03T14:02:49Z'),
      amount: 450,
      productName: 'Массаж классический 25 мин',
      productExternalId: '7223308a-a555-11e8-80e8-7085c20c362e',
      isActive: false,
    },
    {
      externalSaleId: 'b89c4c2e-b0ee-4eec-a4ad-72eb7560a744',
      clientName: 'Князева Алёна',
      soldAt: new Date('2026-09-03T14:05:23Z'),
      amount: 75,
      productName: 'Массаж классический 50 мин',
      productExternalId: '72233086-a555-11e8-80e8-7085c20c362e',
      isActive: false,
    },
  ]);
  // ЛС + one-shot dropped; two pack lines remain.
  assert.equal(docs.length, 2);

  const face = resolveSpaBlockUnitPrice({
    sales: docs,
    clientName: 'Князева Алёна',
    paymentBasis:
      'Пакет услуг "Блок массажа 10 новый" 1 от 03.09.2026',
    sessionTitle: 'Массаж лица 25 мин',
    packsSameDay: 3,
    catalogUnitMinor: 4500,
    serviceExternalId: '72233094-a555-11e8-80e8-7085c20c362e',
  });
  assert.ok(face);
  assert.equal(face!.source, 'SALE');
  assert.equal(face!.unitPriceMinor, 4050); // 405/10

  const classic = resolveSpaBlockUnitPrice({
    sales: docs,
    clientName: 'Князева Алёна',
    paymentBasis:
      'Пакет услуг "Блок массажа 10 новый" 2 от 03.09.2026',
    sessionTitle: 'Массаж классический 25 мин',
    packsSameDay: 3,
    catalogUnitMinor: 4500,
    serviceExternalId: '7223308a-a555-11e8-80e8-7085c20c362e',
  });
  assert.ok(classic);
  assert.equal(classic!.source, 'SALE');
  assert.equal(classic!.unitPriceMinor, 4500); // 450/10

  // «Массаж из блока» / курс 5 — не брать чужую линию 450÷5.
  const orphan = resolveSpaBlockUnitPrice({
    sales: docs,
    clientName: 'Князева Алёна',
    paymentBasis:
      'Членство "Курс массажа 5  (удален)" 72101 от 03.09.2026',
    sessionTitle: 'Массаж из блока (удален)',
    packsSameDay: 3,
    catalogUnitMinor: 5700,
  });
  assert.ok(orphan);
  assert.equal(orphan!.source, 'CATALOG');
  assert.equal(orphan!.unitPriceMinor, 5415); // 57 × 0.95
}

console.log('spa-block-unit-price.test.ts: ok');
