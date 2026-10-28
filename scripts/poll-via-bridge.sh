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
#   scripts/poll-via-bridge.sh --check         the droplet's preflight, no poll
#   BRIDGE_SSH_HOST=monsterpaws-bridge scripts/poll-via-bridge.sh
#                                              unattended (scripts/poll-nightly.sh)
#
# By hand it needs pass unlocked (the DO token only — every other secret stays
# in the droplet's .env). With BRIDGE_SSH_HOST it reads nothing from pass: the
# ssh config host names the droplet and the nightly key, whose forced command
# ignores flags (ADR-0033 decision 7). Either way it needs this checkout's
# node_modules (the proxy runs under tsx).
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=${BRIDGE_PORT:-18443}

if [ -n "${BRIDGE_SSH_HOST:-}" ]; then
  DEST=$BRIDGE_SSH_HOST
else
  DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token 2>/dev/null | head -n1) || true
  [ -n "$DIGITALOCEAN_ACCESS_TOKEN" ] || { echo "pass is locked or digitalocean/api-token is missing — unlock it and rerun" >&2; exit 1; }
  export DIGITALOCEAN_ACCESS_TOKEN
  IP=$(doctl compute droplet list --format Name,PublicIPv4 --no-header | awk '$1 == "monsterpaws" {print $2}')
  [ -n "$IP" ] || { echo "no droplet named monsterpaws" >&2; exit 1; }
  DEST=root@$IP
fi

WORK=$(mktemp -d)
mkdir -p var
PROXY_LOG="var/rg-proxy-$(date -u +%Y%m%dT%H%M%SZ).log"
node_modules/.bin/tsx scripts/rg-proxy.ts "$PORT" > "$PROXY_LOG" 2>&1 &
PROXY=$!
cleanup() {
  ssh -S "$WORK/ctl" -O exit "$DEST" 2>/dev/null || true
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
  -R "127.0.0.1:$PORT:127.0.0.1:$PORT" "$DEST"

# The droplet half is scripts/bridge-poll-droplet.sh in the droplet's checkout;
# through the nightly key the forced command runs it and this command is ignored.
if [ "${1:-}" = "--check" ]; then
  ssh -S "$WORK/ctl" "$DEST" "monsterpaws/scripts/bridge-poll-droplet.sh check"
  exit 0
fi
ARGS=""; [ $# -eq 0 ] || ARGS=$(printf '%q ' "$@")
ssh -S "$WORK/ctl" "$DEST" "monsterpaws/scripts/bridge-poll-droplet.sh $PORT $ARGS"
echo "finished $(date -u +%FT%TZ); the proxy's tunnels: $(grep -c ' CONNECT ' "$PROXY_LOG") allowed, $(grep -c ' refused ' "$PROXY_LOG") refused"
