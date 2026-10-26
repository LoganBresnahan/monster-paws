#!/usr/bin/env bash
# Nightly copy of the production database outside DigitalOcean (ADR-0003 as
# amended 2026-10-26): DO's own backups die with the cluster or the account, so
# this one lives in the R2 vault, on Cloudflare. Runs on the droplet from
# /etc/cron.d/monsterpaws-backup (doc/infra.md, Recurring ops); no client
# binary on the host — pg_dump and rclone run in pinned containers.
set -euo pipefail
cd "$(dirname "$0")/.."

# Read single keys, never `source` the files: a connection string is not shell syntax.
val() { grep -m1 "^$1=" "$2" | cut -d= -f2-; }

# The vault key lives in .env.backup, NEVER in .env: compose hands .env to the app
# and the worker, and the worker parses untrusted data daily (ADR-0011).
export DATABASE_URL RCLONE_CONFIG_R2_ACCESS_KEY_ID RCLONE_CONFIG_R2_SECRET_ACCESS_KEY RCLONE_CONFIG_R2_ENDPOINT
DATABASE_URL=$(val DATABASE_URL .env)
RCLONE_CONFIG_R2_ACCESS_KEY_ID=$(val R2_VAULT_ACCESS_KEY_ID .env.backup)
RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=$(val R2_VAULT_SECRET_ACCESS_KEY .env.backup)
RCLONE_CONFIG_R2_ENDPOINT=$(val R2_ENDPOINT .env.backup)
HEARTBEAT=$(val HEARTBEAT_DB_BACKUP_URL .env.backup || true)
: "${DATABASE_URL:?} ${RCLONE_CONFIG_R2_ACCESS_KEY_ID:?} ${RCLONE_CONFIG_R2_SECRET_ACCESS_KEY:?} ${RCLONE_CONFIG_R2_ENDPOINT:?}"

KEY="pgdump/$(date -u +%F).sql.gz"
# Secrets reach the containers by NAME (-e VAR), never as values on a command
# line that `ps` on the droplet would show.
rclone() {
  docker run --rm -i \
    -e RCLONE_CONFIG_R2_TYPE=s3 -e RCLONE_CONFIG_R2_PROVIDER=Cloudflare -e RCLONE_S3_NO_CHECK_BUCKET=true \
    -e RCLONE_CONFIG_R2_ACCESS_KEY_ID -e RCLONE_CONFIG_R2_SECRET_ACCESS_KEY -e RCLONE_CONFIG_R2_ENDPOINT \
    rclone/rclone:1.68.2 "$@"
}

# PG 16 client for the PG 16 cluster: pg_dump must be the server's major or newer.
docker run --rm -e DATABASE_URL postgres:16.4-alpine sh -c 'pg_dump --no-owner "$DATABASE_URL"' \
  | gzip | rclone rcat "r2:monsterpaws-vault/$KEY"

# An empty or missing object is a failed backup, whatever the pipeline exit said.
SIZE=$(rclone size --json "r2:monsterpaws-vault/$KEY" | sed -E 's/.*"bytes":([0-9]+).*/\1/')
[ "${SIZE:-0}" -gt 1000000 ] || { echo "backup $KEY is ${SIZE:-0} bytes — refusing to report success" >&2; exit 1; }
echo "$(date -u +%FT%TZ) $KEY $SIZE bytes"

# Better Stack's heartbeat goes red when a night passes without this ping.
if [ -n "$HEARTBEAT" ]; then curl -fsS -m 30 "$HEARTBEAT" >/dev/null; fi
