#!/usr/bin/env bash
# Run the production poll ON THE DROPLET, with only RescueGroups' requests
# leaving through this machine (ADR-0033; doc/infra.md, "Poll via the
# bridge"). The droplet's address is refused by RescueGroups (ADR-0014 as
# amended); the database connection stays droplet → Managed Postgres, so a
# home network blip costs a page fetch, never a connection mid-write.
# scripts/poll-via-home.sh is the fallback.
#
#   scripts/poll-via-bridge.sh                 one poll, as the 07:00 job would
#   scripts/poll-via-bridge.sh --max-daily-disappearance 0.08   flags pass through
#
# Needs pass unlocked (the DO token only — every other secret stays in the
# droplet's .env) and this checkout's node_modules (the proxy runs under tsx).
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=${BRIDGE_PORT:-18443}

DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token 2>/dev/null | head -n1) || true
[ -n "$DIGITALOCEAN_ACCESS_TOKEN" ] || { echo "pass is locked or digitalocean/api-token is missing — unlock it and rerun" >&2; exit 1; }
export DIGITALOCEAN_ACCESS_TOKEN
IP=$(doctl compute droplet list --format Name,PublicIPv4 --no-header | awk '$1 == "monsterpaws" {print $2}')
[ -n "$IP" ] || { echo "no droplet named monsterpaws" >&2; exit 1; }

WORK=$(mktemp -d)
mkdir -p var
PROXY_LOG="var/rg-proxy-$(date -u +%Y%m%dT%H%M%SZ).log"
node_modules/.bin/tsx scripts/rg-proxy.ts "$PORT" > "$PROXY_LOG" 2>&1 &
PROXY=$!
cleanup() {
  ssh -S "$WORK/ctl" -O exit "root@$IP" 2>/dev/null || true
  kill "$PROXY" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT
for _ in $(seq 50); do grep -q "rg-proxy on" "$PROXY_LOG" && break; sleep 0.2; done
grep -q "rg-proxy on" "$PROXY_LOG" || { cat "$PROXY_LOG" >&2; exit 1; }
echo "rg-proxy on 127.0.0.1:$PORT, its log in $PROXY_LOG"

# ONE SSH connection, carrying the reverse forward: the droplet's firewall
# refuses a source that opens 6 connections in 30 s (2026-10-27), so the poll
# below rides this master and nothing else connects.
ssh -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ExitOnForwardFailure=yes -f -N -M -S "$WORK/ctl" \
  -R "127.0.0.1:$PORT:127.0.0.1:$PORT" "root@$IP"

# The droplet's own image, .env and CA, as compose hands them to the worker;
# --network host so the container's 127.0.0.1:$PORT is the forward.
ARGS=""; [ $# -eq 0 ] || ARGS=$(printf '%q ' "$@")
ssh -S "$WORK/ctl" "root@$IP" "bash -s -- $PORT $ARGS" <<'REMOTE'
set -euo pipefail
PORT=$1; shift
cd monsterpaws
for v in DATABASE_URL RESCUEGROUPS_API_KEY HEARTBEAT_INGEST_POLL_URL IMAGE_TAG; do
  grep -q "^$v=." .env || { echo "the droplet's .env has no $v" >&2; exit 1; }
  # compose strips quotes from env_file values and `docker run --env-file`
  # keeps them, so a quoted value would reach the worker with its quotes on.
  ! grep -q "^$v=[\"']" .env || { echo "the droplet's .env quotes $v — docker run would keep the quotes" >&2; exit 1; }
done
[ -s do-ca.crt ] || { echo "the droplet has no do-ca.crt" >&2; exit 1; }
TAG=$(grep -m1 '^IMAGE_TAG=' .env | cut -d= -f2)
echo "polling on the droplet, RescueGroups through home — worker image ${TAG:0:7}, $(date -u +%FT%TZ)"
# The fixed name refuses a second bridge poll while one is still running.
rc=0
docker run --rm --name monsterpaws-bridge-poll --network host --env-file .env \
  -e NODE_EXTRA_CA_CERTS=/run/do-ca.crt -v "$PWD/do-ca.crt:/run/do-ca.crt:ro" \
  -e NODE_USE_ENV_PROXY=1 -e "HTTPS_PROXY=http://127.0.0.1:$PORT" -e npm_config_update_notifier=false \
  "ghcr.io/loganbresnahan/monster-paws-worker:$TAG" npm run -s ingest -- poll "$@" || rc=$?
# This run stands in for the droplet's job: success only when the CLI says the
# run completed (it exits 2 when stage 5 was refused or skipped), /fail otherwise.
HEARTBEAT=$(grep -m1 '^HEARTBEAT_INGEST_POLL_URL=' .env | cut -d= -f2-)
if [ "$rc" -eq 0 ]; then
  curl -fsS -m 30 "$HEARTBEAT" >/dev/null && echo "heartbeat pinged" || echo "heartbeat ping failed" >&2
else
  curl -fsS -m 30 "${HEARTBEAT%/}/fail" >/dev/null && echo "heartbeat pinged /fail" || echo "heartbeat ping failed" >&2
  exit "$rc"
fi
REMOTE
echo "finished $(date -u +%FT%TZ); the proxy's tunnels: $(grep -c ' CONNECT ' "$PROXY_LOG") allowed, $(grep -c ' refused ' "$PROXY_LOG") refused"
