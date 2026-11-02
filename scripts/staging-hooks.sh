#!/usr/bin/env bash
# The staging webhook's way in from Every.org to the dev server in
# monsterpaws-dev: outbound only, one path (scripts/staging-hooks.yml), never
# the droplet (ADR-0027 as amended 2026-11-02, oplog 0017).
#
#   scripts/staging-hooks.sh up | down | status
#
# The dev server it reaches is `npm run dev -- -p 3027`, its own port because
# another worktree's server on :3000 would answer 404 and the delivery would
# be lost: Every.org's docs state no retry.
set -euo pipefail
cd "$(dirname "$0")/.."

NAME=monsterpaws-staging-hooks
ENTRY=cloudflare/staging-hooks-tunnel-credentials
PORT=3027
# Multi-arch digest, read 2026-11-02. Bumped by hand, never `latest`: this
# process holds the tunnel's secret.
IMAGE=cloudflare/cloudflared:2026.10.7@sha256:4955524aeaa379e154023d5a027c250f7b35041a2e7e950cf13f144bc9b9c5ba

# cloudflared prints a failed request's whole URL, and the webhook's path holds
# our secret (ADR-0027 §4).
scrub() {
  sed -E 's#(/api/webhooks/everyorg/)[^ "]+#\1<secret>#g; s/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/<id>/g'
}

case "${1:-}" in
  up)
    creds=$(pass show "$ENTRY")
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    # By name from the environment, so the secret is never in a process's argv.
    TUNNEL_CRED_CONTENTS=$creds docker run -d --name "$NAME" --network host --restart no \
      -e TUNNEL_CRED_CONTENTS \
      -v "$PWD/scripts/staging-hooks.yml:/etc/cloudflared/config.yml:ro" \
      "$IMAGE" tunnel --config /etc/cloudflared/config.yml --no-autoupdate \
      run "$(jq -r .TunnelID <<<"$creds")" >/dev/null
    echo "tunnel started; npm run hooks -- status shows its connections"
    ;;
  down)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    echo "tunnel down: staging-hooks.monsterpaws.org answers 530 until the next up"
    ;;
  status)
    docker ps --filter "name=^${NAME}$" --format '{{.Names}}: {{.Status}}' | grep . || echo "tunnel down"
    docker logs --tail 40 "$NAME" 2>&1 | grep -E 'Registered tunnel connection| ERR ' | scrub || true
    if ss -ltn | grep -q ":$PORT "; then
      echo "dev server on :$PORT"
    else
      echo "no dev server on :$PORT (npm run dev -- -p $PORT): deliveries answer 502 and are lost"
    fi
    ;;
  *)
    echo "usage: scripts/staging-hooks.sh up | down | status" >&2
    exit 64
    ;;
esac
