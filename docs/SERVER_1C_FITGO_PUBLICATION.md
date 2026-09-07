# Публикация 1С «fitgo» для FitGO (WS2016)

Изолированный контур на порту **8445** (порт **445 занят SMB** — не использовать для HTTPS).  
Публикация **`forma` @ :444 не изменяется**.

## Локальная разработка (Mac, без RDP)

Пока расширение не установлено на сервере, поднимите stub:

```bash
# из корня FitGO, с загруженным apps/api/.env
set -a && source apps/api/.env && set +a
node scripts/fitgo-integration-dev-stub.mjs
```

```env
FORMA_FITGO_URL=http://127.0.0.1:3045/fitgo/v1
```

Проверка: `bash scripts/verify-fitgo-health.sh` → HTTP 200.

Stub **не** заменяет прод: после RDP-публикации смените URL на WS2016 `:8445`.

## Порядок на сервере (RDP `director2` @ `192.168.1.20`)

1. **Бэкап** — ИБ 1С, `httpd.conf`
2. **Probe-kit** — `C:\fitgo-probe\` (sibling `fitgo-probe` или `scripts/windows/`)
3. **Apache :8445** — VirtualHost → `htdocs\fitgo\` (не трогать корень `htdocs\` / forma)
4. **1С** — публикация `fitgo` (см. `fitgo-probe/docs/1C_PUBLICATION.md`)
5. **Расширение** — HTTP-сервис FitGOIntegration (BSL в `fitgo-probe/1c-extension/`, гайд `1C_CONFIGURATOR_INSTALL.md`)
6. **Зонд** — `probe-all.ps1` → `report.md` → go/no-go

## URL

| Назначение | URL |
|------------|-----|
| REST расписание (prod forma) | `https://192.168.1.20:444/forma/hs/api/v3/` |
| FitGO REST (изолированный) | `https://192.168.1.20:8445/fitgo/hs/api/v3/` |
| FitGOIntegration | `https://192.168.1.20:8445/fitgo/hs/fitgo/v1/` |
| Dev stub | `http://127.0.0.1:3045/fitgo/v1/` |

## FitGO `.env` (прод / VPN после публикации)

```env
FITNESS_PROVIDER=forma
FORMA_BASE_URL=https://192.168.1.20:444/forma/hs/api/v3
FORMA_FITGO_URL=https://192.168.1.20:8445/fitgo/hs/fitgo/v1
FORMA_API_KEY=...
FORMA_BASIC_AUTH=...
FORMA_DEFAULT_PASSWORD=...
NODE_TLS_REJECT_UNAUTHORIZED=0
```

При наличии `FORMA_FITGO_URL` включается композитный провайдер (`FormaFitgoCompositeProvider`).

## Откат

- Остановить VirtualHost `:8445`
- Отключить расширение FitGOIntegration
- Публикация `forma` не затрагивается

Подробный probe-kit: репозиторий sibling `fitgo-probe` или `scripts/windows/`.
