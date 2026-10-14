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

Доп. поля заморозки (не у всех тарифов):

| Поле | Описание |
|------|----------|
| `freezeAllowed` | `true` — у абонемента есть функция заморозки; `false` — скрыть UI |
| `freezeDaysRemaining` | остаток дней (если `freezeAllowed`) |
| `freezeDaysTotal` | лимит по тарифу (если известен) |
| `frozenUntil` | дата окончания текущей заморозки (если `status=FROZEN`) |

### GET `/memberships/expiring`

Query: `days` (1…60, default 14).

Список абонементов со `СрокДействия` в окне **`[сегодня−7; сегодня+days]`** (lookback 7 дней — чтобы открытые задачи продления ещё видели уже купленный следующий абонемент после окончания срока). Для каждого клиента — один текущий (ближайший срок), опционально `nextMembership` и флаг `renewed`.

Статус «Продан» / неактивированный → `PENDING`. Lookback допускает `EXPIRED`/`CLOSED`; вперёд по окну — только `ACTIVE`/`FROZEN`.

```json
{
  "data": [
    {
      "externalId": "client-uuid",
      "firstName": "Иван",
      "lastName": "Иванов",
      "phone": "375296600435",
      "docId": "membership-doc-uuid",
      "name": "Безлимит 12 мес",
      "status": "ACTIVE",
      "validFrom": "2026-01-01",
      "validUntil": "2026-04-15",
      "visitsRemaining": 10,
      "kind": "membership",
      "termDays": 365,
      "totalUnits": null,
      "oneOff": false,
      "renewed": false,
      "nextMembership": null
    },
    {
      "externalId": "other-uuid",
      "firstName": "Мария",
      "lastName": "Петрова",
      "phone": "375291112233",
      "docId": "membership-a",
      "name": "Утро 6 мес",
      "status": "ACTIVE",
      "validFrom": "2025-10-01",
      "validUntil": "2026-04-10",
      "kind": "membership",
      "termDays": 183,
      "totalUnits": null,
      "oneOff": false,
      "renewed": true,
      "nextMembership": {
        "docId": "membership-b",
        "name": "Безлимит 12 мес",
        "status": "PENDING",
        "validFrom": "2026-04-11",
        "validUntil": "2027-04-10"
      }
    }
  ]
}
```

| Поле | Описание |
|------|----------|
| `docId` | UUID документа членства (дедуп ключ задач продления) |
| `kind` | `membership` \| `package` (из `ТипЧленстваПакетаУслуг`) |
| `termDays` | Срок действия в днях (из `СрокДействия`+тип или `validUntil − validFrom`) |
| `totalUnits` | Сумма квот `СоставУслуг.Количество`, если нет безлимита; иначе `null` |
| `oneOff` | `true` если `termDays ≤ 1` или `totalUnits = 1` — такие строки 1С **не отдаёт** (фильтр на стороне сервиса) |
| `nextMembership` | Уже купленный следующий абонемент (тот же `kind`) или `null`. В т.ч. статус «Продан» без даты активации |
| `renewed` | `true` если есть `nextMembership` или колонка «Продлено» на документе. FitGO не создаёт задачу и закрывает открытую как `RENEWED` |
| `phone` | Телефон для звонка админом |

Разовые услуги / пакеты / членства (1 день или 1 посещение) в ответ не входят. Nest дополнительно отфильтровывает `oneOff` на случай старой публикации BSL. Новые задачи создаются только при `daysLeft ≥ 0` (lookback-строки служат для закрытия уже открытых).

В конфигураторе: шаблон `/v1/memberships/expiring`, метод GET → `MembershipsExpiringGET`.

### POST `/memberships/renewal-coverage`

Пачка проверки покрытия для открытых задач продления, чей документ уже вышел из окна `expiring` (даже с lookback). FitGO вызывает один раз за sync.

Body:

```json
{
  "items": [
    {
      "externalId": "client-uuid",
      "docId": "membership-doc-uuid",
      "validUntil": "2026-10-09"
    }
  ]
}
```

Ответ:

```json
{
  "data": [
    {
      "externalId": "client-uuid",
      "docId": "membership-doc-uuid",
      "covered": true,
      "reason": "next_sold",
      "currentValidUntil": "2026-10-09",
      "nextMembership": {
        "docId": "membership-next",
        "name": "Безлимит (1 месяц)",
        "status": "PENDING",
        "validFrom": "",
        "validUntil": ""
      }
    }
  ]
}
```

| Поле | Описание |
|------|----------|
| `covered` | `true` → закрыть задачу стадией `RENEWED` (`next_sold` / `next_active` / `marked`) |
| `reason` | `next_sold` — куплен следующий (Продан/не активирован); `next_active` — следующий уже активен с более поздним сроком; `marked` — колонка «Продлено»; `extended` — тот же документ с более поздним `СрокДействия` (заморозка/сдвиг: Nest обновляет `validUntil`, задачу не закрывает); пусто — не покрыт |
| `currentValidUntil` | Живой срок документа задачи (календарный `yyyy-MM-dd`) |
| `nextMembership` | Кратко о следующем документе или `null` |

В конфигураторе: шаблон `/v1/memberships/renewal-coverage`, метод POST → `MembershipsRenewalCoveragePOST`.

### GET `/memberships` (planned — bulk snapshots)

Query: `changedSince` (ISO datetime, optional), `page`, `pageSize`.

Пакетная выгрузка абонементов для кэша `ClubMembershipSnapshot` в FitGO (ночная/ручная club sync). Пока эндпоинта нет — FitGO обходит клиентов через `GET /membership` с rate-limit.

```json
{
  "data": [
    {
      "externalId": "uuid",
      "status": "ACTIVE",
      "packageName": "…",
      "validFrom": "2026-01-01",
      "validUntil": "2026-12-31",
      "freezeAllowed": true,
      "debtAmount": 0,
      "services": []
    }
  ],
  "page": 1,
  "pageSize": 100,
  "total": 0
}
```

### POST `/membership/freeze`

Создаёт и проводит документ «Операция с членством, пакетом услуг» с операцией **Заморозка**. Срок действия абонемента увеличивается на `days`.

Тело:

```json
{
  "externalId": "uuid",
  "days": 3,
  "fromDate": "2026-09-08"
}
```

`fromDate` опционален (default — сегодня). Либо `phone` вместо `externalId`.

Успех: `{ "data": { ...membership... } }` (как GET, обычно `status: FROZEN`).

Ошибки: `400` (days / fromDate), `404`, `409` (freeze не доступна / уже заморожен).

BSL: `FitGOIntegrationКлиенты.ЗаморозитьАбонемент` → `Документ.ОперацииСЧленствомПакетомУслуг`; полный модуль HTTP — [`scripts/windows/FitGOIntegration_HTTP.bsl`](../scripts/windows/FitGOIntegration_HTTP.bsl).

Bindings (scan Куделко VIP, 2026-09-08):

- `freezeDaysTotal` ← `ЧленствоПакетУслуг.КоличествоДнейЗаморозок` (7)
- `freezeDaysRemaining` ← `РН.ЧленстваПакетыУслуг.Остатки.КоличествоДнейЗаморозокОстаток` (4) — **не** `ДнейДополнительноОстаток`
- `freezeAllowed` ← `КоличествоДнейЗаморозок > 0`

### GET `/packages`

Несколько членств/пакетов на клиента (абонемент зала **и** отдельный блок массажей /
`ЧленствоПакетУслуг`). Используется SPA-записью вместе с `GET /membership`
(в membership.services квоты уже сводятся по всем пакетам после обновления BSL).

Query: `phone` или `externalId`. Обработчик: `PackagesGET` → `ПакетыКлиентаJSON`.

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

Без клиента, с `from`+`to` (+ `page`, `pageSize`): клубная страница `{ data, page, pageSize, total }` — у каждой строки есть `externalId` контрагента.

```json
{
  "data": [
    {
      "id": "visit-1",
      "date": "2026-05-20",
      "checkIn": "2026-05-20T10:00:00",
      "checkOut": "2026-05-20T11:00:00",
      "clubName": "Форма",
      "title": "Йога",
      "kind": "GROUP",
      "basisType": "class"
    }
  ]
}
```

Поля классификации (FitGOIntegration):

| Поле | Значения | Смысл |
|------|----------|--------|
| `kind` | `GYM` \| `GROUP` \| `PT` \| `SPA_MASSAGE` \| `SPA_BODYCOMP` \| `SOLARIUM` \| `UNKNOWN` | Тип визита |
| `basisType` | `membership` \| `class` \| `service` \| `other` | Тип основания в 1С |

Nest мапит `kind`/`basisType` (с эвристикой по `title`, если поля нет). Опционально позже: `serviceCode`, `classId`, `membershipId`.

### GET `/class-sessions`

Query: `from`, `to`, `page`, `pageSize`. Документы «Занятие» за период (ГП / ПТ / спа): статус, сотрудник, зал, состав с явкой. См. [FitGOIntegration_CLASS_SESSIONS_SPEC.md](../scripts/windows/FitGOIntegration_CLASS_SESSIONS_SPEC.md).

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
- `getMembership(externalId)` → `/membership?externalId=` (services = свод квот по пакетам)
- `getClientPackages(externalId)` → `/packages?externalId=`
- `freezeMembership(externalId, days, fromDate?)` → `POST /membership/freeze`
- `getVisits(externalId)` → `/visits?externalId=`
- `getAccessCard(externalId)` → `/card?externalId=`

Расписание и запись — штатный `FORMA_BASE_URL` (API v3).

## Зонд

```powershell
cd C:\fitgo-probe
.\probe-fitgo-api.ps1
```

Freeze (осторожно, пишет в 1С — только тест-клиент):

```powershell
# после проверки GET membership.freezeAllowed=true
curl.exe -sk -X POST -H "apikey: ..." -H "Authorization: Basic ..." `
  -H "Content-Type: application/json" `
  -d "{\"externalId\":\"$extId\",\"days\":1,\"fromDate\":\"2026-09-08\"}" `
  "$base/membership/freeze"
```
