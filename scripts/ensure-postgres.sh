#!/usr/bin/env bash
# Start local Homebrew PostgreSQL if it is not accepting connections.
set -euo pipefail

export LC_ALL="${LC_ALL:-en_US.UTF-8}"
export LANG="${LANG:-en_US.UTF-8}"

if [[ -d /usr/local/var/postgresql@16 ]]; then
  PGDATA="/usr/local/var/postgresql@16"
  PGLOG="/usr/local/var/log/postgresql@16.log"
  export PATH="/usr/local/opt/postgresql@16/bin:/usr/local/bin:$PATH"
elif [[ -d /opt/homebrew/var/postgresql@16 ]]; then
  PGDATA="/opt/homebrew/var/postgresql@16"
  PGLOG="/opt/homebrew/var/log/postgresql@16.log"
  export PATH="/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/bin:$PATH"
else
  echo "PostgreSQL 16 data directory not found." >&2
  echo "macOS: brew install postgresql@16" >&2
  echo "Windows / Docker: docker compose up -d   (see README)" >&2
  exit 1
fi

if pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
  exit 0
fi

if [[ -f "$PGDATA/postmaster.pid" ]]; then
  pid="$(head -n1 "$PGDATA/postmaster.pid" || true)"
  if [[ -n "${pid:-}" ]] && ! ps -p "$pid" -o comm= 2>/dev/null | grep -qi postgres; then
    echo "Removing stale PostgreSQL lock (PID $pid is not postgres)"
    rm -f "$PGDATA/postmaster.pid"
  fi
fi

mkdir -p "$(dirname "$PGLOG")"
pg_ctl -D "$PGDATA" -l "$PGLOG" start >/dev/null 2>&1 || true

for _ in $(seq 1 20); do
  if pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
    exit 0
  fi
  sleep 0.5
done

echo "PostgreSQL is not accepting connections on 127.0.0.1:5432" >&2
echo "Log: $PGLOG" >&2
exit 1
