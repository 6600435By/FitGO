# FitGO СП — серверное приложение на Windows (рядом с 1С)

**СП** = серверное приложение FitGO для админов и супер-админа на машине клуба (`S2016` и т.п.).

Данные при первой установке — **вариант C**: пустой Postgres, без dump со стенда Mac/VPS. Клиенты/продажи/долги — из 1С. Staff, ЗП, SPA — настраиваете на месте.

Портал SPA-специалиста — отдельный фронт (`apps/specialist-web`, Cloudflare Pages). К этому каталогу он не относится: ему нужен HTTPS API клуба (см. ниже).

## Скрипты

| Файл | Назначение |
|------|------------|
| [Install-FitGO.ps1](./Install-FitGO.ps1) | Первая установка: Node, pnpm, NSSM, build, `db push` + minimal seed, службы |
| [Update-FitGO.ps1](./Update-FitGO.ps1) | Апдейт кода; **не** трогает Postgres и `.env` |
| [Uninstall-FitGO.ps1](./Uninstall-FitGO.ps1) | Снимает службы; БД по умолчанию остаётся |
| [fitgo-api.env.example](./fitgo-api.env.example) | Шаблон `apps/api/.env` |
| [apache-fitgo-proxy.conf.template](./apache-fitgo-proxy.conf.template) | Прокси HTTPS → API |

## Первая установка (RDP, от Администратора)

1. Скопируйте репозиторий на сервер (USB / git).
2. Установите **PostgreSQL 16** (Windows installer), запомните пароль `postgres`.
3. В PowerShell:

```powershell
cd D:\path\to\FitGO\scripts\windows\fitgo-server
Set-ExecutionPolicy Bypass -Scope Process -Force
.\Install-FitGO.ps1 -SourcePath D:\path\to\FitGO -SuperAdminPassword 'StrongPass!'
```

4. Откройте `http://127.0.0.1:3000`, логин из вывода скрипта.
5. В `C:\FitGO\FitGO\apps\api\.env` заполните `FORMA_API_KEY`, `FORMA_BASIC_AUTH`, при необходимости поправьте `FORMA_*` URL (LAN/`127.0.0.1`).
6. `Restart-Service FitGO-API`

### Чеклист на месте (до приёмки стойки)

1. SUPER_ADMIN логин OK; `GET` health 1С через API → 200.
2. `/super-admin/staff` — создать ADMIN и SPECIALIST, выдать пароли.
3. Pay profiles (мотивация персонала).
4. `/admin/spa` — услуги, специалисты, квоты.
5. Sync продаж — dashboard / `/admin/sales` наполняются из 1С.
6. Сегменты из 1С — **не** блокер (Post-SP F4).

## Update (повседневная доработка)

```powershell
.\Update-FitGO.ps1
```

Не нужно Uninstall → Install. Update = `git pull` (или подложить код) → build → restart служб.

## HTTPS для портала специалиста

Браузер на Cloudflare Pages **не** примет самоподписанный сертификат API (как у `:8445`). Нужен доверенный сертификат (Let's Encrypt / win-acme) на поддомен, например `fitgo-api.ffs.by`, и проброс MikroTik **или** API на hoster с whitelist к 1С.

Админам в клубе достаточно LAN: `http://192.168.1.20:3000`.

В `CORS_ORIGIN` добавьте URL specialist-web через запятую.

## Бэкапы

С первого дня после настройки staff:

```text
pg_dump -U fitgo fitgo > fitgo-YYYYMMDD.sql
```

Храните вне диска `S2016` (или хотя бы другой том).

## Запрещено

- Переносить `pg_dump` со стенда Mac/VPS в СП.
- Коммитить `apps/api/.env` с ключами.
