---
name: fresh-chat
description: >-
  After a successful git commit or push, end the current Agent chat and hand off
  to a new one (token savings). Use when a hook injects FRESH_CHAT_REQUIRED, after
  commit/push succeeds, or when the user asks for новый чат, fresh chat, смени чат,
  or handoff to new agent.
---

# Fresh chat after commit/push

Cursor **не умеет** сам открыть новый Agent-таб. После удачного `git commit` /
`git push` hook пишет seed, кладёт его в буфер и на `sessionStart` нового чата
подставляет контекст.

## Когда срабатывает

1. Hook `postToolUse` (Shell) увидел успешный `git commit` или `git push`
2. Или в контексте есть `FRESH_CHAT_REQUIRED` / `FRESH_CHAT_SEED`
3. Или пользователь явно просит сменить чат после ship

## Что сделать в ТЕКУЩЕМ чате

1. Кратко подтверди: commit/push ok (SHA если есть).
2. Если был **push на сервер клуба** (обычно `main`) — в блоке **«Дальше»** укажи
   **конкретную** PowerShell-команду обновления (см. шпаргалку ниже), не общее
   «перезапустить API/web».
3. Закончить ответ блоком **«Новый чат»** — **и остановиться**.
4. Порядок: сначала «Дальше» (Git + деплой), потом «Новый чат».

Источник правды по деплою Windows:
[UPDATE_INSTRUCTIONS.md](/Users/machome/Projects/FitGO/scripts/windows/fitgo-server/UPDATE_INSTRUCTIONS.md)

### Шпаргалка «Сервер / деплой FitGO» (вставлять в «Дальше»)

Выбрать **узкий** скрипт по изменённым путям в коммите. Полный Update — только
если тронуто несколько слоёв или неочевидно.

| Что менялось в коммите | Команда на RDP (Admin PowerShell) |
|------------------------|-----------------------------------|
| Только `apps/client-web` (ЛК) | `.\Update-FitGO-Client.ps1` |
| Только `apps/web` (staff/админка) | `.\Update-FitGO-Staff.ps1` |
| Только `apps/api` / Prisma / adapter | `.\Update-FitGO-API.ps1` |
| Несколько из выше / shared-types + UI+API | `.\Update-FitGO.ps1` |

Перед любой командой:

```powershell
cd C:\FitGO\FitGO\scripts\windows\fitgo-server
Set-ExecutionPolicy Bypass -Scope Process -Force
```

Пример блока после push (подставь нужный скрипт):

```markdown
### Дальше

**Git**
- Запушено: `<SHA>` → `origin/main`

**Сервер / деплой FitGO** (RDP, Admin PowerShell)
```powershell
cd C:\FitGO\FitGO\scripts\windows\fitgo-server
Set-ExecutionPolicy Bypass -Scope Process -Force
.\Update-FitGO-API.ps1
# или: .\Update-FitGO-Staff.ps1 | .\Update-FitGO-Client.ps1 | .\Update-FitGO.ps1
```
- Инструкция: [UPDATE_INSTRUCTIONS.md](/Users/machome/Projects/FitGO/scripts/windows/fitgo-server/UPDATE_INSTRUCTIONS.md)
- `-SkipPull` — если код уже на диске; `-SkipBackup` — только аварийно (API/полный)

**1С** — не требуется / или конкретные BSL-ссылки
```

Службы: `FitGO-API` (:3001), `FitGO-Web` / app.ffs.by (:3000), `FitGO-Client` / lk.ffs.by (:3002).
Узкий Update гасит только свою службу. Полный `Update-FitGO.ps1` — все три + бэкап.

### Шаблон «Новый чат»

```markdown
### Новый чат
Контекст этого треда пора сбросить (токены).

1. Открой **новый Agent** (Composer / Agent).
2. Seed уже в буфере — ⌘V, либо просто начни писать: hook `sessionStart` подставит seed сам.
3. В новом чате сразу задача следующей фичи одной фразой.

**Seed-файл:** `.cursor/fresh-chat-state/next-chat-seed.md` (если ещё не съеден).
```

## Что сделать в НОВОМ чате

Если видишь `FRESH_CHAT_SEED` — это штатно. Работай от seed + запроса пользователя,
без повторного «разведки всего FitGO».

## Не делать

- Не писать в «Дальше» голое «перезапустить API/web» без имени `Update-FitGO-*.ps1`
- Не вызывать `followup` / не продолжать крупную работу в старом чате после handoff
- Не коммитить `.cursor/fresh-chat-state/`
- Не открывать `cursor --chat` сами «на всякий случай» — это другой UX
