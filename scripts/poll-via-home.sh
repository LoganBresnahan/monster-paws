#!/usr/bin/env bash
# Run the production poll from this machine, writing to the production
# database through an SSH tunnel to the droplet (doc/infra.md, "Poll from
# home"; oplog 0001). For a day the droplet cannot reach a source:
# RescueGroups reset every connection from the droplet's address from
# 2026-10-27. Same worker image, same command, same database checks as the
# droplet's own job — only the address the source sees is ours at home.
#
#   scripts/poll-via-home.sh                 one poll, as the 07:00 job would
#   scripts/poll-via-home.sh --max-daily-disappearance 0.08   flags pass through
#
# Needs pass unlocked (database URL, RescueGroups key, DO token, heartbeat).
set -euo pipefail
cd "$(dirname "$0")/.."

need() { pass show "$1" 2>/dev/null | head -n1 || { echo "pass is locked or $1 is missing — unlock it and rerun" >&2; exit 1; }; }
DIGITALOCEAN_ACCESS_TOKEN=$(need digitalocean/api-token); export DIGITALOCEAN_ACCESS_TOKEN
DATABASE_URL=$(need digitalocean/database-url); export DATABASE_URL
RESCUEGROUPS_API_KEY=$(need rescuegroups/api-key); export RESCUEGROUPS_API_KEY
HEARTBEAT=$(need betterstack/heartbeat-ingest-poll)

IP=$(doctl compute droplet list --format Name,PublicIPv4 --no-header | awk '$1 == "monsterpaws" {print $2}')
[ -n "$IP" ] || { echo "no droplet named monsterpaws" >&2; exit 1; }
# ONE SSH connection for everything: the droplet's firewall refuses a source
# that opens 6 connections in 30 s (2026-10-27), so every call below rides the
# master opened here.
WORK=$(mktemp -d)
SSH=(ssh -o ConnectTimeout=10 -o ServerAliveInterval=15 -S "$WORK/ctl" "root@$IP")
ssh -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ExitOnForwardFailure=yes -f -N -M -S "$WORK/ctl" "root@$IP"
cleanup() { ssh -S "$WORK/ctl" -O exit "root@$IP" 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT

# host and port from postgresql://user:secret@HOST:PORT/db?… — never printed
HOSTPORT=${DATABASE_URL#*@}; HOSTPORT=${HOSTPORT%%/*}
DB_HOST=${HOSTPORT%:*}; DB_PORT=${HOSTPORT##*:}

# Exactly what production runs: its image tag and its CA, read from the droplet.
TAG=$("${SSH[@]}" "grep -m1 '^IMAGE_TAG=' monsterpaws/.env | cut -d= -f2")
"${SSH[@]}" 'cat monsterpaws/do-ca.crt' > "$WORK/do-ca.crt"

# The tunnel, added to the same connection: 127.0.0.1:$DB_PORT here → the
# database's private address, from the droplet. The container resolves the
# database's own hostname to 127.0.0.1, so TLS still verifies the certificate
# against that name.
ssh -S "$WORK/ctl" -O forward -L "127.0.0.1:$DB_PORT:$DB_HOST:$DB_PORT" "root@$IP" >/dev/null

echo "polling into production from here — worker image ${TAG:0:7}, $(date -u +%FT%TZ)"
# Secrets reach the container by NAME (-e VAR), never as values on a command line.
docker run --rm --network host --add-host "$DB_HOST:127.0.0.1" \
  -e DATABASE_URL -e RESCUEGROUPS_API_KEY -e NODE_EXTRA_CA_CERTS=/run/do-ca.crt \
  -v "$WORK/do-ca.crt:/run/do-ca.crt:ro" \
  "ghcr.io/loganbresnahan/monster-paws-worker:$TAG" npm run -s ingest -- poll "$@"

# The droplet's job pings after a complete poll; this run stands in for it.
curl -fsS -m 30 "$HEARTBEAT" >/dev/null && echo "heartbeat pinged"
