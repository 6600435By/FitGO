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

В `apps/api/.env`:

```env
FITNESS_PROVIDER=1c
ONEC_BASE_URL=https://your-club-1c.example.com
ONEC_API_KEY=your-api-key
```

## Структура

```
apps/
  api/     # NestJS REST API
  web/     # Next.js (client / trainer / admin)
packages/
  1c-adapter/    # IFitnessClubProvider + mock + 1C
  shared-types/  # общие TypeScript типы
```
