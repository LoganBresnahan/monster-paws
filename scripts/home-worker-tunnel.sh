#!/usr/bin/env bash
# The art worker's way to production's Postgres (oplog 0027): 127.0.0.1:<port> here reaches the database from
# the droplet, and the house opens no port. Never retry faster than this: the droplet's ufw LIMIT on 22/tcp bans
# quick reconnects, and that ban would also lock out every deploy. Run the worker with the database's own hostname
# resolving here, so TLS still verifies it: docker run --network host --add-host "$DB_HOST:127.0.0.1".
set -euo pipefail
KEY=$HOME/.ssh/monsterpaws-home-worker
URL=$(pass show digitalocean/pg-home-worker-url | head -n1)
HOSTPORT=${URL#*@}; HOSTPORT=${HOSTPORT%%/*}
DB_HOST=${HOSTPORT%:*}; DB_PORT=${HOSTPORT##*:}
IP=$(DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token | head -n1) doctl compute droplet get monsterpaws --format PublicIPv4 --no-header)
SSH_PID=
trap '[ -n "$SSH_PID" ] && kill "$SSH_PID" 2>/dev/null; exit 0' TERM INT
while true; do
  ssh -i "$KEY" -o BatchMode=yes -o IdentitiesOnly=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 \
    -o ServerAliveCountMax=3 -o ConnectTimeout=10 -N -L "127.0.0.1:$DB_PORT:$DB_HOST:$DB_PORT" "root@$IP" &
  SSH_PID=$!
  wait "$SSH_PID" || true
  echo "[home-worker-tunnel] down at $(date -u +%T), retrying in 30 s" >&2
  sleep 30
done
