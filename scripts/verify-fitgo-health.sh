#!/usr/bin/env bash
# Probe FitGOIntegration health (stub or real 1C).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
if [[ -f "$ROOT/apps/api/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT/apps/api/.env"
  set +a
fi

URLS=(
  "${FORMA_FITGO_URL%/}/health"
  "http://127.0.0.1:3045/fitgo/v1/health"
  "https://192.168.1.20:8445/fitgo/hs/fitgo/v1/health"
  "https://192.168.1.20:444/fitgo/hs/fitgo/v1/health"
)

AUTH_ARGS=()
if [[ -n "${FORMA_API_KEY:-}" ]]; then
  AUTH_ARGS+=(-H "apikey: ${FORMA_API_KEY}" -H "Authorization: Basic ${FORMA_BASIC_AUTH}")
fi

ok=0
for url in "${URLS[@]}"; do
  [[ -z "$url" || "$url" == "/health" ]] && continue
  code=$(curl -sk -m 5 -o /tmp/fitgo-health.json -w "%{http_code}" "${AUTH_ARGS[@]}" "$url" || echo 000)
  echo "$code  $url"
  if [[ "$code" == "200" ]]; then
    head -c 200 /tmp/fitgo-health.json; echo
    ok=1
  fi
done

if [[ "$ok" -ne 1 ]]; then
  echo "No FitGOIntegration health 200. Start stub: node scripts/fitgo-integration-dev-stub.mjs"
  echo "Or RDP → publish extension on WS2016 :8445 (see docs/SERVER_1C_FITGO_PUBLICATION.md)"
  exit 1
fi
