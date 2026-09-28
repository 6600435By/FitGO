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

FitGO: freeze эталона `GroupClassSession` с `baselineQuality=FULL` когда endpoint опубликован и вернул `data` (даже пустой массив = FULL с 0 участников). Пока метод не опубликован / HTTP error — FitGO использует PARTIAL (только записи через приложение).

**Нагрузка на 1С:** один запрос на открытие журнала занятия (не на каждого клиента). Результат кэшируется в Postgres — повторный open не бьёт 1С. Не вызывать из cron по всем занятиям.

Обработчик: `GroupSessionRosterGET` в [`FitGOIntegration_HTTP.bsl`](FitGOIntegration_HTTP.bsl) + `СоставГрупповогоЗанятияJSON` в [`FitGOIntegration_Клиенты.bsl`](FitGOIntegration_Клиенты.bsl).

В конфигураторе: шаблон `/v1/group-session-roster`, метод GET → `GroupSessionRosterGET`.
