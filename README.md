# FITGO

Платформа для фитнес-клубов: клиентский кабинет (PWA), кабинет тренера и панель администратора. Интеграция с 1С:Фитнес через adapter pattern (mock по умолчанию).

## Стек

- **Monorepo:** Turborepo + pnpm
- **Backend:** NestJS + Prisma + PostgreSQL
- **Frontend:** Next.js 15 (App Router) + Tailwind CSS
- **1C:** `@fitgo/1c-adapter` (Mock1CProvider / OneCFitnessProvider)

## Быстрый старт

### 1. Зависимости

```bash
pnpm install
```

### 2. База данных

```bash
cp .env.example apps/api/.env
docker compose up -d
pnpm db:generate
pnpm db:push
pnpm db:seed
```

### 3. Запуск

```bash
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:3001

## Демо-аккаунты

| Роль | Email | Пароль |
|------|-------|--------|
| Клиент | client@demo.fitgo | client123 |
| Тренер | trainer@demo.fitgo | trainer123 |
| Админ | admin@demo.fitgo | admin123 |

## Переключение на реальный 1С

### Forma API v3 (виджет planvueplugin)

В `apps/api/.env`:

```env
FITNESS_PROVIDER=forma
FORMA_BASE_URL=https://your-club-server:444/forma/hs/api/v3
FORMA_API_KEY=your-api-key
FORMA_BASIC_AUTH=base64-credentials-without-Basic-prefix
FORMA_DEFAULT_PASSWORD=club-client-password
```

`Club.externalId` в БД должен содержать UUID клуба из 1С (`club_id`).

### WordPress proxy (рекомендуется для ffs.by / planvueplugin)

Тот же путь, что у виджета `planvueplugin` на сайте клуба — через `admin-ajax.php`:

```env
FITNESS_PROVIDER=forma-wp
FORMA_WP_AJAX_URL=https://ffs.by/wp-admin/admin-ajax.php
```

FitGO API вызывает те же action (`getGroups`, `authClient`, `clientToClass`, `clientFromClass`), что и виджет на WordPress. Credentials 1С остаются в PHP-плагине на сервере клуба.

> **Важно:** `FITNESS_PROVIDER=mock` — только демо-расписание без связи с ffs.by. Для продакшена/club-сайта используйте `forma-wp`.

### Generic REST API

В `apps/api/.env`:

```env
FITNESS_PROVIDER=1c
ONEC_BASE_URL=https://your-club-1c.example.com
ONEC_API_KEY=your-api-key
```

## Персональные тренировки

Запись к тренерам FitGO (без 1С): тренер заполняет график в `/trainer/work-schedule`, клиент записывается в `/client/personal-training`.

## Структура

```
apps/
  api/     # NestJS REST API
  web/     # Next.js (client / trainer / admin)
packages/
  1c-adapter/    # IFitnessClubProvider + mock + 1C
  shared-types/  # общие TypeScript типы
```
