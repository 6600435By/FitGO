# Webkassa ↔ FitGO (сверка кассы)

Вкладка **Нестыковки → Касса** сверяет чеки [cabinet.webkassa.by](https://cabinet.webkassa.by/) с оплатами `cash` / `card` из `ClubRevenueEntry` (1С Analytics).

Безнал 1С (`cashless`) и личный счёт (`personalAccount`) в сверку кассы не входят — они идут мимо КСО; на вкладке показываются справочно.

---

## 1. Как устроена интеграция

```
cabinet.webkassa.by
        │  login + export cheque_report (xlsx)
        ▼
  WebkassaFetcher  →  parseWebkassaXlsx  →  WebkassaReceipt (Postgres)
                                                        │
ClubRevenueEntry (1С sync) ─────────────────────────────┤
                                                        ▼
                                         discrepancies.salesTab
                                         (день: нал/карта; unmatched)
                                                        ▼
                                    Нестыковки → Касса (UI)
```

| Слой | Путь |
|------|------|
| Fetcher (HTTP login/export) | `apps/api/src/webkassa/webkassa-fetcher.ts` |
| Парсер xlsx | `apps/api/src/webkassa/webkassa-parser.ts` |
| Upsert + sync | `apps/api/src/webkassa/webkassa.service.ts` |
| Cron | `apps/api/src/webkassa/webkassa-scheduler.service.ts` |
| API | `POST /api/super-admin/webkassa/sync`, `upload-json`, `upload` |
| Сверка | `apps/api/src/discrepancies/discrepancies.service.ts` → `salesTab` |
| UI | `apps/web/src/components/discrepancies/discrepancies-workspace.tsx` |

Файл отчёта на диск не кладётся — только строки в `WebkassaReceipt` (retention ~92 дня, `DISCREPANCY_RETENTION_DAYS`).

### Соответствие полей

| Webkassa (xlsx) | FitGO | 1С сверка |
|-----------------|-------|-----------|
| Наличные | `cash` | `ClubRevenueEntry.cash` |
| Безналичные | `cashless` | `ClubRevenueEntry.card` |
| ID чека | `receiptId` (unique per club) | — |
| Дата документа | `occurredAt` (Europe/Minsk) | `paidAt` / `occurredAt` |
| Статус КЭД | только `OK` участвует | — |
| Тип КЭД «возврат» | знак − | `operationType=refund` |

Сопоставление: окно ±10 мин (`DISCREPANCY_SALES_MATCH_WINDOW_MIN`), сумма чека ≈ сумма оплаты документа (склейка строк номенклатуры одного документа; составные пары несколько↔один).

---

## 2. Пошаговая настройка API-выгрузки

### Шаг A — доступ в кабинет

1. Логин/пароль оператора с правом **отчёта по чекам** (cheque report).
2. Убедиться, что в кабинете скачивается файл вида  
   `cheque_report_{fromMs}_{toMs}.xls` (xlsx внутри).

### Шаг B — два разных «login» на одном домене

| URL | Что это | Пароль FitGO |
|-----|---------|--------------|
| [cabinet.webkassa.by/login](https://cabinet.webkassa.by/login) | **ЛК СПД** (личный кабинет оператора) | Да — вход в веб-кабинет |
| `…/rsCashAppsWeb/login` | HTML-форма Spring Security API | **Нет** — пароль перед POST шифруется (salt + bcrypt) |

Не копируйте `https://cabinet.webkassa.by/rsCashAppsWeb/login` в `WEBKASSA_LOGIN_URL` и не проверяйте пароль, открыв эту страницу в браузере — форма «Please sign in» отвергнет логин ЛК.

Реальный API кабинета (база `/rsCashAppsWeb`):

1. `GET /rsCashAppsWeb/index` → заголовок `X-CSRF-TOKEN`
2. `POST /rsCashAppsWeb/noauth/crypto/salt` body `{ "value": "<login>" }`
3. Пароль преобразуется в браузере, затем `POST /rsCashAppsWeb/login` (form-urlencoded)
4. Отчёт Excel: **`POST`** `/rsCashAppsWeb/cashdocs/report/checks/100` с телом периода  
   (не GET — иначе 500 «метод GET не существует»)

Пока FitGO не повторяет crypto-login, **автовыгрузка по env не работает**. Рабочий путь:

1. Войти на [cabinet.webkassa.by/login](https://cabinet.webkassa.by/login)
2. Отчёты → история чеков → скачать `cheque_report_*.xls`
3. **Нестыковки → Касса → Загрузить xlsx**

Не подставляйте URL 1С (`/forma/hs/…`). URL `…/cashdocs/report/checks/100` без сессии и без POST тоже не сработает.

### Шаг C — env API (`apps/api/.env`)

```bash
WEBKASSA_LOGIN=FitGO          # логин ЛК (как на cabinet.webkassa.by/login)
WEBKASSA_PASSWORD=...
# Пока не ставьте WEBKASSA_LOGIN_URL / WEBKASSA_EXPORT_URL —
# /rsCashAppsWeb/login и /cashdocs/report/checks/100 без crypto+POST не работают.
# ENABLE_WEBKASSA_CRON=false
# DISCREPANCY_RETENTION_DAYS=92
```

Перезапустить Nest API.

### Шаг D — проверка

1. **Нестыковки → Касса** → период (например «сегодня») → **Выгрузить из Webkassa**.
2. В статусе должна появиться дата успеха и `lastCount > 0`.
3. Дни с расхождением подсветятся; фильтр **Нал / Карта / Все** сужает список.
4. При ошибке login/export текст попадёт в `lastError` на карточке.

### Шаг E — автовыгрузка (cron)

При заданных `WEBKASSA_LOGIN` / `WEBKASSA_PASSWORD` и `ENABLE_WEBKASSA_CRON` ≠ `false`:

- каждые ~2 часа — последние 2 дня;
- ночью (~02:00) — последние 7 дней.

Клубы берутся из БД (у кого есть sync state / активные клубы — см. scheduler).

---

## 3. Ручная загрузка xlsx

Если логин ещё не настроен или кабинет режет API:

1. В кабинете скачать отчёт за нужные даты.
2. **Нестыковки → Касса → Загрузить xlsx**.

Браузер шлёт `POST /api/super-admin/webkassa/upload-json` с `fileBase64` (не multipart):  
rewrite Next `/api → Nest` ломает FormData (`Multipart: Unexpected end of form`).  
Прямой `POST …/upload` (multipart) остаётся для curl/скриптов без прокси Next.

Лимит файла: 20 МБ.

---

## 4. Что смотреть при расхождениях

| Сигнал | Типичная причина |
|--------|------------------|
| День: diff нал ≠ 0 | Чек налом без оплаты 1С / наоборот; возврат не отражён |
| День: diff карта ≠ 0 | То же по безналу КСО ↔ `card` в 1С |
| Чек без пары | Оплата в 1С другим tender (ЛС/безнал) или вне окна 10 мин |
| Оплата 1С без чека | Не пробили КСО / другой день / смешанный чек уже сматчен иначе |
| Безнал 1С справочно | Не ошибка кассы — перевод/безнал мимо КСО |

Клики по суммам 1С ведут в **Продажи** с `payment=cash|card`.
