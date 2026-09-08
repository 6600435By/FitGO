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

## C. hoster.by VPS (рекомендуется — без VPN с Mac)

**Зачем:** MikroTik пускает к 1С IP сайта клуба **`87.232.64.100` (ffs.by / hoster.by)**.  
API на этом же хостере (тот же или соседний VPS **со статическим IP в whitelist**) ходит в 1С сам; Mac открывает только публичный FitGO API по HTTPS — VPN не нужен.

**Не подходит «из коробки»:** Railway/Render с плавающим egress — пока IP не добавят в MikroTik.

### Нужно от тебя один раз

1. VPS hoster.by (Ubuntu 22.04): Node 20, pnpm, PM2, Nginx, Postgres (или managed).
2. SSH: `user@vps-host` (ключ или пароль) — передать агенту / завести в `~/.ssh/config` как `fitgo-vps`.
3. DNS: `api.<домен>` и `app.<домен>` → IP VPS (или сначала IP + self-signed для smoke).

### На VPS

```bash
git clone <repo> FitGO && cd FitGO
# apps/api/.env — см. блок ниже (публичный IP клуба, НЕ 192.168.1.20)
pnpm install
pnpm --filter @fitgo/shared-types build
pnpm --filter @fitgo/1c-adapter build
pnpm --filter @fitgo/osmi-adapter build
pnpm --filter @fitgo/api exec prisma generate
pnpm db:push && pnpm db:seed   # с DATABASE_URL прода
pnpm --filter @fitgo/api build && pnpm --filter @fitgo/web build
pm2 start deploy/ecosystem.config.cjs && pm2 save
# Nginx: deploy/nginx/*.template → certbot
```

Обновления: `bash scripts/deploy-vps.sh`

### Env API на whitelist-хосте (прод)

С сервера в интернете 1С доступна по **публичному** IP клуба (NAT), не по LAN:

```env
FITNESS_PROVIDER=forma
FORMA_BASE_URL=https://86.57.152.242:444/forma/hs/api/v3
FORMA_FITGO_URL=https://86.57.152.242:8445/fitgo/hs/fitgo/v1
FORMA_API_KEY=...
FORMA_BASIC_AUTH=...
FORMA_CLUB_ID=97f057be-defe-11e6-af15-784561bf6e7c
NODE_TLS_REJECT_UNAUTHORIZED=0
CORS_ORIGIN=https://app.<домен>
JWT_SECRET=<≥32 chars>
DATABASE_URL=postgresql://...
```

| Откуда API | FORMA_* host |
|------------|--------------|
| Mac + VPN / LAN клуба | `192.168.1.20` |
| VPS в интернете (hoster) | `86.57.152.242` |

Web build: `NEXT_PUBLIC_API_URL=https://api.<домен>` (без `/api`).

### Smoke после выкладки

С VPS: `curl -sk https://86.57.152.242:8445/fitgo/hs/fitgo/v1/health` + ключи → 200.  
С Mac **без VPN**: `https://api.<домен>/api/...` login → card/visits.
