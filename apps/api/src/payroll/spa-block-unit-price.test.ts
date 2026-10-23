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

console.log('spa-block-unit-price.test.ts: ok');
