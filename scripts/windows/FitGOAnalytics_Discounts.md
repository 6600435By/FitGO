# FitGOAnalytics — предоставленные скидки

Эталон в базе Forma: `Отчет.ПредоставленныеСкидки`
(`e1c://server/s2016.forma.local/forma#e1cib/app/Отчет.ПредоставленныеСкидки`).

FitGO вкладка «Рынок и цены» вызывает:

```http
GET {FORMA_ANALYTICS_URL}/discounts?from=YYYY-MM-DD&to=YYYY-MM-DD
```

с заголовками `apikey` и `Authorization: Basic …` как у `/sales`.

Пока метод не опубликован, Nest помечает синк как `endpoint_missing`, блок скидок на UI — «н/д».

## Что сделать на сервере 1С

1. Открыть отчёт `ПредоставленныеСкидки` в конфигураторе.
2. Снять текст запроса / СКД (поля **не выдумывать**).
3. Ожидаемый JSON (после сверки со схемой):

```json
{
  "data": {
    "items": [
      {
        "occurredAt": "2026-08-15T12:00:00",
        "productExternalId": "uuid-номенклатуры",
        "productName": "Безлимит 12 мес",
        "clientExternalId": "uuid",
        "clientName": "Иванов",
        "employeeExternalId": "код",
        "employeeName": "Админ",
        "discountName": "Акция август",
        "discountAmount": 50.00,
        "discountPercent": 10,
        "saleDocumentId": "uuid-документа"
      }
    ]
  }
}
```

4. Вставить обработчик в HTTP-сервис Analytics (см. заготовку [FitGOAnalytics_Discounts_Stub.bsl](FitGOAnalytics_Discounts_Stub.bsl)).
5. Опубликовать (F7), на вкладке «Рынок и цены» нажать «Обновить скидки из 1С».

Строки кэшируются в Postgres (`ProvidedDiscountRow`). Повторное открытие вкладки в 1С не ходит.

## Запасной след в регистре продаж

В СКД `FFS_ПродажиАдминов` уже есть `СтоимостьБезСкидкиОборот` и процент `Скидка` из `РегистрНакопления.ПродажиСебестоимость`. Если отчёт `ПредоставленныеСкидки` окажется неудобным для HTTP, можно расширить `/sales` полями `listAmount` / `discountAmount` — но целевой путь вкладки остаётся отдельный `/discounts` по отчёту скидок.
