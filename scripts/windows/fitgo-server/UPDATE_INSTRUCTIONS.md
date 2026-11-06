# FitGO — команды обновления на Windows-сервере

Инструкция для RDP на машину клуба (`C:\FitGO\…`). Запускать **PowerShell от Администратора**.

## Что где открывается

| URL | Служба Windows | Порт | Приложение |
|-----|----------------|------|------------|
| `https://app.ffs.by` | `FitGO-Web` | 3000 | Staff / админка (`apps/web`) |
| `https://lk.ffs.by` | `FitGO-Client` | 3002 | Клиентский ЛК (`apps/client-web`) |
| API (внутри сервера) | `FitGO-API` | 3001 | Nest (`apps/api`) |
| LAN в клубе | `FitGO-Web` | 3000 | `http://192.168.1.20:3000` |

Код: `C:\FitGO\FitGO`  
Скрипты: `C:\FitGO\FitGO\scripts\windows\fitgo-server`

---

## Перед любым обновлением

```powershell
cd C:\FitGO\FitGO\scripts\windows\fitgo-server
Set-ExecutionPolicy Bypass -Scope Process -Force
```

Проверка служб:

```powershell
Get-Service FitGO-API, FitGO-Web, FitGO-Client | Format-Table Name, Status
```

---

## Какой скрипт выбирать

| Ситуация | Команда |
|----------|---------|
| Поменялся **только клиентский ЛК** (UI, запись, welcome) | `.\Update-FitGO-Client.ps1` |
| Поменялась **только админка / staff** | `.\Update-FitGO-Staff.ps1` |
| Поменялся **только API** (Nest, Prisma, 1С-адаптер) | `.\Update-FitGO-API.ps1` |
| Большой релиз / неясно что затронуто / после долгого перерыва | `.\Update-FitGO.ps1` |

Правило: **чем уже — тем лучше**. Не гоняйте полный Update ради правки одной кнопки в ЛК.

---

## 1. Клиентский ЛК — `lk.ffs.by`

Останавливает только `FitGO-Client`. Staff и API **не** гасятся.

```powershell
cd C:\FitGO\FitGO\scripts\windows\fitgo-server
.\Update-FitGO-Client.ps1
```

Что делает: `git pull` → `pnpm install` → build `@fitgo/shared-types` → build `client-web` → start `FitGO-Client`.

Без pull (код уже на диске):

```powershell
.\Update-FitGO-Client.ps1 -SkipPull
```

### Проверка после Client

В браузере (лучше инкогнито):

1. `https://lk.ffs.by/` — welcome или редирект на login, **без** текста `Application error`.
2. `https://lk.ffs.by/login` — форма входа.

На сервере (актуальные ассеты из HTML, **не** копируйте старые хеши из чата):

```powershell
$html = (Invoke-WebRequest http://127.0.0.1:3002/ -UseBasicParsing).Content
[regex]::Matches($html, '/_next/static/[^"\s]+') | ForEach-Object {
  $p = $_.Value
  try {
    $r = Invoke-WebRequest ("http://127.0.0.1:3002" + $p) -UseBasicParsing
    "{0}  {1}" -f $r.StatusCode, $p
  } catch {
    "FAIL  $p"
  }
}
```

Все строки должны быть `200`. Если много `FAIL` — снова Client update или чистая пересборка (см. «Если ЛК снова упал»).

---

## 2. Staff / админка — `app.ffs.by`

Останавливает только `FitGO-Web`. Client и API **не** гасятся.

```powershell
cd C:\FitGO\FitGO\scripts\windows\fitgo-server
.\Update-FitGO-Staff.ps1
```

Без pull:

```powershell
.\Update-FitGO-Staff.ps1 -SkipPull
```

### Проверка после Staff

1. `https://app.ffs.by/` или `http://192.168.1.20:3000`
2. Логин админа / тренера.

```powershell
Invoke-WebRequest http://127.0.0.1:3000/ -UseBasicParsing | Select-Object StatusCode
```

---

## 3. API — Nest + Prisma

Останавливает только `FitGO-API`. Перед апдейтом по умолчанию делает бэкап.

```powershell
cd C:\FitGO\FitGO\scripts\windows\fitgo-server
.\Update-FitGO-API.ps1
```

Без pull / без бэкапа (только если уверены):

```powershell
.\Update-FitGO-API.ps1 -SkipPull
.\Update-FitGO-API.ps1 -SkipBackup
```

Что делает: pull → install → adapters → `prisma generate` → `prisma db push` → build API → start → health-check на `:3001`.

### Проверка после API

```powershell
try {
  Invoke-WebRequest http://127.0.0.1:3001/api/auth/me -UseBasicParsing
} catch {
  # 401 без токена = API жив — это нормально
  $_.Exception.Response.StatusCode.value__
}
```

Потом: вход в `lk.ffs.by` **и** `app.ffs.by` (API общий).

Если ломали контракт API для клиентского канала — в тот же день обновите и Client (`Update-FitGO-Client.ps1`).

---

## 4. Полное обновление всего FitGO

Останавливает Web + API + Client, бэкап, pull, все builds, `db push`, рестарт всех служб.

```powershell
cd C:\FitGO\FitGO\scripts\windows\fitgo-server
.\Update-FitGO.ps1
```

Варианты:

```powershell
.\Update-FitGO.ps1 -SkipPull      # код уже скопирован / zip поверх
.\Update-FitGO.ps1 -SkipBackup    # аварийно, без дампа (не для обычной работы)
```

Во время update Apache показывает страницу «Идёт обновление» (`app-maintenance.html`).

### Проверка после полного Update

```powershell
Get-Service FitGO-API, FitGO-Web, FitGO-Client | Format-Table Name, Status
Invoke-WebRequest http://127.0.0.1:3000/ -UseBasicParsing | Select StatusCode
Invoke-WebRequest http://127.0.0.1:3002/ -UseBasicParsing | Select StatusCode
```

Браузер:

- `https://app.ffs.by/`
- `https://lk.ffs.by/` (инкогнито)

---

## Если `git pull` не работает

Git не установлен или не в PATH:

1. Поставить [Git for Windows](https://git-scm.com/download/win), **или**
2. Скачать zip: `https://github.com/6600435By/FitGO/archive/refs/heads/main.zip`  
   Распаковать **поверх** `C:\FitGO\FitGO`, **не затирая** `apps\api\.env`.
3. Затем:

```powershell
.\Update-FitGO-Client.ps1 -SkipPull
# или Staff / API / полный Update с -SkipPull
```

---

## Если ЛК снова «Application error»

1. Не проверяйте старые имена `…-05d5….js` / `….css` из старых логов — после каждой сборки хеши **новые**.
2. Пересоберите Client:

```powershell
cd C:\FitGO\FitGO\scripts\windows\fitgo-server
.\Update-FitGO-Client.ps1 -SkipPull
```

3. Если не помогло — чистый `.next`:

```powershell
Stop-Service FitGO-Client
cd C:\FitGO\FitGO
Remove-Item -Recurse -Force .\apps\client-web\.next
$env:NEXT_PUBLIC_API_URL = ''
$env:FITGO_API_PROXY_TARGET = 'http://127.0.0.1:3001'
pnpm --filter @fitgo/shared-types build
pnpm --filter @fitgo/client-web build
Start-Service FitGO-Client
```

4. Снова прогон проверки ассетов из HTML (блок «Проверка после Client»).

---

## Ручной рестарт служб (без сборки)

```powershell
Restart-Service FitGO-API
Restart-Service FitGO-Web
Restart-Service FitGO-Client
```

По одной:

```powershell
Stop-Service FitGO-Client
Start-Service FitGO-Client
```

Статус и логи NSSM (если служба не поднимается):

```powershell
Get-Service FitGO-API, FitGO-Web, FitGO-Client
C:\FitGO\tools\nssm\nssm.exe status FitGO-Client
```

---

## Бэкап отдельно (без update)

```powershell
cd C:\FitGO\FitGO\scripts\windows\fitgo-server
.\Backup-FitGO.ps1
```

Каталог по умолчанию: `E:\FitGO-Backups`. Ночная задача: `Register-FitGOBackupTask.ps1` (SYSTEM, 01:30). **Не трогает** `1s-backup` / 1С.

Если в UI «резервная копия устарела», а ручной бэкап / Update работает:

```powershell
cd C:\FitGO\FitGO\scripts\windows\fitgo-server
.\Register-FitGOBackupTask.ps1 -RunNow
Get-ScheduledTaskInfo -TaskName FitGO-Backup
Get-Content E:\FitGO-Backups\logs\fitgo-backup.log -Tail 40
```

Откат:

```powershell
.\Restore-FitGO.ps1 -Mode Data
.\Restore-FitGO.ps1 -Mode Release -BundleId 2026-11-01_0130
```

---

## Краткая шпаргалка

```powershell
cd C:\FitGO\FitGO\scripts\windows\fitgo-server
Set-ExecutionPolicy Bypass -Scope Process -Force

# Только ЛК клиентов
.\Update-FitGO-Client.ps1

# Только staff
.\Update-FitGO-Staff.ps1

# Только API + БД-схема
.\Update-FitGO-API.ps1

# Всё сразу
.\Update-FitGO.ps1
```

После Client / полного Update всегда смотрите `https://lk.ffs.by/` в инкогнито.
