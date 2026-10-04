# FitGO: app.ffs.by без VPS (WordPress 2 + Apache `:8445`)

Публичное приложение персонала при тарифе **hoster.by WordPress 2** (нет Node/Postgres на хостинге).  
MikroTik **не меняем**. Канал hoster → клуб уже в whitelist (`87.232.64.100` → `86.57.152.242:444/:8445`).

См. также: [DEPLOY.md](DEPLOY.md), [DEPLOY_HANDOFF.md](DEPLOY_HANDOFF.md), [fitgo-server README](../scripts/windows/fitgo-server/README.md).

## Схема

```text
Телефон ──HTTPS──► app.ffs.by (hoster, Let's Encrypt)
                      │  PHP proxy (deploy/hoster-wp-proxy)
                      │  CURLOPT_RESOLVE app.ffs.by:8445 → 86.57.152.242
                      ▼
               Apache *:8445  NameVirtualHost
                 ├─ Host: app.ffs.by  → Next :3000  → Nest :3001
                 └─ иначе (default)   → 1С /fitgo, /forma (без изменений)
Nest / сайт ──► 127.0.0.1:8445 или :444 ──► default vhost (localhost)
```

Один адрес для сотрудников: **`https://app.ffs.by`**.  
Запасной вход в LAN без интернета: `http://192.168.1.20:3000` (сессия браузера отдельная).

Сборка web: **`NEXT_PUBLIC_API_URL=`** (пусто) + `FITGO_API_PROXY_TARGET=http://127.0.0.1:3001` — браузер бьёт в `/api` того же origin; Next проксирует в Nest (`experimental.proxyTimeout` 150 с).

## Уже сделано на сервере 1С (WS2016)

Проверено 2026-10-04:

| Шаг | Статус |
|-----|--------|
| `proxy_module` / `proxy_http_module` включены в `httpd.conf` | OK |
| `C:\Apache24\conf\extra\fitgo-app-8445.conf` | OK (шаблон в [apache-fitgo-proxy.conf.template](../scripts/windows/fitgo-server/apache-fitgo-proxy.conf.template)) |
| `Include` **после** `httpd-ahssl.conf` | OK |
| `httpd -S`: default `localhost` на `:8445`, затем `namevhost app.ffs.by` | OK |
| `/login` с Host `app.ffs.by` → FitGO `200` | OK |
| `/fitgo/hs/...` без Host app → 1С `401` (ключ) | OK |
| `/forma` на `:444` → 1С `401` | OK |

Публикации в `httpd.conf` (глобально):

- `Alias "/forma" …` → `SetHandler 1c-application`
- `Alias "/fitgo" …` → `SetHandler 1c-application`

Исключения `ProxyPass /forma !` и `/fitgo !` в блоке app — страховка.

### Откат Apache на клубе

1. Удалить строку `Include conf/extra/fitgo-app-8445.conf` из `httpd.conf`.
2. `C:\Apache24\bin\httpd.exe -t`
3. `Restart-Service Apache2.4`

Бэкап: `httpd.conf.bak-*` рядом с `httpd.conf`.

## Hoster.by: поддомен и PHP

### 1. Сайт `app`

1. Панель hoster → домен `ffs.by` → создать сайт / поддомен **`app`** (отдельный docroot, **не** корень WordPress ffs.by).
2. SSL Let's Encrypt на `app.ffs.by`.
3. `nslookup app.ffs.by` → IP хостинга (тот же контур, что ffs.by / `87.232.64.100`), **не** IP клуба.

### 2. Выложить прокси

В docroot `app.ffs.by` положить из репозитория:

- [deploy/hoster-wp-proxy/index.php](../deploy/hoster-wp-proxy/index.php)
- [deploy/hoster-wp-proxy/.htaccess](../deploy/hoster-wp-proxy/.htaccess)

WordPress в эту папку **не** ставить.

Опционально (если сменится публичный IP клуба) задать в панели / `.user.ini`:

```text
FITGO_UPSTREAM_IP=86.57.152.242
FITGO_PROXY_TIMEOUT=180
```

### 3. Лимиты PHP на тарифе

Перед продами:

1. Временно `phpinfo()` → `max_execution_time`, `upload_max_filesize`, `disable_functions` (`curl` нужен).
2. Тест `sleep(90)`: если обрывается раньше — жёсткий лимит hoster; тяжёлые sync админ делает с LAN (`:3000`), обычные экраны укладываются в 1–3 с.

`.htaccess` пытается выставить 180 с / upload 8M — панель может игнорировать `php_value`.

## Smoke после PHP

С телефона **без VPN** (мобильный интернет):

1. `https://app.ffs.by/login` — страница входа FitGO, замок SSL hoster.
2. Логин тренера / админа.
3. DevTools → Network: запросы на `/api/...` того же origin.
4. Расписание на **ffs.by** и отмена записи — без регрессии.
5. Супер админ → проверка связи с 1С.

С Mac (только через прокси hoster, не напрямую на `:8445` с чужого IP):

```bash
curl -sI https://app.ffs.by/login
```

## Таймауты (лестница)

| Звено | Значение |
|-------|----------|
| Nest → 1С | до 120 с (отдельные методы) |
| Next rewrite → Nest | `proxyTimeout` **150 с** (`apps/web/next.config.ts`) |
| Apache → Next | `ProxyTimeout 180` |
| PHP → клуб | `FITGO_PROXY_TIMEOUT` **180** (если тариф позволит) |

После смены `next.config.ts` на сервере: `Update-FitGO.ps1` (пересборка web).

## Ограничения

- Нагрузка Next+Nest+Postgres на машине 1С (~0.8–1.5 ГБ; при 32 ГБ RAM ок).
- PHP-прокси +50–200 мс; нет WebSocket.
- Фото профиля (фаза 1) — путь `/api/media/...`, лимиты upload на hoster.
- Апгрейд на VPS: только если egress = whitelist IP — см. [DEPLOY.md](DEPLOY.md) вариант C.
