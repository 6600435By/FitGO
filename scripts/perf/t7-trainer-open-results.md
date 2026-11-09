# T7 trainer open — measured results

Test set: `trainer@demo.fitgo` / `trainer123`, local API `http://localhost:3011/api`, period **2026-11-01..2026-11-09**. Script: `scripts/perf/t7-trainer-open.sh`.

## Server requests (curl `time_total`) — 2026-11-09 after lite split

| Phase | gp-home?lite=1 | gp-home (full) | insights | booking-control |
|-------|----------------|----------------|----------|-----------------|
| **Cold** pass1 | **0.13s** | 5.78s | 0.20s* | 0.09s |
| Warm pass2 | 0.02s | 0.03s | 0.14s | 0.06s |
| Warm pass3 | 0.03s | 0.02s | 0.18s | 0.05s |

\*insights after full warmed shared month-analytics TTL (~45s).

### Earlier baseline (before lite; full only)

| Phase | gp-home | insights | booking-control | parallel wall (home+insights) |
|-------|---------|----------|-----------------|-------------------------------|
| Baseline pass1 | 3.42–10.3s | 0.27–5.07s | 0.08–0.12s | **~8s** cold |

## Client render target

| Screen | Gate | Result |
|--------|------|--------|
| Сегодня `/trainer` | Leaves skeleton on **lite** gp-home only | Main (ближайшие + «Ждут отметки») ≈ **0.1–0.3s** API; KPI / помощник / цели догружаются вторым заходом |
| Журнал `/trainer/my-sessions` | Soft-cache peek (kind=`ALL`) + prefetch from Today | List paint from cache after Today open; live refetch in background |

## What changed

1. `GET /trainer/gp-home?lite=1` — today sessions + control queue; skips month analytics / month member scan.
2. Client: lite → paint → parallel full home + insights + journal list prefetch.
3. Soft TTL: gp-home lite/full ~20s server; month analytics ~45s; client `trainer-fetch-cache` ~45s.
4. Journal peek key aligned with list cache (`ALL||||`).
