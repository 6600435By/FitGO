#!/usr/bin/env bash
# Deploy FitGO on a VPS (hoster.by): pull, build, pm2 restart.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

git pull --ff-only
pnpm install
pnpm --filter @fitgo/shared-types build
pnpm --filter @fitgo/1c-adapter build
pnpm --filter @fitgo/osmi-adapter build
pnpm --filter @fitgo/api exec prisma generate
pnpm --filter @fitgo/api build
pnpm --filter @fitgo/web build

if command -v pm2 >/dev/null 2>&1; then
  pm2 startOrReload "$ROOT/deploy/ecosystem.config.cjs" --update-env
  pm2 save
  echo "PM2 reloaded."
else
  echo "pm2 not found — build OK; start with: pm2 start deploy/ecosystem.config.cjs"
fi
