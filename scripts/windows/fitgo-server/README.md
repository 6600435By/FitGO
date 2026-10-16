# FitGO СП — серверное приложение на Windows (рядом с 1С)

**СП** = серверное приложение FitGO для админов и супер-админа на машине клуба (`S2016` и т.п.).

Данные при первой установке — **вариант C**: пустой Postgres, без dump со стенда Mac/VPS. Клиенты/продажи/долги — из 1С. Staff, ЗП, SPA — настраиваете на месте.

Портал SPA-специалиста — отдельный фронт (`apps/specialist-web`, Cloudflare Pages). К этому каталогу он не относится: ему нужен HTTPS API клуба (см. ниже).

## Скрипты

| Файл | Назначение |
|------|------------|
| [Install-FitGO.ps1](./Install-FitGO.ps1) | Первая установка: Node, pnpm, NSSM, build, `db push` + minimal seed, службы |
| [Update-FitGO.ps1](./Update-FitGO.ps1) | Апдейт кода; перед апдейтом — бэкап; **не** трогает Postgres и `.env` при успехе |
| [Deploy-AppMaintenance.ps1](./Deploy-AppMaintenance.ps1) | Страница «Идёт обновление» → `C:\Apache24\htdocs\app-maintenance.html` (без остановки служб) |
| [Backup-FitGO.ps1](./Backup-FitGO.ps1) | Ночной / ручной комплект: `pg_dump` + `.env` + uploads + статус для UI |
| [Restore-FitGO.ps1](./Restore-FitGO.ps1) | Восстановление Data / Release из комплекта |
| [Register-FitGOBackupTask.ps1](./Register-FitGOBackupTask.ps1) | Task Scheduler: 01:30 daily + Sun 06:15 verify |
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

Перед апдейтом скрипт вызывает `Backup-FitGO.ps1`. Если бэкап упал — Update останавливается (схема не пушится). Аварийный повтор без дампа: `.\Update-FitGO.ps1 -SkipBackup`.

Не нужно Uninstall → Install. Update = бэкап → `git pull` (или подложить код) → build → restart служб.

Если **`git` не найден** (часто на S2016 без Git for Windows):

1. Поставить [Git for Windows](https://git-scm.com/download/win) **или** скачать zip и распаковать поверх `C:\FitGO\FitGO` (не затирая `apps\api\.env`):  
   `https://github.com/6600435By/FitGO/archive/refs/heads/main.zip`
2. Затем:

```powershell
.\Update-FitGO.ps1 -SkipPull
```

## Публичный доступ без VPS (`app.ffs.by`)

Сотрудники с телефона: `https://app.ffs.by` (hoster WordPress 2 → PHP-прокси → Apache NameVirtualHost `app.ffs.by` на `:8445` → Next `:3000`).

- Шаблон Apache: [apache-fitgo-proxy.conf.template](./apache-fitgo-proxy.conf.template) → `C:\Apache24\conf\extra\fitgo-app-8445.conf`
- PHP на hoster: [deploy/hoster-wp-proxy/](../../../deploy/hoster-wp-proxy/)
- Полная инструкция: [DEPLOY_WP_PROXY.md](../../../docs/DEPLOY_WP_PROXY.md)

Админам в клубе без интернета: `http://192.168.1.20:3000` (сессия отдельная от `app.ffs.by`).

Web build: пустой `NEXT_PUBLIC_API_URL`, `FITGO_API_PROXY_TARGET=http://127.0.0.1:3001` (ставит Install-FitGO).

В `CORS_ORIGIN` добавьте `https://app.ffs.by` (и при необходимости URL specialist-web) через запятую.

## Бэкапы и восстановление

Бэкап покрывает **Postgres FitGO** + `apps/api/.env` + uploads + зеркало снимков зала. **Базу 1С не трогает.** Службы FitGO во время ночного бэкапа не останавливаются.

### Разовая настройка (после staff)

```powershell
cd C:\FitGO\FitGO\scripts\windows\fitgo-server
# пароль postgres — один раз выдаёт CREATEDB роли fitgo (в задачу не пишется)
.\Register-FitGOBackupTask.ps1 -PostgresSuperPassword 'YOUR_POSTGRES_PASSWORD'
# опционально второй диск/шара:
# .\Register-FitGOBackupTask.ps1 -OffsitePath E:\FitGO-Offsite -PostgresSuperPassword '...'
.\Backup-FitGO.ps1   # первая копия сразу
```

Задачи: `FitGO-Backup` (ежедневно **01:30**), `FitGO-Backup-Verify` (вс **06:15**, подъём в `fitgo_backup_check`).

Каталог по умолчанию: параметр `-BackupRoot` = `E:\FitGO-Backups` (fallback: E → D → C). Папки: `daily\`, `weekly\`, `files-mirror\`, `LAST_OK.txt`. Храните 14 дневных + 8 недельных. Offsite — дамп + `.env`, без 14 копий hall. После смены диска перерегистрируйте задачу: `.\Register-FitGOBackupTask.ps1 -BackupRoot E:\FitGO-Backups`.

Статус для UI: `C:\FitGO\FitGO\apps\api\var\backup-status.json` (переопределение `FITGO_BACKUP_STATUS_PATH` в `.env`).

### SUPER_ADMIN в приложении

Если последний бэкап с ошибкой, файла нет, или успех старше **36 часов** — в шапке супер-админа жёлтое предупреждение. Если всё ок — полоски нет. Кнопки «сделать бэкап» в UI нет.

### Восстановление

1С не останавливать. FitGO недоступен на время restore (обычно 5–15 мин).

```powershell
# Обычный сбой данных (тот же git SHA):
.\Restore-FitGO.ps1 -Mode Data

# После плохого Update (откат кода по SHA из манифеста):
.\Restore-FitGO.ps1 -Mode Release -BundleId 2026-10-14_0130
```

Порядок: stop FitGO → страховочный дамп в `pre-restore\` → `fitgo_restore` → rename → файлы/`.env` → start. Режим Data блокируется, если SHA комплекта ≠ текущий код (нужен Release или `-Force`).

### Запрещено

- Переносить `pg_dump` со стенда Mac/VPS в СП.
- Коммитить `apps/api/.env` с ключами.
- Запускать бэкап вручную в 03:00–06:00 (ночь FULL sync) без нужды.
