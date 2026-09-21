# FitGOIntegration — spa consume / sale (BSL spec)

Полная пошаговая настройка на сервере 1С: **[FitGOIntegration_SPA_SETUP.md](./FitGOIntegration_SPA_SETUP.md)**.
Проба с Windows: `probe-fitgo-spa.ps1`.

Шаблоны HTTP-сервиса (префикс публикации `/fitgo/hs/fitgo`, URL Nest: `FORMA_FITGO_URL=…/v1`):

| Method | Template | Handler |
|--------|----------|---------|
| POST | `/v1/membership/consume-service` | `ConsumeServicePOST` |
| POST | `/v1/spa/service-sale` | `SpaSalePOST` |
| GET | `/v1/specialist-service-debts` | долги по услугам с конкретным `Сотрудник` за период |

Отмена SPA (порог 3 ч в Nest): тот же `POST /v1/membership/consume-service` с `serviceName: "__RESTORE__"` и `bookingRef` — откат документа «Занятие» (отмена проведения + статус Отменено). **Только если consume уже был** (`consumedInCrmAt`).

Auth: `apikey` + `Authorization: Basic …` (как у `/v1/membership/freeze`).

**Имена услуг в абонементе (live VIP 2026-09-17):** `Массаж классический общий`, `Анализ состава тела` — ими же заполнять `SpaQuotaRule.membershipServiceName` в FitGO.

## POST `/v1/membership/consume-service`

Списание услуги из пакета абонемента.

**Политика FitGO (с dual-gate):** Nest вызывает consume **не в момент записи**, а при переходе брони в `CONSUMED` (вход `VERIFIED_1C`/`ADMIN_OVERRIDE` + подтверждение исполнителя). До этого бронь только резервирует слот; при отмене до consume restore в 1С не нужен.

Request JSON:

```json
{
  "externalId": "ff94bf6a-b4d2-11e8-80e9-7085c20c362e",
  "serviceName": "Массаж классический общий",
  "serviceId": "optional-fitgo-spa-service-id",
  "bookingRef": "clxxx...",
  "occurredAt": "2026-09-16T15:00:00.000Z",
  "durationMin": 50
}
```

Response `200`: полный membership JSON (как GET `/v1/membership`).

Errors:

- `404` — клиент / услуга не найдена
- `409` — нет остатка квоты
- `400` — невалидное тело

BSL: создать и провести `Документ.ОперацииСЧленствомПакетомУслуг` с операцией «Использование» (или аналог визита/оказания услуги по сегменту), затем вернуть `АктивныйАбонементJSON`.

## POST `/v1/spa/service-sale`

Продажа спа-услуги (платная запись / «к оплате на ресепшене»).

Request JSON:

```json
{
  "externalId": "ff94bf6a-b4d2-11e8-80e9-7085c20c362e",
  "serviceName": "Классический спа-массаж 50 мин",
  "serviceId": "optional",
  "bookingRef": "clxxx...",
  "occurredAt": "2026-09-16T15:00:00.000Z",
  "priceMinor": 7500,
  "currency": "BYN",
  "durationMin": 50
}
```

Response `200`: membership JSON (с обновлённым `debtAmount` / лицевым счётом при наличии).

## GET `/v1/specialist-service-debts`

Оказанные услуги с **конкретным** сотрудником (строки **Документ.Продажа** с заполненным **Исполнителем** в ТЧ).

Реализация (быстрый путь): один запрос к `Документ.Продажа.<ТЧ>` + пакет остатков по расчётам для статуса оплаты. Без обхода всех занятий и без `ПолучитьОбъект` на каждый документ.

**Ограничения нагрузки (обязательны):**

- `employeeCode` — **обязателен** (отчёт только по одному специалисту; без кода → `400`).
- Период `from`…`to` — не больше **31 календарного дня** включительно (полный месяц с 31 днём). FitGO UI: режим «день» или «период».

Query: `from`, `to` (YYYY-MM-DD), `employeeCode` (код сотрудника 1С).

Response `200`:

```json
{
  "data": [
    {
      "externalId": "uuid",
      "clientName": "Куделко Д.",
      "serviceName": "Массаж спортивный 40 мин",
      "occurredAt": "2026-09-20T12:00:00",
      "amount": 95,
      "currency": "BYN",
      "employeeCode": "…",
      "employeeName": "Хилькович …",
      "docRef": "000028749#1",
      "paymentStatus": "DEBT"
    }
  ]
}
```

FitGO: live pull `/super-admin/debts` (специалист обязателен; день / период ≤31; фильтр оплаты на UI).

**Обработчики в репо:** `SpecialistServiceDebtsGET` в `FitGOIntegration_HTTP.bsl`, `ДолгиУслугСпециалистовJSON` в `FitGOIntegration_Клиенты.bsl` — вставить в расширение, F7, переопубликовать `fitgo`.

Реализация на Windows: заглушки `ConsumeServicePOST` / `SpaSalePOST` / `SpecialistServiceDebtsGET` в `FitGOIntegration_HTTP.bsl` + бизнес-функции в `FitGOIntegration_Клиенты.bsl`. До публикации проверять `curl -sk` с Mac по 1c-debug-protocol.
