# T7 trainer open — measured results

Test set: `trainer@demo.fitgo` / `trainer123`, local API `http://localhost:3011/api`, period **2026-11-01..2026-11-09** (month→today). Script: `scripts/perf/t7-trainer-open.sh`.

## Server requests (curl `time_total`)

| Phase | gp-home | insights | booking-control | parallel wall (home+insights) |
|-------|---------|----------|-----------------|-------------------------------|
| **Baseline** pass1 | 3.42s | 5.07s | 0.12s | — |
| Baseline pass2 | 4.40s | 5.52s | 0.13s | — |
| Baseline pass3 | 3.24s | 3.10s | 0.12s | **8.09s** |
| **After cold** (TTL expired) pass1 | 3.56s | **0.30s** | 0.12s | — |
| After cold pass2 | **0.14s** | 0.28s | 0.11s | — |
| After cold parallel | 0.17s | 0.30s | — | **0.31s** |
| **After warm** (within TTL) | ~0.11–0.16s | ~0.22–0.30s | ~0.08–0.19s | **~0.35s** |

## Client render (same set, inferred from fetch gate)

| Screen | Before | After |
|--------|--------|-------|
| Сегодня `/trainer` | Waited `max(gp-home, insights)` ≈ **5–8s** wall before leaving skeleton | Leaves skeleton on **gp-home** only (~3.5s cold; soft-cache → instant paint + background revalidate). Insights have own skeleton. |
| Журнал `/trainer/my-sessions` | Full list gate; empty copy on error possible | Soft-cache paint; `listError` vs empty; refetch keeps rows when same period; date change clears then loads |

## What changed the numbers

1. `TrainerMonthAnalyticsService.forTrainer` 45s in-memory TTL — insights no longer re-runs month `booking-control.list` after gp-home.
2. Today UI no longer `Promise.all`-blocks on insights.
3. Client soft-cache (`trainer-fetch-cache`) for gp-home + trainer booking list; abort on period change; patch list row after confirm.

Offline is **not** promised; list still reads Postgres (1C-synced + FitGO local).
