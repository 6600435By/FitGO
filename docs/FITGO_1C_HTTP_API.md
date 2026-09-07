# FitGO ↔ 1С HTTP API v1

Кастомный HTTP-сервис **FitGOIntegration** в расширении 1С.

**Base URL (WS2016):** `https://<host>:8445/fitgo/hs/fitgo/v1`  
**Dev stub:** `http://127.0.0.1:3045/fitgo/v1` (см. `scripts/fitgo-integration-dev-stub.mjs`)

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

Активный абонемент + данные лицевого счёта для карточки клиента (те же поля, что 1С отдаёт в OSMI).

```json
{
  "data": {
    "id": "membership-id",
    "name": "Безлимит 12 мес",
    "status": "ACTIVE",
    "visitsRemaining": 10,
    "visitsTotal": 12,
    "validFrom": "2026-01-01",
    "validUntil": "2026-12-31",
    "services": [
      { "name": "Групповые программы", "unlimited": true },
      { "name": "Массаж классический", "remaining": 1, "total": 4 }
    ],
    "accountBalance": 45.5,
    "debtAmount": 0,
    "currency": "BYN"
  }
}
```

| Поле | Описание |
|------|----------|
| `services[]` | Включённые услуги / квоты (`name`, опционально `remaining`/`total`/`unlimited`) |
| `accountBalance` | Остаток лицевого счёта клиента |
| `debtAmount` | Задолженность |
| `currency` | Валюта (например `BYN`) |

Допускается алиас `serviceQuotas` с полем `serviceName` (как в `/packages`) — адаптер FitGO нормализует в `services`.

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

- `getClientByPhone(phone)` / provider `findClientByPhone` → `/client?phone=` (привязка CRM)
- `getMembership(externalId)` → `/membership?externalId=`
- `getVisits(externalId)` → `/visits?externalId=`
- `getAccessCard(externalId)` → `/card?externalId=`

Расписание и запись — штатный `FORMA_BASE_URL` (API v3).

## Зонд

```powershell
cd C:\fitgo-probe
.\probe-fitgo-api.ps1
```
