# FitGO — платформенная архитектура

**Статус:** черновик, допускает изменения по мере пилота Forma (ffs.by).  
**Данные:** см. `apps/api/prisma/schema.platform-draft.prisma` (не подключён к migrate до явного решения).

---

## 1. Видение

FitGO — **платформа**, к которой подключаются клубы по запросу. Сейчас эталон — **Forma** (1С «Фитнес клуб ПРОФ»). Другие клубы могут получить:

| Модель | Описание |
|--------|----------|
| **SaaS** | Один инстанс FitGO, много клубов, изоляция по `clubId` |
| **Dedicated** | Отдельный деплой (свой домен и БД), тот же код |

Клиентское приложение **универсальное**: пользователь может состоять в нескольких клубах и переключать активный клуб. Интеграции — через адаптеры (сейчас 1С, позже другие CRM/ERP).

**Клиенты:** Web (Next.js) сейчас → iOS/Android позже на **том же API** (monorepo `shared-types` + API client).

---

## 2. Принципы эволюции схемы

1. **Черновик отдельно** — `schema.platform-draft.prisma` не ломает текущий `schema.prisma` до ревью.
2. **Миграции маленькими шагами** — сначала `ClubIntegration`, потом sync, потом `ClubMembership`.
3. **`configVersion` + JSON** — поля интеграции версионируются; смена формата config без Big Bang.
4. **Deprecate, не удалять сразу** — `Club1CConfig` живёт параллельно, пока Forma не переедет на `ClubIntegration`.
5. **Источник истины по клубным данным** — CRM клуба (1С); FitGO хранит кэш, агрегаты и платформенные фичи (геймификация, чат).

---

## 3. Границы сервисов (NestJS)

```
┌──────────────────────────────────────────────────────────────┐
│  apps/api (BFF)                                              │
├──────────────────────────────────────────────────────────────┤
│  IdentityModule      │ JWT, login, activeClubId в токене     │
│  ClubModule          │ Club, theme, slug, публичный профиль  │
│  MembershipModule    │ ClubMembership, смена клуба клиентом  │
│  IntegrationModule   │ ClubIntegration, секреты, health      │
│  FitnessGateway      │ IFitnessClubProvider per clubId       │
│  SyncModule          │ workers: sales, visits, stats         │
│  AnalyticsModule     │ чтение кэша PostgreSQL для дашбордов   │
│  ClientModule        │ ЛК: schedule, membership, visits        │
│  AdminModule         │ staff в рамках clubId                 │
└──────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
   PostgreSQL                      Redis (кэш, очереди)
         │
         ▼
   Club CRM HTTP (1С Forma :8445, др. адаптеры)
```

### Ответственность

| Сервис | Делает | Не делает |
|--------|--------|-----------|
| **Identity** | Аутентификация, `activeClubId` | Запросы в 1С |
| **Membership** | Связь user ↔ club, `externalId` в CRM клуба | Хранение продаж |
| **Integration** | CRUD настроек клуба, probe `/health` | Бизнес-логика UI |
| **FitnessGateway** | Выбор адаптера по `clubId`, вызов provider | Прямой SQL к 1С |
| **Sync** | Фон: pull `/sales`, `/stats/*`, upsert кэш | Синхронный sync в HTTP request |
| **Analytics** | Агрегаты для admin/super-admin из БД | Ручной `DailyReport` (legacy) |

### Пакеты monorepo

| Пакет | Роль |
|-------|------|
| `@fitgo/1c-adapter` | `IFitnessClubProvider`, forma, analytics-http |
| `@fitgo/shared-types` | DTO для web + mobile |
| `packages/api-client` *(план)* | Typed fetch к Nest API |

---

## 4. Модель данных (кратко)

### Сейчас (`schema.prisma`)

- `Club` — клуб на платформе  
- `User.clubId` — **один клуб на пользователя** (ограничение для мультиклуба)  
- `Club1CConfig` — упрощённые URL/ключи (глобальный env дублирует это)  
- `DailyReport` — ручная выручка (заменить sync)  
- `ClubVisit`, геймификация — с `userId` + неявный клуб через `User.clubId`

### Цель (draft)

| Модель | Назначение |
|--------|------------|
| `ClubIntegration` | Адаптер + зашифрованный config + capabilities |
| `ClubMembership` | User в клубе + `externalId` CRM + статус |
| `User.activeClubId` | Текущий клуб в UI (опционально = единственный membership) |
| `IntegrationSyncState` | Курсор/время последнего sync по ресурсу |
| `IntegrationRequestLog` | Операционный лог HTTP (без PII) |
| `SaleTransaction` | Кэш строк продаж из analytics API |
| `ClubDailyStats` | Дневная выручка (замена `DailyReport`) |

Полные поля — в `schema.platform-draft.prisma`.

---

## 5. Смена клуба клиентом

```
1. POST /auth/login → JWT { sub, activeClubId }
2. GET  /me/memberships → список клубов
3. POST /me/active-club { clubId } → новый JWT
4. Все /client/* читают activeClubId + ClubMembership.externalId
```

Правило безопасности: **`clubId` из JWT**, не из body без проверки membership.

---

## 6. Интеграции

### Типы провайдеров (enum, расширяемый)

| `providerType` | Клуб | Возможности |
|----------------|------|-------------|
| `FORMA_1C` | Forma | schedule, crm, sales, visits, card |
| `FORMA_WP` | Forma (legacy) | schedule only |
| `GENERIC_1C` | Другой клуб на 1С | по контракту FitGO HTTP v1 |
| `MOCK` | Dev/demo | all |

Config хранится в `ClubIntegration.config` (JSON) + `secretsEncrypted` (apiKey, basicAuth).  
**Не** класть секреты в git и plain JSON без шифрования на prod.

### Forma (эталон)

```
ClubIntegration (FORMA_1C)
  config.baseUrl      → .../fitgo/hs/api/v3
  config.fitgoUrl     → .../fitgo/hs/fitgo/v1
  config.analyticsUrl → .../fitgo/hs/analytics/v1
  secrets.apiKey, secrets.basicAuth
```

---

## 7. Sync и кэш

| Ресурс | Источник | Таблица | Интервал (старт) |
|--------|----------|---------|------------------|
| Продажи | `GET /sales` | `SaleTransaction` | 15–60 мин |
| Рейтинг админов | `GET /stats/employees` | `EmployeePeriodStats` *(draft)* | 1 ч |
| Дневная выручка | `GET /stats/daily` | `ClubDailyStats` | 1 ч |
| Визиты клиента | `GET /visits` | on-demand + `ClubVisit` | по запросу / nightly |

`IntegrationSyncState` — одна строка на пару `(clubIntegrationId, resourceKey)`.

---

## 8. Хранение и инфраструктура

| Компонент | Назначение | Когда |
|-----------|------------|-------|
| **PostgreSQL** | Основные данные | Сейчас |
| **Redis** | Кэш CRM, BullMQ jobs, rate limit | После multi-club |
| **S3 / R2** | `ClubTheme.logoUrl`, экспорты | По необходимости |
| **Secret manager** | Master key для `secretsEncrypted` | Prod |

### Логи

| Что | Где | Retention |
|-----|-----|-----------|
| HTTP к клубу (метаданные) | `IntegrationRequestLog` | 30–90 дней |
| Staff действия | `StaffAuditLog` | дольше |
| Apache / 1С | На сервере клуба | у клуба |

---

## 9. Mobile (будущее)

- **Expo / React Native** + общий `shared-types` и API client.  
- Push: FCM/APNs → Nest `NotificationsModule`.  
- Никаких прямых вызовов 1С с телефона — только FitGO API.  
- Secure storage для JWT (Keychain / Keystore).

---

## 10. План миграции с текущей схемы

| Шаг | Действие | Риск |
|-----|----------|------|
| 1 | Добавить `ClubIntegration`, перенести Forma из `.env` | Низкий |
| 2 | `FitnessGateway` читает integration по `clubId` | Средний |
| 3 | `IntegrationSyncState` + worker для sales | Средний |
| 4 | `ClubMembership` + `activeClubId`; миграция `User.externalId` | Средний |
| 5 | Deprecate `Club1CConfig`, `DailyReport` | Низкий |
| 6 | Redis + request logs | Низкий |

Forma на шаге 1–2 может оставаться **единственным** клубом — схема уже мультиклубная.

---

## 11. Связанные документы

| Документ | Репозиторий |
|----------|-------------|
| HTTP API клуба (1С) | `docs/FITGO_1C_HTTP_API.md` |
| Публикация Forma | `docs/SERVER_1C_FITGO_PUBLICATION.md` |
| Analytics API | `fitgo-probe/docs/ANALYTICS_ROLES_AND_API.md` |
| Draft Prisma | `apps/api/prisma/schema.platform-draft.prisma` |

---

## 12. Как менять этот документ

При изменении логики:

1. Обновить секцию, которая затронута.  
2. Добавить запись в **Changelog** (ниже).  
3. Синхронизировать `schema.platform-draft.prisma`.  
4. Реализацию в Nest — только после стабилизации полей draft.

### Changelog

| Дата | Изменение |
|------|-----------|
| 2026-06-17 | Первая версия: мультиклуб, интеграции, sync, mobile path |
| 2026-06-17 | Review+QA skill: сверка кода с этим документом и `schema.platform-draft.prisma` |
