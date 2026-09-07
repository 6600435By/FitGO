# FitGO Deploy Handoff

Контекст для первого деплоя API/web без правок таймера / PT sheet.

## Цель

Вынести Nest API (+ web) с Mac на хостинг, чей **egress IP в whitelist MikroTik** клуба (сейчас сайт клуба: **ffs.by → 87.232.64.100**, hoster.by). Тогда 1С доступна без домашнего VPN.

## Варианты

| ID | Стек | Когда |
|----|------|--------|
| A | Vercel (web) + Railway (api + Postgres) | Быстрый тест |
| B | Railway all-in-one (web + api + Postgres) | Один вендор |
| C | hoster.by VPS (PM2 + Nginx) | Близко к ffs.by / тот же хостер |

Конфиги в репозитории: `apps/*/railway.toml`, `apps/web/vercel.json`, `deploy/*`, `scripts/deploy-vps.sh`.  
Пошагово: [DEPLOY.md](DEPLOY.md).

## Whitelist 1С

- С Mac: VPN → `192.168.1.20:444` (forma) / `:8445` (fitgo, после публикации).
- С хостинга: IP `87.232.64.100` (ffs.by) уже в MikroTik allow-list для 1С.
- После деплоя API на hoster/Railway: убедиться, что **исходящий** IP сервера API тоже в whitelist (Railway — плавающий; VPS hoster — стабильнее для 1С).

## Чеклист после deploy

- Логин `trainer@demo.fitgo` / `trainer123`
- Персональная сессия, таймер разминки
- Мобильный браузер
- Сохранение листа
- Client schedule (forma) при `FITNESS_PROVIDER=forma` + VPN/whitelist

## Не трогать при первом deploy

- `workout-timer*`, prep-block, PT sheet editors (если нет отдельной задачи)
