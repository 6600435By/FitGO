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

### Шаг B — разведка Network (один раз)

Если дефолтные URL не совпали с вашим кабинетом:

1. Открыть [cabinet.webkassa.by](https://cabinet.webkassa.by/) → DevTools → **Network**.
2. Войти → найти запрос login (`POST`, JSON или form) → скопировать URL → `WEBKASSA_LOGIN_URL`.
3. Скачать отчёт за период → найти запрос файла → URL с датами →  
   `WEBKASSA_EXPORT_URL` с плейсхолдерами `{fromMs}` и `{toMs}` (миллисекунды).

Дефолты в коде:

```text
WEBKASSA_LOGIN_URL=https://cabinet.webkassa.by/api/auth/login
WEBKASSA_EXPORT_URL=https://cabinet.webkassa.by/api/reports/cheque_report?from={fromMs}&to={toMs}
```

Fetcher шлёт JSON `{ login, email, username, password }` и сохраняет cookie из `Set-Cookie`.

### Шаг C — env API (`apps/api/.env`)

```bash
WEBKASSA_LOGIN=...
WEBKASSA_PASSWORD=...
# Опционально после разведки:
# WEBKASSA_LOGIN_URL=...
# WEBKASSA_EXPORT_URL=...
# ENABLE_WEBKASSA_CRON=false   # отключить автовыгрузку
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
