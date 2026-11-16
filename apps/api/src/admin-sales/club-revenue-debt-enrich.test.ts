import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FitgoAnalyticsSalesItem } from '@fitgo/1c-adapter';
import {
  debtRowNeedsSalesEnrich,
  enrichDebtItemsFromSalesUnpaid,
  indexSalesUnpaidByDocument,
} from './club-revenue-sync.service';

describe('debt stub enrich from /sales (Loyko write-off)', () => {
  it('flags placeholder Продажа N and missing performer', () => {
    assert.equal(
      debtRowNeedsSalesEnrich({
        productName: 'Продажа 31354 от 13.10.2026',
        performerName: 'Абрамчик Егор',
      }),
      true,
    );
    assert.equal(
      debtRowNeedsSalesEnrich({
        productName: 'Массаж классический 25 мин',
        performerName: null,
        performerExternalId: null,
      }),
      true,
    );
    assert.equal(
      debtRowNeedsSalesEnrich({
        productName: 'Массаж классический 25 мин',
        performerName: 'Абрамчик Егор Викторович',
        performerExternalId: '000000162',
      }),
      false,
    );
  });

  it('copies SKU + performer onto debt stub from unpaid /sales', () => {
    const debt: FitgoAnalyticsSalesItem[] = [
      {
        saleDocumentId:
          'b6a1c667-3a60-4dad-92ca-816ba2fedb12:debt:a6b05b09-ac7c-11e8-80e8-7085c20c362e',
        documentId: 'b6a1c667-3a60-4dad-92ca-816ba2fedb12',
        operationType: 'unpaid',
        soldAt: '2026-10-13T15:50:19',
        saleAmount: 30,
        paidAmount: 0,
        productName: 'Продажа 31354 от 13.10.2026',
        clientName: 'Лойко Алексей Евгеньевич (Сотрудник)',
        clientExternalId: 'a6b05b09-ac7c-11e8-80e8-7085c20c362e',
      },
    ];
    const sales: FitgoAnalyticsSalesItem[] = [
      {
        saleDocumentId:
          'b6a1c667-3a60-4dad-92ca-816ba2fedb12:7223308a-a555-11e8-80e8-7085c20c362e:20261013155019',
        documentId: 'b6a1c667-3a60-4dad-92ca-816ba2fedb12',
        operationType: 'unpaid',
        soldAt: '2026-10-13T15:50:19',
        saleAmount: 30,
        paidAmount: 0,
        productName: 'Массаж классический 25 мин',
        productExternalId: '7223308a-a555-11e8-80e8-7085c20c362e',
        clientName: 'Лойко Алексей Евгеньевич (Сотрудник)',
        clientExternalId: 'a6b05b09-ac7c-11e8-80e8-7085c20c362e',
        performerName: 'Абрамчик Егор Викторович',
        performerExternalId: '000000162',
      },
    ];
    assert.equal(
      indexSalesUnpaidByDocument(sales).has(
        'b6a1c667-3a60-4dad-92ca-816ba2fedb12',
      ),
      true,
    );
    enrichDebtItemsFromSalesUnpaid(debt, sales);
    assert.equal(debt[0]!.productName, 'Массаж классический 25 мин');
    assert.equal(
      debt[0]!.productExternalId,
      '7223308a-a555-11e8-80e8-7085c20c362e',
    );
    assert.equal(debt[0]!.performerName, 'Абрамчик Егор Викторович');
    assert.equal(debt[0]!.performerExternalId, '000000162');
  });
});
