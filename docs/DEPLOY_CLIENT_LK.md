# Клиентский кабинет `lk.ffs.by`

Отдельный Next-процесс `@fitgo/client-web` (:3002), общий Nest API (:3001). Сотрудники остаются на `app.ffs.by` (:3000).

## Один раз на сервере клуба

1. NSSM service **`FitGO-Client`**:  
   `node_modules/next/dist/bin/next start -p 3002`  
   cwd = `...\FitGO\apps\client-web`  
   Env: `NODE_ENV=production`, `NEXT_PUBLIC_API_URL=` (пусто), `FITGO_API_PROXY_TARGET=http://127.0.0.1:3001`
2. Apache: [apache-fitgo-lk-proxy.conf.template](../scripts/windows/fitgo-server/apache-fitgo-lk-proxy.conf.template) → `fitgo-lk-444.conf`, Include в `httpd.conf`.
3. В `apps/api/.env`: `CORS_ORIGIN` включает `https://lk.ffs.by`, `CLIENT_WEB_URL=https://lk.ffs.by`, RocketSMS (см. `fitgo-api.env.example`).
4. Staff web build: `NEXT_PUBLIC_CLIENT_WEB_URL=https://lk.ffs.by` (редирект `/client` и `/register`).

## Hoster

1. Поддомен **`lk`** (отдельный docroot, не WordPress).  
2. SSL Let's Encrypt.  
3. Скопировать [deploy/hoster-wp-proxy-lk/](../deploy/hoster-wp-proxy-lk/) в docroot.

## Обновления (не гасят друг друга)

| Скрипт | Что трогает |
|--------|-------------|
| [Update-FitGO-Staff.ps1](../scripts/windows/fitgo-server/Update-FitGO-Staff.ps1) | только FitGO-Web |
| [Update-FitGO-Client.ps1](../scripts/windows/fitgo-server/Update-FitGO-Client.ps1) | только FitGO-Client |
| [Update-FitGO-API.ps1](../scripts/windows/fitgo-server/Update-FitGO-API.ps1) | FitGO-API + prisma |

Полный [Update-FitGO.ps1](../scripts/windows/fitgo-server/Update-FitGO.ps1) по-прежнему останавливает web+api; для клиентского канала предпочитайте три скрипта выше.

## Анонс на ffs.by

После смоука кабинета: [deploy/ffs-site-banner/](../deploy/ffs-site-banner/).
