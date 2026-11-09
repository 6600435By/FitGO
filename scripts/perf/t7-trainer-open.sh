#!/usr/bin/env bash
# T7: server timings for /trainer gp-home (lite+full) + insights and booking-control.
# Usage: ./scripts/perf/t7-trainer-open.sh [label]
# Env: API_BASE (default http://localhost:3011/api), EMAIL, PASSWORD
set -euo pipefail
LABEL="${1:-run}"
API_BASE="${API_BASE:-http://localhost:3011/api}"
EMAIL="${EMAIL:-trainer@demo.fitgo}"
PASSWORD="${PASSWORD:-trainer123}"

TOKEN=$(curl -s -X POST "$API_BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["accessToken"])')
FROM=$(python3 -c 'from datetime import date; print(date.today().replace(day=1).isoformat())')
TO=$(python3 -c 'from datetime import date; print(date.today().isoformat())')

echo "=== T7 $LABEL range=$FROM..$TO ==="
for i in 1 2 3; do
  tL=$(curl -s -o /tmp/t7-gp-lite.json -w "%{time_total}" \
    -H "Authorization: Bearer $TOKEN" "$API_BASE/trainer/gp-home?lite=1")
  t1=$(curl -s -o /tmp/t7-gp-home.json -w "%{time_total}" \
    -H "Authorization: Bearer $TOKEN" "$API_BASE/trainer/gp-home")
  t2=$(curl -s -o /tmp/t7-insights.json -w "%{time_total}" \
    -H "Authorization: Bearer $TOKEN" "$API_BASE/trainer/insights")
  t3=$(curl -s -o /tmp/t7-bc.json -w "%{time_total}" \
    -H "Authorization: Bearer $TOKEN" \
    "$API_BASE/trainer/booking-control?from=$FROM&to=$TO")
  echo "pass$i lite=${tL}s gp-home=${t1}s insights=${t2}s booking-control=${t3}s"
done

# Client order: lite first (main paint), then parallel full + insights
python3 - <<PY
import concurrent.futures, time, urllib.request
API="$API_BASE"
TOKEN="$TOKEN"

def get(path):
  req=urllib.request.Request(API+path, headers={"Authorization":"Bearer "+TOKEN})
  t0=time.perf_counter()
  with urllib.request.urlopen(req, timeout=120) as r:
    r.read()
  return time.perf_counter()-t0

t0=time.perf_counter()
lite=get("/trainer/gp-home?lite=1")
paint=time.perf_counter()-t0
with concurrent.futures.ThreadPoolExecutor(2) as ex:
  a=ex.submit(get,"/trainer/gp-home")
  b=ex.submit(get,"/trainer/insights")
  ga,gb=a.result(),b.result()
wall=time.perf_counter()-t0
print(f"client-sim main_paint={paint:.3f}s lite={lite:.3f}s full={ga:.3f}s insights={gb:.3f}s wall={wall:.3f}s")
PY
