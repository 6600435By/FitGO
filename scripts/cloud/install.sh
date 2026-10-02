#!/usr/bin/env bash
# Cloud Agent: idempotent repository bootstrap.
#   - installs workspace dependencies (frozen lockfile)
#   - builds internal packages consumed by the API/web apps
#   - prepares apps/api/.env
#   - generates the Prisma client
#   - starts PostgreSQL, syncs the schema and seeds demo data
# Safe to run repeatedly.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"

echo "==> Installing dependencies"
pnpm install --frozen-lockfile

echo "==> Building internal packages"
pnpm dev:deps

echo "==> Preparing apps/api/.env"
if [ ! -f apps/api/.env ]; then
  cp .env.example apps/api/.env
fi

echo "==> Generating Prisma client"
pnpm db:generate

echo "==> Ensuring PostgreSQL is up"
bash scripts/cloud/start-postgres.sh

echo "==> Syncing database schema"
pnpm db:push

echo "==> Seeding demo data"
pnpm db:seed

echo "==> Install complete"
