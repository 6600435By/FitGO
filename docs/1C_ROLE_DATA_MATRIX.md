# Матрица данных 1С ↔ FitGO по ролям

Шаблон привязок. Колонка **Путь 1С** заполняется после прогона [`FitGO_DataScanner`](../scripts/windows/fitgo-scanner/README.md) из секции `bindings` JSON.

Каналы:

- `fitgo_http` — FitGOIntegration `:8445/fitgo/hs/fitgo/v1`
- `forma_v3` — штатный Forma API v3
- `fitgo_db` — PostgreSQL FitGO (не 1С)

OSMI cloud **не используем**. Карта только через `Справочник.Карты`.

## Клиент

| Поле FitGO | Канал | Путь 1С (заполнить после scan) | Статус |
|------------|-------|--------------------------------|--------|
| `profile.externalId` | fitgo_http `/client` | `Справочник.Контрагенты` UUID | есть |
| `profile.firstName/lastName` | fitgo_http `/client` | `Имя` / `Фамилия` | есть |
| `profile.phone` | fitgo_http `/client` | КИ / реквизит | есть |
| `membership.name` | fitgo_http `/membership` | _из bindings_ | **чинить** |
| `membership.validUntil` | fitgo_http `/membership` | `….СрокДействия` | **чинить** |
| `membership.status` | fitgo_http `/membership` | `….Статус` | **чинить** |
| `membership.services` | fitgo_http | квоты из остатков | wired |
| `membership.freezeAllowed` / `freezeDaysRemaining` | fitgo_http `/membership` | `КоличествоДнейЗаморозок` + `КоличествоДнейЗаморозокОстаток` | **wired** |
| `membership.frozenUntil` | fitgo_http | `Документ.ОперацииСЧленствомПакетомУслуг` дата «до» | wire |
| `membership.accountBalance` | fitgo_http | _если найдётся_ | backlog |
| `visits[]` | fitgo_http `/visits` | `Документ.Посещение` | есть |
| `accessCard.barcode` | fitgo_http `/card` | `Справочник.Карты.КодКарты` | есть |
| schedule / book / cancel | forma_v3 | `/classes/`, `client_to_class` | есть |

## Тренер

| Поле FitGO | Канал | Путь 1С | Статус |
|------------|-------|---------|--------|
| group schedule | forma_v3 | `/classes/?employee_id=` | есть |
| roster clients | fitgo_db | — | есть |
| client membership / lastVisit | fitgo_http | те же `/membership`, `/visits` | зависит от membership |
| PT sessions / goals / notes | fitgo_db | — | есть |

## Админ / ресепшен

| Поле FitGO | Канал | Путь 1С | Статус |
|------------|-------|---------|--------|
| pending CRM list | fitgo_db | — | есть |
| active / expiring memberships | fitgo_http N× | membership paths | после фикса |
| visits today / at-risk | fitgo_http + db | `Посещение` + FitGO | частично |
| bulk all memberships | fitgo_http future | catalog membership | backlog |
| remind / daily report | fitgo_db | — | есть |

## Управляющий (manager)

Отдельной роли в FitGO нет → админ-аналитика / super-admin.

| Поле FitGO | Канал | Путь 1С | Статус |
|------------|-------|---------|--------|
| revenue / daily reports | fitgo_db | — | есть |
| sales from 1С | future | _saleLike из scan_ | backlog |
| FitGOAnalytics `/sales` | optional HTTP | отдельный сервис | не wired |

## Запись в 1С (write)

| Операция | Роль | Канал | Примечание |
|----------|------|-------|------------|
| Запись / отмена группового | client | forma_v3 | не FitGOIntegration |
| Создание контрагента | admin/client | TBD | после scan |
| Продление / заморозка | client | fitgo_http `POST /membership/freeze` | `Документ.ОперацииСЧленствомПакетомУслуг`, операция Заморозка |
| PT | trainer | fitgo_db | не в 1С |

## После прогона сканера

1. Вставить в таблицу выше значения из `bindings`.
2. В `FitGOIntegration_Клиенты.bsl` оставить **один** победивший `queryProbe` + чтение `СрокДействия` с элемента.
3. Задеплоить расширение на `:8445` и проверить `GET /membership?externalId=…`.
