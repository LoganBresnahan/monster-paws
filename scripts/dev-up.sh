#!/usr/bin/env bash
# One command from a cold machine to a running dev server, in the only safe
# order: database → env → migrate → poll (if the corpus is stale) → dev.
# Migrate ALWAYS runs before poll — a poll into a schema that is behind is the
# one ordering that can corrupt the corpus.
#
# The poll runs in the background (it takes ~15 min for ~640 pages) with
# `db:dump` chained after it, since the local corpus is still the only copy
# (ADR-0017). It is skipped when the newest sighting is within
# VISIBILITY_WINDOW_DAYS (src/core/animals.ts): past that window every animal
# is invisible, and browse renders empty until a poll re-sees them.
set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER=${PG_CONTAINER:-dogchain-db-1}
STALE_DAYS=${STALE_DAYS:-7}   # one day inside the 8-day window
psql() { docker exec "$CONTAINER" psql -U monsterpaws -d monsterpaws -tAc "$1"; }

echo "▸ db:up";     npm run -s db:up
echo "▸ waiting for postgres"
for _ in $(seq 1 30); do
  docker exec "$CONTAINER" pg_isready -U monsterpaws -q && break
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U monsterpaws -q || { echo "postgres never became ready" >&2; exit 1; }

echo "▸ env:dev";   npm run -s env:dev
echo "▸ db:migrate"; npm run -s db:migrate

mkdir -p var/logs
LOG="var/logs/poll-$(date +%F).log"
if pgrep -f "ingest-cli.ts poll" >/dev/null; then
  echo "▸ poll already running — see $LOG"
else
  newest=$(psql "select coalesce(max(last_seen_at)::text, '') from animal_identities")
  stale=$(psql "select coalesce(max(last_seen_at) < now() - interval '${STALE_DAYS} days', true) from animal_identities")
  if [ "$stale" = "t" ]; then
    echo "▸ corpus stale (newest sighting: ${newest:-none}) — polling in background, then db:dump → $LOG"
    setsid nohup bash -c 'npm run -s ingest -- poll && npm run -s db:dump' > "$LOG" 2>&1 < /dev/null &
  else
    echo "▸ corpus fresh (newest sighting: $newest) — skipping poll"
  fi
fi

echo "▸ dev"
exec npm run -s dev
