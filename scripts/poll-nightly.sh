#!/usr/bin/env bash
# The nightly bridge poll (ADR-0033 decision 7), started at 07:00 UTC by the
# Windows Task Scheduler task that scripts/windows/register-nightly-poll.ps1
# registers, through `wsl.exe -d monsterpaws-dev`. Unattended, so nothing
# from pass: the ssh config host `monsterpaws-bridge` names the droplet and
# the key whose forced command is the poll. Appends to
# var/nightly/<date>.log; the poll heartbeat, not this log, is what alerts.
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p var/nightly
LOG="var/nightly/$(date -u +%F).log"

# A task starts a non-interactive shell, which never reads .bashrc — without
# this, node (via nvm) is not on PATH and the proxy cannot start.
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

{
  echo "== nightly poll $(date -u +%FT%TZ)"
  command -v node >/dev/null || { echo "node not on PATH — nvm not found under $NVM_DIR"; exit 1; }
  # A hung run must not hold the port and the container name into the next night.
  BRIDGE_SSH_HOST=${BRIDGE_SSH_HOST:-monsterpaws-bridge} timeout --kill-after=60 3h scripts/poll-via-bridge.sh
  echo "== exit $? $(date -u +%FT%TZ)"
} >> "$LOG" 2>&1
