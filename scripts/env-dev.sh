#!/usr/bin/env bash
# Scaffold .env for local dev: copy the example once, then fill the secrets
# that live in `pass`. Idempotent — an existing value is never overwritten.
# Next.js reads .env itself; the tsx scripts (worker, ingest) load it via
# --env-file-if-exists, so nothing here needs to be exported into your shell.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp .env.example .env
  echo "created .env from .env.example"
fi

fill() {
  local var=$1 entry=$2
  if grep -q "^${var}=" .env; then
    echo "$var already set"
    return
  fi
  if ! command -v pass >/dev/null; then
    echo "$var: pass not installed — set it by hand" >&2
    return
  fi
  local value
  if value=$(pass show "$entry" 2>/dev/null) && [ -n "$value" ]; then
    printf '\n%s=%s\n' "$var" "$value" >> .env
    echo "$var filled from pass ($entry)"
  else
    echo "$var: pass has no '$entry' — set it by hand" >&2
  fi
}

fill RESCUEGROUPS_API_KEY rescuegroups/api-key
