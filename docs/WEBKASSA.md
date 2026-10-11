# Webkassa ↔ FitGO (сверка кассы)

Вкладка **Нестыковки → Касса** сверяет чеки [cabinet.webkassa.by](https://cabinet.webkassa.by/) с оплатами `cash` / `card` из `ClubRevenueEntry` (1С Analytics).

## Env (`apps/api/.env`)

```bash
WEBKASSA_LOGIN=...
WEBKASSA_PASSWORD=...
# Опционально — подставьте URL из Network в кабинете после разведки:
# WEBKASSA_LOGIN_URL=https://cabinet.webkassa.by/api/auth/login
# WEBKASSA_EXPORT_URL=https://cabinet.webkassa.by/api/reports/cheque_report?from={fromMs}&to={toMs}
# ENABLE_WEBKASSA_CRON=false   # отключить автовыгрузку
# DISCREPANCY_RETENTION_DAYS=92
```

Имя файла выгрузки из кабинета: `cheque_report_{fromMs}_{toMs}.xls` (xlsx).

## Ручная загрузка

Если логин/экспорт ещё не подобраны: на вкладке «Касса» → **Загрузить xlsx**. Файл не хранится — только строки в `WebkassaReceipt` (до 92 дней).

## Автовыгрузка

При заданных `WEBKASSA_LOGIN` / `WEBKASSA_PASSWORD` планировщик:

- каждые ~2 часа — последние 2 дня;
- ночью (~02:00) — последние 7 дней.

Если HTTP login/export не совпадает с реальным API кабинета, откройте DevTools → Network при входе и скачивании отчёта и поправьте `WEBKASSA_LOGIN_URL` / `WEBKASSA_EXPORT_URL`.
