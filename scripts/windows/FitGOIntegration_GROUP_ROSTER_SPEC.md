# Group class roster for FitGO journal baseline

## GET `/v1/group-session-roster`

Query: `appointmentId` (id занятия из расписания Forma/1С).

Response `200`:

```json
{
  "data": [
    {
      "externalId": "uuid-клиента",
      "clientName": "Иванов И.",
      "phone": "37529…"
    }
  ]
}
```

FitGO: freeze эталона `GroupClassSession` с `baselineQuality=FULL`. Пока метод не опубликован — FitGO использует PARTIAL (только записи через приложение).

**Нагрузка на 1С:** один запрос на открытие журнала занятия (не на каждого клиента). Результат кэшируется в Postgres — повторный open не бьёт 1С. Не вызывать из cron по всем занятиям.

Обработчик: добавить в `FitGOIntegration_HTTP.bsl` + выборку состава занятия в `FitGOIntegration_Клиенты.bsl`.
