# FitGO specialist-web (портал SPA-специалиста)

Лёгкий Next.js-клиент: вход, журнал записей, «Моя ЗП». API — на **СП** (Windows рядом с 1С) по публичному HTTPS.

## Локально

```bash
# из корня monorepo
pnpm install
pnpm --filter @fitgo/shared-types build
NEXT_PUBLIC_API_URL=http://localhost:3001 pnpm --filter @fitgo/specialist-web dev
# http://localhost:3012
```

Нужен API с ролью SPECIALIST и CORS, включающим `http://localhost:3012`.

## Cloudflare Pages

1. Create project → connect GitHub repo FitGO.
2. **Root directory:** `apps/specialist-web`
3. Build: `cd ../.. && pnpm install && pnpm --filter @fitgo/shared-types build && pnpm --filter @fitgo/specialist-web build`
   (или упрощённый: framework Next, build command через monorepo — см. Pages docs / `pnpm --filter`).
4. Env: `NEXT_PUBLIC_API_URL=https://fitgo-api.YOURDOMAIN` (без `/api`).
5. На СП в `CORS_ORIGIN` добавьте `https://<project>.pages.dev` (и кастомный домен).

Сертификат API должен быть **доверенным** (Let's Encrypt). Самоподписанный `:8445` браузер заблокирует.

## Дизайн

Светлая/тёмная тема (переключатель в шапке). Шрифты Fraunces + DM Sans, спокойный SPA-акцент — не «вайб» purple/cream.
