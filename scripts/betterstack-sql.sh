#!/bin/sh
# Read-only SQL against Better Stack's telemetry (ADR-0010 as amended 2026-09-30):
#   scripts/betterstack-sql.sh "SELECT count() FROM remote(t606375_monsterpaws_exceptions) FORMAT TSV"
# Recent errors live in remote(t606375_monsterpaws_exceptions); older ones in
# s3Cluster(primary, t606375_monsterpaws_s3) WHERE _row_type = 4. The login is
# IP-allowlisted to the dev machine, so a changed home IP fails loudly here.
set -eu
q=${1:?usage: betterstack-sql.sh "<SQL>"}
host=$(pass show betterstack/sql-host | head -n1); host=${host#https://}; host=${host%/}
curl -4 -fsS -u "$(pass show betterstack/sql-username | head -n1):$(pass show betterstack/sql-password | head -n1)" \
  -H 'Content-type: plain/text' -X POST "https://$host?output_format_pretty_row_numbers=0" --data-binary "$q"
