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
2. Закончить ответ блоком ниже — **и остановиться** (не начинать следующую фичу здесь).
3. Если есть ship-handoff «Дальше» — сначала он, потом «Новый чат».

### Шаблон

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

- Не вызывать `followup` / не продолжать крупную работу в старом чате после handoff
- Не коммитить `.cursor/fresh-chat-state/`
- Не открывать `cursor --chat` сами «на всякий случай» — это другой UX
