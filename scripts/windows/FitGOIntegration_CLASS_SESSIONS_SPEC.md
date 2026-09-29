# Class sessions export for FitGO payroll / history

## GET `/v1/class-sessions`

Query: `from`, `to` (YYYY-MM-DD), optional `page` (default 1), `pageSize` (default 100, max 500).

Response `200`:

```json
{
  "data": [
    {
      "id": "uuid-занятия",
      "number": "0000104057",
      "kind": "GROUP",
      "status": "COMPLETED",
      "title": "Гибкое тело",
      "startAt": "2026-09-28T10:00:00",
      "endAt": "2026-09-28T11:00:00",
      "durationMin": 60,
      "employeeExternalId": "",
      "employeeName": "",
      "roomTitle": "Групповой зал большой",
      "bookedCount": 7,
      "headerAttendedCount": 6,
      "attendedCount": 6,
      "members": [
        {
          "externalId": "uuid-клиента",
          "clientName": "Иванов И.",
          "attendance": "ATTENDED",
          "cancelled": false,
          "paymentBasis": "Членство: …",
          "quantity": 1
        }
      ]
    }
  ],
  "page": 1,
  "pageSize": 100,
  "total": 42
}
```

`kind`: `GROUP` | `PT` | `SPA`  
`status`: `SCHEDULED` | `IN_PROGRESS` | `COMPLETED` | `CANCELLED`  
`attendance`: `ATTENDED` | `NO_SHOW` | `EXPECTED` | `CANCELLED`

Payroll uses `attendedCount` when `status=COMPLETED` (count of ATTENDED rows), not `headerAttendedCount`.

Handlers: `ClassSessionsGET` in [`FitGOIntegration_HTTP.bsl`](FitGOIntegration_HTTP.bsl), `ЗанятияПериодаJSON` in [`FitGOIntegration_Клиенты.bsl`](FitGOIntegration_Клиенты.bsl).

Configurator: template `/v1/class-sessions`, GET → `ClassSessionsGET`.

## Club visits (same VisitsGET)

`GET /v1/visits?from=&to=&page=&pageSize=` **without** `externalId`/`phone` → club page `{ data, page, pageSize, total }` with `externalId` on each row.

Per-client `GET /v1/visits?externalId=` unchanged.
