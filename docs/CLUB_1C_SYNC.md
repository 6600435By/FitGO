# Club-wide 1C sync (staff app)

## Principle

Staff screens read **only FitGO Postgres**. Live 1C reads happen in:

- `ClubSyncOrchestrator` (nightly FULL / manual LIGHT)
- `BookingGateway` (group book/cancel write path + PENDING_1C reconcile)
- Dual-gate SPA consume / attendance write-backs

## Profiles

| | Manual LIGHT (кнопка) | Nightly FULL (03:00–04:00 MSK) |
|--|------------------------|--------------------------------|
| Sales / revenue | yesterday–today, no change-log | incremental window + `scope=changes` |
| Classes / visits | today ±1 day | provider default (wider) |
| Schedule slots | today + 2 days | today + 14 days |
| PT sales | today ±1 day | 14 days |
| Specialist debts / memberships | **skipped** | full (rate-limited membership walk) |
| Run budget | 3 min → PARTIAL | 40 min → PARTIAL |
| Analytics HTTP timeout | 90 s per `/sales` call | same |

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

## Planned 1C: bulk memberships

Until `GET /v1/memberships?changedSince=&page=` exists in FitGOIntegration, nightly sync walks active club clients with `getMembership` (rate-limited). See [FITGO_1C_HTTP_API.md](./FITGO_1C_HTTP_API.md).
