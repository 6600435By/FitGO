# Probe: сводка абонементов (`scope=members`)

## Зачем

Аналитика «Клиентская база» не может опираться на снимки ≤400 клиентов приложения.
Нужен один лёгкий запрос к `РегистрСведений.ЧленстваПакетыУслугИтоги` с готовыми счётчиками.

## Поля ответа

```json
{
  "active": 120,
  "frozen": 8,
  "expiring7": 5,
  "expiring30": 18,
  "endedInPeriod": 12,
  "endedClientIds": ["uuid…"],
  "asOf": "2026-10-10",
  "from": "2026-10-01"
}
```

## После публикации

1. Скопируй в расширение FitGOAnalytics:
   - [FitGOAnalytics_Продажи.bsl](/Users/machome/Projects/FitGO/scripts/windows/FitGOAnalytics_Продажи.bsl) (`ПолучитьСводкуАбонементов`)
   - [FitGOAnalytics_HTTPService.bsl](/Users/machome/Projects/FitGO/scripts/windows/FitGOAnalytics_HTTPService.bsl) (`scope=members`)
2. Опубликуй HTTP-сервис Analytics.
3. Проверка с Mac:

```bash
curl -sk -H "apikey: $FORMA_API_KEY" -H "Authorization: Basic $FORMA_BASIC_AUTH" \
  "$FORMA_ANALYTICS_URL/sales?scope=members&from=2026-10-01&to=2026-10-10" | head -c 2000
```

Ожидается JSON с `active` / `frozen` / `expiring7` / `expiring30`.
Если `error` про отсутствие регистра — сверь имя `ЧленстваПакетыУслугИтоги` в конфигураторе.
