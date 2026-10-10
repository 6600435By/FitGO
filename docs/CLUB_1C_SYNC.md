# Club-wide 1C sync (staff app)

## Principle

Staff screens read **only FitGO Postgres**. Live 1C reads happen in:

- `ClubSyncOrchestrator` (nightly FULL / manual LIGHT)
- `BookingGateway` (group book/cancel write path + PENDING_1C reconcile)
- Dual-gate SPA consume / attendance write-backs

## Profiles

| | Manual LIGHT (кнопка) | AUTO TODAY (trainer screens) | Nightly FULL (03:00–04:00 MSK) |
|--|------------------------|--------------------------------|--------------------------------|
| Sales / revenue | yesterday–today, no change-log | **skipped** | incremental window + `scope=changes` |
| Classes / visits | today ±1 day | **today only** | provider default (wider) |
| Schedule slots | today + 2 days | **today only** | today + 14 days |
| PT sales | today ±1 day | **skipped** | 14 days |
| Specialist debts / memberships | **skipped** | **skipped** | full (rate-limited membership walk) |
| Run budget | 3 min → PARTIAL | 60 s → PARTIAL | 40 min → PARTIAL |
| Cooldown | 10 min (manual) | 10 min from any finished TODAY (SUCCESS/PARTIAL/FAILED); +15 min backoff after failure | once per night |
| Analytics HTTP timeout | 90 s per `/sales` call | n/a | same |

Old-date edits (класс 25.09, оплата за июнь) → night FULL or admin date-range backfill, not the button.

## Endpoints

| Method | Path | Who |
|--------|------|-----|
| GET | `/api/staff/sync/status` | All staff |
| POST | `/api/staff/sync/refresh` | Admin / Super-admin / Manager |

UI: `DataFreshness` shows **«Данные на dd.MM.yyyy HH:mm»** (Europe/Moscow).

## Night window

03:00–04:00 Europe/Moscow, once per club (`ClubSyncRun.nightKey`). Env: `ENABLE_CLUB_SYNC_CRON` (default on). Legacy `ENABLE_*_CRON` for sales/class/tasks are no-ops while club sync is enabled.

## Schema extras

After `pnpm db:push` apply:

```bash
psql "$DATABASE_URL" -f scripts/sql/club-sync-constraints.sql
```

Creates:

- partial unique index: one `RUNNING` `ClubSyncRun` per club
- `btree_gist` exclusion constraints for overlapping PT/SPA bookings

## Load / capacity (staff launch)

Analytics «Персонал» and payroll club summary must **not** call live 1C per page open:

- PT sales → `TrainerPtSale` (sync); live only via explicit refresh
- Installments → 15 min in-memory cache (warmed on LIGHT/FULL)
- Staff department tabs → filter client-side; one `GET …/staff` per period
- Manager block → `GET …/staff/manager-efficiency` only for ALL / MANAGER
- Integration HTTP gate: max 3 concurrent; Analytics: max 2; identical GETs single-flight
- Trainer roster / admin at-risk → `ClubMembershipSnapshot` + visits in Postgres
- Booking-control list → PT sales from `TrainerPtSale` only; live 1C on «Обновить из 1С»
- Chat / sync-status / sales backfill polls pause while the browser tab is hidden

`DATABASE_URL` should include `connection_limit=10` on the shared Windows box (see `fitgo-api.env.example`).

### Smoke capacity check (off-hours)

```bash
# From a machine that can reach Nest :3001 with a staff JWT
# Simulate N trainers opening schedule + 2 admins opening staff analytics
npx autocannon -c 10 -d 30 -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:3001/api/staff/sync/status
```

If `rphost` still spikes while FitGO screens only hit Postgres, consider moving Nest/Next/Postgres off the 1C host.

## Planned 1C: bulk memberships

Until `GET /v1/memberships?changedSince=&page=` exists in FitGOIntegration, nightly sync walks active club clients with `getMembership` (rate-limited). See [FITGO_1C_HTTP_API.md](./FITGO_1C_HTTP_API.md).
