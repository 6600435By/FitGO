#!/usr/bin/env bash
# Cloud Agent: start the local PostgreSQL 16 cluster and ensure the fitgo
# role + database exist. Idempotent — safe to run on every boot.
set -euo pipefail

PG_VERSION="16"
DB_USER="fitgo"
DB_PASSWORD="fitgo"
DB_NAME="fitgo"

if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  echo "PostgreSQL ${PG_VERSION} is not installed (pg_ctlcluster missing)." >&2
  echo "It is expected to be baked into the environment image/snapshot." >&2
  exit 1
fi

# Start the cluster only if it is not already accepting connections.
if ! pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
  sudo pg_ctlcluster "${PG_VERSION}" main start >/dev/null 2>&1 || true
fi

# Wait for readiness.
for _ in $(seq 1 30); do
  if pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

if ! pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
  echo "PostgreSQL is not accepting connections on 127.0.0.1:5432" >&2
  exit 1
fi

# Ensure role + database exist (idempotent).
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
  END IF;
END
\$\$;
SQL

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
fi
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER DATABASE ${DB_NAME} OWNER TO ${DB_USER};" >/dev/null

echo "PostgreSQL ${PG_VERSION} is ready (database '${DB_NAME}', role '${DB_USER}')."
