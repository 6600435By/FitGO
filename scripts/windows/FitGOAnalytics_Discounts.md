# FitGOAnalytics — предоставленные скидки

Эталон в базе Forma: `Отчет.ПредоставленныеСкидки`  
Источник данных: `РегистрНакопления.ПредоставленныеСкидки` (обороты, денежные скидки).

FitGO вкладка «Рынок и цены» вызывает:

```http
GET {FORMA_ANALYTICS_URL}/discounts?from=YYYY-MM-DD&to=YYYY-MM-DD
```

с заголовками `apikey` и `Authorization: Basic …` как у `/sales`.

Ответ:

```json
{
  "data": {
    "from": "2026-08-01",
    "to": "2026-08-31",
    "total": 12,
    "items": [
      {
        "occurredAt": "2026-08-15T12:00:00",
        "productExternalId": "uuid",
        "productName": "Безлимит 12 мес",
        "clientExternalId": "uuid",
        "clientName": "Иванов",
        "employeeExternalId": "000000168",
        "employeeName": "Админ",
        "discountName": "Акция август",
        "discountAmount": 50.00,
        "discountPercent": 10,
        "saleAmount": 500.00,
        "saleDocumentId": "uuid"
      }
    ]
  }
}
```

## Установка в конфигураторе

1. **Общий модуль `FitGOAnalyticsПродажи`**  
   Скопировать в конец модуля функции из  
   [FitGOAnalytics_Продажи.bsl](FitGOAnalytics_Продажи.bsl)  
   (блок `ПолучитьПредоставленныеСкидки` … `СтрокаПредоставленнойСкидкиВJSON`).  
   Зеркало probe: `/Users/machome/projects/fitgo-probe/1c-extension/FitGOAnalytics_Продажи.bsl`.

2. **Модуль HTTP-сервиса `FitGOAnalytics`**  
   Вставить `DiscountsGET` из  
   [FitGOAnalytics_HTTPService.bsl](FitGOAnalytics_HTTPService.bsl)  
   (или короткий файл [FitGOAnalytics_Discounts_Stub.bsl](FitGOAnalytics_Discounts_Stub.bsl)).

3. **Шаблон URL** в HTTP-сервисе `FitGOAnalytics` → `v1`:

   | Имя | Шаблон | Обработчик |
   |-----|--------|------------|
   | `discounts` | `discounts` | `DiscountsGET` |

4. Сохранить конфигурацию → обновить БД → опубликовать HTTP analytics (F7).

5. В FitGO: Аналитика → **Рынок и цены** → **Обновить скидки из 1С**.

Строки кэшируются в Postgres (`ProvidedDiscountRow`). Повторное открытие вкладки в 1С не ходит.

## Проверка с Mac

```bash
set -a; source apps/api/.env; set +a
curl -sk -H "apikey: $FORMA_API_KEY" -H "Authorization: Basic $FORMA_BASIC_AUTH" \
  "$FORMA_ANALYTICS_URL/discounts?from=2026-08-01&to=2026-08-31" | head -c 800
```

- **404** — метод не в публикации / неверное имя шаблона.  
- **200** + `items` — готово.  
- **500** `Поле не найдено "Обороты.НомерСтроки"` — в запросе не должно быть `НомерСтроки`/`Регистратор` у `.Обороты()`; возьмите актуальный блок из `FitGOAnalytics_Продажи.bsl`.  
- **500** про периодичность — в BSL есть fallback на `День`; переопубликуйте модуль продаж.

## Что не берём из отчёта

Вторая часть СКД (подарки, `НоменклатураПодарок`, блоки `{ХАРАКТЕРИСТИКИ}`) в v1 не реализована — для ценового отчёта нужны только денежные `СуммаСкидкиОборот`.
