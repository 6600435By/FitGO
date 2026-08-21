# FitGO QA checklist (reference for Review + QA subagent)

## Demo accounts (README)

| Role | Email | Password |
|------|-------|------------|
| Client | client@demo.fitgo | client123 |
| Trainer | trainer@demo.fitgo | trainer123 |
| Admin | admin@demo.fitgo | admin123 |

API base: `http://localhost:3001/api` · Web: `http://localhost:3000`

## Critical flows to trace when related code changed

### Auth & roles
- Login returns JWT; CLIENT / TRAINER / ADMIN routes guarded
- Cross-role access denied (client cannot hit trainer endpoints)

### Client
- Dashboard, schedule (group + personal), bookings, booking history
- Personal training: book slot, open session plan, set goals/tasks, confirm, complete
- Profile wizard, engagement/gamification, workouts log
- Cancel booking (group vs personal, fitgo vs 1c source)

### Trainer
- Dashboard loads without 500 (forma-wp + mock externalId edge case)
- Client list, client detail: sessions history filtered by trainer
- Session plan: view/edit client goals, confirm tasks, complete session
- Work schedule, personal bookings, messages

### Admin
- Dashboard stats, at-risk clients, notifications

### Integrations (`FITNESS_PROVIDER`)
- `mock` — demo schedule/visits
- `forma-wp` — ffs.by proxy; invalid trainer externalId must not 500 dashboard
- `forma` + `FORMA_FITGO_URL` — composite provider (CRM from club HTTP)
- Never create/cancel real external bookings during QA unless user explicitly allows

## Platform architecture & Prisma draft (Review+QA)

**Canonical docs (always know paths):**

| File | Role |
|------|------|
| `docs/PLATFORM_ARCHITECTURE.md` | Мультиклуб, сервисы, sync, changelog |
| `apps/api/prisma/schema.platform-draft.prisma` | Черновик моделей (не migrate) |
| `apps/api/prisma/schema.prisma` | Текущая применённая схема |

### Platform triggers — запускать сверку, если diff затрагивает:

- `apps/api/prisma/**` (любые изменения schema / migrate)
- `packages/1c-adapter/**` (providers, factory, analytics-http, fitgo-http)
- `apps/api/src/fitness/**`, `integration*`, `sync*`, `analytics*` (если появятся)
- `Club`, `clubId`, `externalId`, `Club1CConfig`, membership, active club
- `docs/PLATFORM_ARCHITECTURE.md`, `schema.platform-draft.prisma`
- env: `FORMA_*`, `FITNESS_PROVIDER`, `ONEC_*`
- fitgo-probe integration contracts referenced from FitGO docs

### Что проверять

| Вопрос | Действие при расхождении |
|--------|--------------------------|
| Новая таблица/поле в `schema.prisma` без draft? | Предложить зеркало в `schema.platform-draft.prisma` + строка в Changelog |
| Реализация противоречит границам сервисов (§3 architecture)? | Предложить правку §3 или кода |
| Новый `providerType` / endpoint клуба? | Предложить enum в draft + таблицу в §6 architecture |
| Нарушена изоляция `clubId` (IDOR, query без club)? | Finding 🔴 + предложить правило в architecture |
| Устарел план миграции (§10)? | Предложить обновить шаги / отметить выполненное |
| `Club1CConfig` vs `ClubIntegration` | Напомнить deprecate path; не дублировать без причины |

### Формат предложений в отчёте

Для каждой нужной правки:

```
- [PLATFORM_ARCHITECTURE.md §N] кратко что изменить
- [schema.platform-draft.prisma Model X] добавить поле Y / enum Z (@evolution: …)
```

Не переносить draft → `schema.prisma` в ревью — только отметить «готово к migrate» или «сначала обновить draft».

## API smoke pattern

```bash
# Login
curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"trainer@demo.fitgo","password":"trainer123"}'

# Use accessToken
curl -s http://localhost:3001/api/trainer/dashboard \
  -H "Authorization: Bearer <token>"
```

## Common regression areas

- `shared-types` out of sync with API DTOs / Prisma enums
- PersonalBookingStatus lifecycle (CONFIRMED / CANCELLED / COMPLETED)
- Trainer CRM `sessions` vs old `visits` field
- Prisma schema changed but `db:push` not run
- Frontend links to `/client/personal-bookings/[id]` and `/trainer/sessions/[id]`
