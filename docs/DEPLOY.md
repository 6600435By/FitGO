# FitGO — первый deploy

См. также [DEPLOY_HANDOFF.md](DEPLOY_HANDOFF.md).

## 0. Общее

1. Код в GitHub **без** `.env`.
2. Локальная проверка сборки:

```bash
pnpm install
pnpm --filter @fitgo/shared-types build
pnpm --filter @fitgo/1c-adapter build
pnpm --filter @fitgo/osmi-adapter build
pnpm --filter @fitgo/api build
pnpm --filter @fitgo/web build
```

3. БД (прод Postgres):

```bash
pnpm db:generate && pnpm db:push && pnpm db:seed
```

### Env (минимум тестового стенда)

| Переменная | Где | Значение |
|------------|-----|----------|
| `DATABASE_URL` | API | Postgres |
| `JWT_SECRET` | API | ≥32 символов |
| `FITNESS_PROVIDER` | API | сначала `mock`, затем `forma` |
| `CORS_ORIGIN` / `WEB_URL` | API | публичный URL web (`https://…`) |
| `NEXT_PUBLIC_API_URL` | Web **build-time** | публичный URL API **без** `/api` |
| `PORT` | API | задаёт Railway; локально/VPS — `API_PORT=3001` |
| `FORMA_*` | API | при `forma` + whitelist/VPN |

---

## A. Vercel (web) + Railway (api)

1. Railway: New Project → Postgres plugin → Add service from repo, root `apps/api`, `railway.toml`.
2. Env API: `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN`, `FITNESS_PROVIDER=mock`.
3. Generate domain для API.
4. Vercel: Import repo, Root Directory `apps/web`, использует `vercel.json`.
5. Env web: `NEXT_PUBLIC_API_URL=https://<api-domain>` (без `/api`).
6. Redeploy web после смены API URL.
7. `db push` / seed с `DATABASE_URL` прода.

## B. Railway all-in-one

1. Один Project: Postgres + service `api` (`apps/api`) + service `web` (`apps/web`).
2. References: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, web `NEXT_PUBLIC_API_URL` → API public domain.
3. Generate Domain для обоих сервисов.

## C. hoster.by VPS (рекомендуется рядом с ffs.by)

ffs.by уже на hoster.by (`87.232.64.100`). VPS с **статическим IP в whitelist MikroTik** — лучший путь для живой 1С без VPN с Mac.

1. VPS: Node 20, pnpm, PM2, Postgres (или managed Postgres).
2. `git clone` → `.env` в `apps/api/` и root по необходимости.
3. `pnpm install` → build packages → `pnpm --filter @fitgo/api build` → web build.
4. PM2: `pm2 start deploy/ecosystem.config.cjs`
5. Nginx: шаблоны `deploy/nginx/*.template` → certbot → DNS A-записи.
6. Обновить скрипт: `bash scripts/deploy-vps.sh`

## После выкладки на whitelist-IP

```env
FITNESS_PROVIDER=forma
FORMA_BASE_URL=https://192.168.1.20:444/forma/hs/api/v3
FORMA_FITGO_URL=https://192.168.1.20:8445/fitgo/hs/fitgo/v1
NODE_TLS_REJECT_UNAUTHORIZED=0
```

Пока FitGOIntegration не опубликован на `:8445`, membership/card на проде будут пустыми; schedule через forma v3 уже работает.
