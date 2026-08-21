# FitGO ↔ 1С HTTP API v1

Кастомный HTTP-сервис **FitGOIntegration** в расширении 1С.

**Base URL:** `https://<host>:445/fitgo/hs/fitgo/v1`

## Авторизация

Заголовки (как API v3):

- `apikey: <FORMA_API_KEY>`
- `Authorization: Basic <FORMA_BASIC_AUTH>`

## Формат ответа

Успех:

```json
{ "data": { ... } }
```

Ошибка:

```json
{ "error": { "code": 404, "message": "Client not found" } }
```

## Эндпоинты

### GET `/health`

```json
{ "data": { "status": "ok" } }
```

### GET `/client`

Query: `phone` или `externalId` (GUID клиента в 1С).

**MVP** (тест: `phone=375296600435`):

```json
{
  "data": {
    "externalId": "uuid",
    "firstName": "Иван",
    "lastName": "Иванов",
    "phone": "375296600435",
    "email": "client@example.com"
  }
}
```

**Фаза 1b** (доп. поля со стола администратора — см. `fitgo-probe/docs/1C_ADMIN_DESK_CLIENT_VIEW.md`):

```json
{
  "data": {
    "externalId": "uuid",
    "firstName": "Иван",
    "lastName": "Иванов",
    "phone": "375296600435",
    "age": 35,
    "visitCount": 42,
    "lastVisitAt": "2026-06-17T09:00:00",
    "alerts": []
  }
}
```

### GET `/membership`

Query: `phone` или `externalId`.

```json
{
  "data": {
    "id": "membership-id",
    "name": "Безлимит 12 мес",
    "status": "ACTIVE",
    "visitsRemaining": 10,
    "visitsTotal": 12,
    "validFrom": "2026-01-01",
    "validUntil": "2026-12-31"
  }
}
```

`data: null` — нет активного абонемента.

### GET `/packages` (фаза 1b)

Несколько членств/пакетов на клиента (как на столе администратора).

Query: `phone` или `externalId`.

```json
{
  "data": [
    {
      "id": "uuid",
      "name": "VIP (3 месяца)",
      "status": "ACTIVE",
      "validUntil": "2026-06-20",
      "serviceQuotas": [
        { "serviceName": "Солярий", "remaining": 0, "saleType": "service" },
        { "serviceName": "Массаж классический общий", "remaining": 1, "saleType": "service" },
        { "serviceName": "Групповые программы", "unlimited": true }
      ]
    }
  ]
}
```

Статусы пакета: `ACTIVE`, `SOLD_PENDING_ACTIVATION`, `EXPIRED`.

### GET `/visits`

Query: `phone` или `externalId`; опционально `from`, `to` (ISO date).

```json
{
  "data": [
    {
      "id": "visit-1",
      "date": "2026-05-20",
      "checkIn": "2026-05-20T10:00:00",
      "checkOut": "2026-05-20T11:00:00",
      "clubName": "Форма",
      "title": "Йога"
    }
  ]
}
```

### GET `/card`

Query: `phone` или `externalId`.

```json
{
  "data": {
    "id": "card-1",
    "barcode": "1234567890",
    "clientName": "Иван Иванов",
    "clubName": "Форма"
  }
}
```

## Маппинг в FitGO

Реализовано в `packages/1c-adapter/src/fitgo-http-provider.ts`:

- `getMembership(externalId)` → `/membership?externalId=`
- `getVisits(externalId)` → `/visits?externalId=`
- `getAccessCard(externalId)` → `/card?externalId=`

Расписание и запись — штатный `FORMA_BASE_URL` (API v3).

## Зонд

```powershell
cd C:\fitgo-probe
.\probe-fitgo-api.ps1
```
