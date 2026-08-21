---
name: review-qa
description: >-
  Run combined code review and QA testing subagent for FitGO. Reviews diff quality,
  logic, and regressions; smoke-tests API and critical user flows; returns a brief
  report with prioritized recommendations. Use when the user says /review-qa,
  сделай ревью, сделай ревью агентом, запусти ревью, make review, run review,
  code review with testing, QA audit, ревью кода, проверку работоспособности,
  or профессиональное тестирование.
---

# Review + QA (FitGO)

## Команды запуска

Любая из фраз ниже → **сразу** выполнять этот skill (без уточняющих вопросов):

| Команда | Scope по умолчанию |
|---------|-------------------|
| `/review-qa` | изменения ветки |
| `сделай ревью` | изменения ветки |
| `сделай ревью агентом` | изменения ветки |
| `запусти ревью` | изменения ветки |
| `make review` | branch changes |
| `review-qa` | branch changes |

Модификаторы (добавить к команде):

- `… незакоммиченное` / `… uncommitted` → только dirty tree
- `… personal training` / `… тренер` → `Custom Focus` на указанную область
- `… весь проект` / `… full audit` → полный аудит кодовой базы

Use when the user runs any command above or asks for code review **and** functional QA.

Launch exactly one `generalPurpose` subagent:

- `readonly: false` — QA may run typecheck, curl, and read-only browser checks
- `run_in_background: false` unless the user asks for background
- `description: "Review + QA"`

Do **not** pre-compute the full diff; the subagent gathers context itself.

## Scope

| User intent | Diff scope |
|-------------|------------|
| Default | `branch changes` vs repo default branch |
| Dirty tree only | `uncommitted changes` |
| Whole app / no git delta | `full codebase audit` |
| Named feature | `feature: <name>` — subagent focuses changed files + related flows |

If the user names a PR or branch, check out that branch first (same rules as review-bugbot: stash only after user confirms).

## Subagent prompt shape

```text
Full Repository Path: <absolute path>
Scope: <branch changes | uncommitted changes | full codebase audit | feature: ...>
Custom Focus: <only if user specified areas, e.g. "trainer CRM", "personal training goals">

You are a senior code reviewer AND professional QA engineer for FitGO (NestJS API + Next.js PWA + Prisma/PostgreSQL monorepo).

## Phase 1 — Code review
1. Identify changed files (git diff vs scope). Read surrounding code, not only the diff hunks.
2. Review for: correctness, edge cases, error handling, auth/roles, data integrity, API contracts, Prisma schema impact, shared-types sync, regressions, **platform architecture alignment** (see fitgo-checklist.md § Platform).
3. Note security basics (injection, auth bypass, secrets, IDOR) — flag only clear issues, do not deep-dive OWASP unless relevant.

## Phase 2 — QA / functional testing
1. Run applicable checks:
   - `pnpm --filter @fitgo/api exec tsc --noEmit`
   - `pnpm --filter @fitgo/web exec tsc --noEmit`
   - Targeted API smoke tests via curl if API is reachable on localhost:3001 (login demo accounts from README)
2. Trace business logic for affected flows (see fitgo-checklist.md in .cursor/skills/review-qa/).
3. If API/web dev servers are down, state that and rely on static analysis + logic tracing; do not start servers unless user asked.
4. **Platform alignment:** if Platform triggers matched, read docs/PLATFORM_ARCHITECTURE.md and apps/api/prisma/schema.platform-draft.prisma; propose doc/schema updates in report (do not edit unless user asked).
5. Do NOT mutate production/external systems (no real ffs.by bookings/cancellations without explicit user permission).
6. Optional: browser snapshot of localhost:3000 only if server is already running.

## Phase 3 — Report
Return ONLY the report using the template in .cursor/skills/review-qa/report-template.md.
Keep it concise (≤ 40 lines body). Russian language for user-facing text.
Sort findings by severity. Max 5 recommendations, actionable and specific.
Include a one-line verdict: Ship / Ship with fixes / Do not ship.
```

Before launching, read [fitgo-checklist.md](fitgo-checklist.md) and pass its path to the subagent in the prompt.

Also pass these platform doc paths (read when integration/schema/club code may be affected):

- `docs/PLATFORM_ARCHITECTURE.md`
- `apps/api/prisma/schema.platform-draft.prisma`
- `apps/api/prisma/schema.prisma` (current applied schema)

## Platform architecture alignment (обязательно при триггерах)

Если diff затрагивает области из **Platform triggers** в [fitgo-checklist.md](fitgo-checklist.md) — субагент **обязан**:

1. Прочитать `PLATFORM_ARCHITECTURE.md` и `schema.platform-draft.prisma`.
2. Сверить изменения с задокументированными границами сервисов, моделями и планом миграции.
3. В отчёте заполнить секцию **«Platform docs & Prisma draft»** (см. report-template.md):
   - **Нужны правки?** да / нет
   - Конкретные предложения: файл, секция/модель, что добавить/изменить/пометить `@evolution`
   - Если правки не нужны — одна строка «согласовано с draft»

**Не применять** правки в `PLATFORM_ARCHITECTURE.md` и `schema.platform-draft.prisma` автоматически — только **предложить** в отчёте. Применение — по запросу пользователя (`исправь по ревью`, `обнови platform docs`) или через [fix-from-review](../fix-from-review/SKILL.md).

Обновить **Changelog** в `PLATFORM_ARCHITECTURE.md` (секция 12), если предлагаются структурные изменения.

## After subagent completes

1. Present the subagent report to the user with minimal editing — preserve structure and severity labels.
2. If the subagent failed, retry once with the same prompt; if still failing, report the blocker briefly.
3. Do **not** fix issues unless the user asks.

## Examples

**User:** `/review-qa`

→ Launch subagent with `Scope: branch changes`.

**User:** `review-qa только незакоммиченное`

→ `Scope: uncommitted changes`.

**User:** `review-qa personal training`

→ `Scope: branch changes`, `Custom Focus: personal training goals, session completion, trainer/client session pages`.

**User:** `review-qa` после изменений в `1c-adapter` или Prisma

→ Subagent must run Platform alignment; propose updates to PLATFORM_ARCHITECTURE.md / schema.platform-draft.prisma if drift detected.

## Парный агент — исправления

После отчёта пользователь может запустить fixer:

- `/fix-review` · `исправь по ревью` · `примени рекомендации`

→ см. [fix-from-review](../fix-from-review/SKILL.md)
