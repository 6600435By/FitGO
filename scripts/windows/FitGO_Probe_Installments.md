# Probe: метаданные рассрочки на Документ.Продажа

Шаблон справочника: `e1c://server/s2016.forma.local/forma#e1cib/list/Справочник.ШаблоныРассрочек`

## Зачем

Перед публикацией `scope=installments` в FitGOAnalytics нужно подтвердить имена:

- реквизит шаблона на `Документ.Продажа`
- табличная часть графика (вкладка «Рассрочки»)
- колонки план/факт даты и суммы

## Как проверить (консоль запросов / обработка)

1. Открой продажу с рассрочкой (например 23088).
2. В конфигураторе: Документ.Продажа → реквизиты / ТЧ — сверь имена.
3. Либо выполни в консоли код из [FitGO_Probe_Installments.bsl](FitGO_Probe_Installments.bsl) — выведет найденные имена.

## После подтверждения

1. Скопируй обновлённые модули из fitgo-probe:
   - [FitGOAnalytics_Продажи.bsl](/Users/machome/projects/fitgo-probe/1c-extension/FitGOAnalytics_Продажи.bsl) (`ПолучитьРассрочки`)
   - [FitGOAnalytics_HTTPService.bsl](/Users/machome/projects/fitgo-probe/1c-extension/FitGOAnalytics_HTTPService.bsl) (`scope=installments`)
2. Опубликуй HTTP-сервис Analytics.
3. Проверка с Mac:

```bash
curl -sk -H "apikey: $FORMA_API_KEY" -H "Authorization: Basic $FORMA_BASIC_AUTH" \
  "$FORMA_ANALYTICS_URL/sales?scope=installments&from=2020-01-01&to=2030-01-01" | head -c 2000
```

Ожидается `data.items[]` с `payments[].planDate / planAmount / factDate / factAmount`.
