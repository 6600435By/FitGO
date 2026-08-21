---
name: fix-from-review
description: >-
  Implement fixes from Review+QA report for FitGO. Reads findings and recommendations
  from the prior review in chat (or user-pasted report), applies minimal targeted
  code changes, runs typecheck, returns a brief fix summary. Use when the user says
  /fix-review, исправь по ревью, примени рекомендации, fix review, fix findings,
  исправь баги из ревью, or asks the second agent to fix review issues.
---

# Fix from Review (FitGO)

Companion to [review-qa](../review-qa/SKILL.md). **Reviewer finds → Fixer implements.**

## Команды запуска

| Команда | Действие |
|---------|----------|
| `/fix-review` | исправить все findings из последнего ревью в чате |
| `исправь по ревью` | то же |
| `примени рекомендации` | то же |
| `fix review` / `fix findings` | то же |
| `исправь только major` | только 🟡 Major и 🔴 Critical |
| `исправь пункт N` | только рекомендация №N |
| `обнови platform docs` | применить секцию Platform docs & Prisma draft из последнего ревью |

Запускать **сразу**, без «начать?».

## Источник задач

1. **Приоритет:** таблица Findings + список Recommendations из последнего отчёта Review+QA в этом чате.
2. Если отчёта нет — попросить пользователя сначала `сделай ревью` или вставить отчёт.
3. Если пользователь вставил отчёт в сообщении — использовать его.

## Workflow (родительский агент)

1. Собери из чата все findings (severity, area, finding) и recommendations (numbered list).
2. Запусти **один** `generalPurpose` subagent:
   - `readonly: false`
   - `run_in_background: false`
   - `description: "Fix from Review"`
3. Не дублируй работу субагента — не правь те же файлы параллельно.

## Subagent prompt shape

```text
Full Repository Path: <absolute path>

You are a senior FitGO engineer implementing fixes from a Review+QA report.

## Input — findings to fix
<paste Findings table + Recommendations from chat>

## Rules
1. Fix in severity order: 🔴 Critical → 🟡 Major → 🟢 Minor (unless user scoped to subset).
2. Minimal diff — only what the finding requires. Match existing code style.
3. Do NOT revert unrelated changes. Do NOT over-engineer (no extra abstractions/tests unless finding demands it).
4. After edits run:
   - pnpm --filter @fitgo/api exec tsc --noEmit
   - pnpm --filter @fitgo/web exec tsc --noEmit
5. If a recommendation is ambiguous, pick the simplest correct interpretation aligned with product intent in the finding text.
6. Do NOT commit unless user explicitly asked.
7. Do NOT touch production/external systems (ffs.by bookings etc.).
8. If recommendations include **Platform docs & Prisma draft** section — apply those edits to `docs/PLATFORM_ARCHITECTURE.md` and/or `apps/api/prisma/schema.platform-draft.prisma` (update Changelog §12 when structural). Do NOT merge draft into `schema.prisma` unless finding explicitly says migrate.

## FitGO context (last review known issues — verify still present before fixing)
- completeSession: COMPLETED vs dual confirmation
- updateSessionPlan: preserve confirmations on edit
- profile-gate.tsx: error handling
- trainer dashboard upcomingSessions stat
- PT status label consistency

## Output
Return report using template at .cursor/skills/fix-from-review/report-template.md (Russian, concise).
List each finding addressed: fixed | skipped (reason) | partial.
```

## After subagent completes

1. Покажи отчёт fixer пользователю.
2. Если tsc упал — субагент должен был починить; если нет — родитель доводит до green или сообщает blocker.
3. Предложи `сделай ревью` повторно **только если** пользователь явно хочет re-verify (не навязывать).

## Парный pipeline

```
сделай ревью  →  отчёт  →  исправь по ревью  →  отчёт fixer  →  (опционально) сделай ревью
```

## Examples

**User:** `исправь по ревью`

→ Subagent fixes all items from last Review+QA report in thread.

**User:** `исправь только пункт 1 и 2`

→ Subagent fixes recommendations 1 and 2 only.

**User:** `fix review` (no prior report)

→ Reply: «Сначала выполните `сделай ревью` или вставьте отчёт с findings.»
