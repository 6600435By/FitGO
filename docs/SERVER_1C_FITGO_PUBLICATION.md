# Публикация 1С «fitgo» для FitGO (WS2016)

Изолированный контур на порту **445**. Публикация **`forma` @ :444 не изменяется**.

## Порядок

1. **Бэкап** — ИБ 1С, `httpd.conf`
2. **Probe-kit** — `scripts/windows/` или `C:\fitgo-probe\`
3. **Apache :445** — `install-apache-445.ps1` + шаблон `apache-vhost-445.conf.template`
4. **1С** — новая публикация `fitgo` (см. `fitgo-probe/docs/1C_PUBLICATION.md` или копия в probe-kit)
5. **Расширение** — HTTP-сервис `FitGOIntegration` (`fitgo-probe/1c-extension/`)
6. **Зонд** — `probe-all.ps1` → `report.md` → go/no-go

## URL

| Назначение | URL |
|------------|-----|
| REST расписание/запись | `https://<host>:445/fitgo/hs/api/v3/` |
| Кастомный API | `https://<host>:445/fitgo/hs/fitgo/v1/` |

## FitGO `.env`

```env
FITNESS_PROVIDER=forma
FORMA_BASE_URL=https://<host>:445/fitgo/hs/api/v3
FORMA_FITGO_URL=https://<host>:445/fitgo/hs/fitgo/v1
FORMA_API_KEY=...
FORMA_BASIC_AUTH=...
FORMA_DEFAULT_PASSWORD=...
```

При наличии `FORMA_FITGO_URL` включается композитный провайдер (`FormaFitgoCompositeProvider`).

## Откат

- Удалить VirtualHost `:445`
- Отключить расширение `FitGOIntegration`
- Публикация `forma` не затрагивается

Подробный probe-kit: репозиторий sibling `fitgo-probe` или `scripts/windows/`.
