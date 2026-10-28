#!/usr/bin/env bash
# The droplet half of the poll bridge (ADR-0033): the poll in the droplet's own
# worker image, .env and CA, with only RescueGroups' requests sent through the
# reverse forward to home. Started by scripts/poll-via-bridge.sh over its one
# SSH connection — as a root command, or as the forced command of the nightly
# key, whose authorized_keys line names this file with --from-key.
#
#   bridge-poll-droplet.sh <port> [poll flags…]    a root session
#   bridge-poll-droplet.sh check                   the preflight only, no poll
#   bridge-poll-droplet.sh --from-key              the nightly key's forced command
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${1:-}" = "--from-key" ]; then
  # The client's command never reaches the poll: a key taken from home can
  # start one unflagged poll on the one port permitlisten opens, or the
  # preflight, and nothing else (ADR-0033 decision 7).
  case "${SSH_ORIGINAL_COMMAND:-}" in
    "check" | "monsterpaws/scripts/bridge-poll-droplet.sh check") set -- check ;;
    *) set -- 18443 ;;
  esac
fi

for v in DATABASE_URL RESCUEGROUPS_API_KEY HEARTBEAT_INGEST_POLL_URL IMAGE_TAG; do
  grep -q "^$v=." .env || { echo "the droplet's .env has no $v" >&2; exit 1; }
  # compose strips quotes from env_file values and `docker run --env-file`
  # keeps them, so a quoted value would reach the worker with its quotes on.
  ! grep -q "^$v=[\"']" .env || { echo "the droplet's .env quotes $v — docker run would keep the quotes" >&2; exit 1; }
done
[ -s do-ca.crt ] || { echo "the droplet has no do-ca.crt" >&2; exit 1; }
TAG=$(grep -m1 '^IMAGE_TAG=' .env | cut -d= -f2)
if [ "${1:-}" = "check" ]; then
  echo "bridge preflight ok on the droplet — worker image ${TAG:0:7}, .env and CA present"
  exit 0
fi

PORT=$1; shift
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
