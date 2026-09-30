#!/bin/sh
# Source maps for error reporting, in two halves that never run together
# (ADR-0010 as amended 2026-09-30):
#
#   scripts/sourcemaps.sh inject <out-dir>   inside the image build: stamp debug
#       IDs into .next (offline), sync them into the standalone server, copy the
#       JS + maps to <out-dir> for CI to export, then delete the browser maps so
#       the image never serves them.
#   scripts/sourcemaps.sh upload <dir>       CI's `sourcemaps` job: upload to the
#       error service, retrying until it confirms processing.
set -eu
cd "$(dirname "$0")/.."

case "${1:-}" in
  inject)
    out=${2:?usage: sourcemaps.sh inject <out-dir>}
    # The CLI refuses to run without *a* token even though inject never touches
    # the network — any value satisfies it, so the build holds no secret.
    export SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN:-offline}
    npx sentry sourcemaps inject .next/static >/dev/null
    npx sentry sourcemaps inject .next/server >/dev/null
    # The standalone server holds COPIES of the server chunks made before the
    # stamp; without this sync the running code carries no debug IDs and no
    # frame is ever resolved.
    (cd .next/standalone/.next/server && find . -name '*.js') | while read -r f; do
      cp ".next/server/$f" ".next/standalone/.next/server/$f"
    done
    mkdir -p "$out"
    cp -r .next/static "$out/static"
    cp -r .next/server "$out/server"
    find .next/static -name '*.map' -delete
    ;;
  upload)
    dir=${2:?usage: sourcemaps.sh upload <dir>}
    : "${SENTRY_AUTH_TOKEN:?}" "${SENTRY_URL:?}" "${SENTRY_ORG:?}" "${SENTRY_PROJECT:?}" "${BUILD_SHA:?}"
    # Better Stack assembles bundles slowly (minutes) and the CLI stops waiting
    # after ~5; a re-run re-sends nothing already held and only resumes the
    # wait, so retrying is how "processed" is reached.
    for attempt in 1 2 3 4 5 6; do
      if npx sentry sourcemaps upload --release "$BUILD_SHA" "$dir"; then
        echo "source maps processed (attempt $attempt)"
        exit 0
      fi
      echo "attempt $attempt did not confirm processing; retrying"
    done
    echo "source maps NOT confirmed after 6 attempts" >&2
    exit 1
    ;;
  *)
    echo "usage: sourcemaps.sh inject <out-dir> | upload <dir>" >&2
    exit 2
    ;;
esac
