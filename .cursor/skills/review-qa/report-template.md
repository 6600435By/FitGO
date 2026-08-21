# Review + QA — FitGO

**Verdict:** Ship | Ship with fixes | Do not ship  
**Scope:** {branch / uncommitted / feature name}  
**Checked:** {tsc api ✓/✗ · tsc web ✓/✗ · API smoke ✓/✗/skipped · logic trace ✓}

## Summary
{2–3 предложения: что проверено, общая оценка качества и рисков}

## Findings

| Severity | Area | Finding |
|----------|------|---------|
| 🔴 Critical | {file or flow} | {кратко: баг, блокер, security} |
| 🟡 Major | … | … |
| 🟢 Minor | … | … |

*(omit table rows if none; max 8 rows)*

## QA notes
- **Работает:** {что подтверждено тестами или логикой}
- **Не проверено / blocked:** {причина: сервер выключен, нет данных, …}
- **Логические риски:** {расхождения UX и API, граничные случаи}

## Platform docs & Prisma draft
- **Сверка нужна была:** да / нет (если нет — «триггеры не сработали»)
- **Статус:** согласовано с draft | требуются правки | не проверялось

| Файл | Предлагаемое изменение |
|------|------------------------|
| `docs/PLATFORM_ARCHITECTURE.md` | {§ / Changelog — или «—»} |
| `schema.platform-draft.prisma` | {модель/поле/enum — или «—»} |

*(если правки не нужны: одна строка «Документация и draft соответствуют изменениям»)*

## Recommendations
1. {конкретное действие — файл/модуль/тест}
2. …
*(max 5, по убыванию приоритета)*
