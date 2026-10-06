---
name: ship-handoff
description: >-
  Ends major FitGO work with a ship checklist: what to commit/push and what to do
  on the 1C / Windows server, with clickable file links. Use after finishing a
  plan, large feature, multi-file fix, 1C integration change, deploy-related work,
  or when the user asks for handoff, что коммитить, что пушить, что на сервере,
  действия после правки, checklist after ship.
---

# Ship handoff (commit / push / 1C server)

После **крупной правки** или **реализации плана** всегда заканчивай ответ блоком
ниже. Не коммить и не пушь сам, если пользователь явно не просил.

## Когда применять

- Завершён план / multi-file feature / крупный bugfix
- Менялись API, Prisma, payroll, SPA, booking-control, 1C-adapter, BSL, deploy
- Пользователь спрашивает «что дальше / что на сервере»

Не нужен блок после мелкого typo / одного класса / ответа без кода.

## Шаблон финала (обязательно)

```markdown
### Дальше

**Git**
- Закоммитить: краткий смысл (1 строка) + список ключевых путей
- Пуш: `git push` в текущую ветку (обычно `main` / WIP) — только после вашего «закоммить/пуш»
- Если уже закоммичено и запушено в этом чате — напиши SHA и что на remote ok

**Сервер / деплой FitGO**
- Что перезапустить: API / web / `pnpm db:push` (если была Prisma)
- На Windows (если Mac↔Windows): pull ветки, `docker compose up -d` для Postgres

**1С (только если затронуто)**
- Какие BSL/модули обновить — кликабельные ссылки
- Что сделать в конфигураторе: скопировать модуль → сохранить → опубликовать HTTP
- Какой сервис: FitGOIntegration и/или FitGOAnalytics
- Проверка: какой curl / кнопка в UI («Обновить из 1С»)
```

Если 1С не трогали — секцию **1С** опусти или напиши «1С не требуется».

## Ссылки на 1С (формат)

Всегда markdown с **абсолютным путём**:

`[ИмяФайла.bsl](/Users/machome/Projects/FitGO/scripts/windows/FitGOIntegration_HTTP.bsl)`

Частые файлы:

| Задача | Файл |
|--------|------|
| Integration HTTP | [FitGOIntegration_HTTP.bsl](/Users/machome/Projects/FitGO/scripts/windows/FitGOIntegration_HTTP.bsl) |
| Integration install | [1C_CONFIGURATOR_INSTALL.md](/Users/machome/projects/fitgo-probe/docs/1C_CONFIGURATOR_INSTALL.md) |
| Integration API | [FITGO_1C_HTTP_API.md](/Users/machome/Projects/FitGO/docs/FITGO_1C_HTTP_API.md) |
| Analytics HTTP | [FitGOAnalytics_HTTPService.bsl](/Users/machome/projects/fitgo-probe/1c-extension/FitGOAnalytics_HTTPService.bsl) |
| Analytics продажи | [FitGOAnalytics_Продажи.bsl](/Users/machome/projects/fitgo-probe/1c-extension/FitGOAnalytics_Продажи.bsl) |
| Analytics роли | [ANALYTICS_ROLES_AND_API.md](/Users/machome/projects/fitgo-probe/docs/ANALYTICS_ROLES_AND_API.md) |
| SPA Integration | [FitGOIntegration_SPA_SPEC.md](/Users/machome/Projects/FitGO/scripts/windows/FitGOIntegration_SPA_SPEC.md) |

Probe BSL: `/Users/machome/projects/fitgo-probe/1c-extension/`.

## Типичные действия на сервере 1С

1. Открыть конфигуратор → расширение FitGOIntegration или FitGOAnalytics
2. Вставить/обновить модуль из ссылки в чате
3. Сохранить, обновить конфигурацию БД при необходимости
4. Опубликовать HTTP-сервис (IIS/Apache публикация `fitgo` / `analytics`)
5. Без «Защиты от опасных действий» на расширении Integration (иначе 500 на write)
6. Проверить: `GET …/v1/health` или кнопка sync в UI

Не повторяй «F7 / переопубликовать» без конкретного файла и причины.

## Правила

- Не включай секреты (.env, ключи) в список коммита
- Не проси commit/push, если уже сделал по явной просьбе — укажи факт и SHA
- Коротко: 5–12 строк в блоке «Дальше», без пересказа всей задачи
