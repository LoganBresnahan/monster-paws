# Infrastructure runbook

Operational companion to ADR-0003/0007 and DIRECTION.md §Infrastructure.
Everything here is CLI-first so provisioning is reproducible and scriptable
into workflows later. Diagrams at the bottom are the source of truth for
the deployment shape; what moves *through* it is drawn in `doc/flows.md`
(ADR-0012).

## CLI roster

| Tool | For | Install | Auth |
| --- | --- | --- | --- |
| `doctl` | DigitalOcean: droplet, firewall, managed PG, snapshots | **installed 2026-07-29** (v1.164.0): release binary → `~/.local/bin` (chosen over snap — WSL2, no systemd dependency). Upgrade = re-download latest tarball to the same path | token lives in `pass` only (no `auth init`, no plaintext config): `DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token) doctl ...` — verified working 2026-07-29 |
| `wrangler` | Cloudflare R2 admin (bucket create/config) | **no install** — `npx wrangler@latest` (rare ops; keep it out of package.json) | **no stored token can drive it**: `cloudflare/r2-token` is object-scoped and 403s on every R2 REST call (verified 2026-09-29). Bucket admin is done in the dashboard (step 5b); objects go through `rclone_r2` |
| Cloudflare API (`curl`) | DNS records, SSL mode, cache — wrangler doesn't do DNS | — | `CF_API_TOKEN=$(pass show cloudflare/dns-token)` — token scoped Zone·DNS·Edit |
| `rclone` | Shipping pg_dumps + attestation mirror to R2 (S3-compatible) | `sudo apt install rclone` | `rclone config` → S3 provider, R2 endpoint |
| `gh` | repo, Actions runs, CI watch (already installed) | — | `gh auth login` |

## Secrets in `pass` — the registry

`pass` holds **every** credential for the project, not only the ones the app
runs with: it is how development — Claude included — reaches each service
securely, with no plaintext config on disk. An entry nothing in `src/` reads
is normal; it is a development credential, and never deleted for being
"unused".

Rules: names only, never a value, anywhere in this repo. Read a value at the
moment of use — `VAR=$(pass show <entry>) cmd` — and never echo it, write it
to a file, or paste it into a commit. Add a section row in the same commit
that adds an entry. The audit — both lists must come back empty, except rows
marked *not created yet*:

```sh
comm -3 <(cd ~/.password-store && find . -name '*.gpg' | sed 's#^\./##; s#\.gpg$##' | sort) \
        <(grep -oE '`(cloudflare|digitalocean|rescuegroups|resend|betterstack)/[a-z0-9-]+`' doc/infra.md | tr -d '`' | sort -u)
```
**Lands in** is where a copy lives besides `pass`: the droplet's `.env`
(prod), a GitHub Actions secret (CI), or *dev only*.

Not in `pass`, on purpose: `gh` keeps its own login (`gh auth login`), and CI
pushes to GHCR with the workflow's built-in `GITHUB_TOKEN`.

### DigitalOcean

| Entry | What it is | What it's for | Lands in |
| --- | --- | --- | --- |
| `digitalocean/api-token` | DO account API token (created 2026-07-29) | Everything `doctl` does: the droplet, firewall, monitoring alert policies (step 6c), snapshots, and Managed Postgres when step 6 lands | dev only |

```sh
DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token) doctl compute droplet list
DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token) doctl monitoring alert list
```
Never `doctl auth init` — it writes the token to a plaintext config file.

### Cloudflare — zone and email

| Entry | What it is | What it's for | Lands in |
| --- | --- | --- | --- |
| `cloudflare/dns-token` | API token: Zone · DNS · Edit, Zone Settings, Cache Purge | DNS records (step 3), SSL mode (step 4), zone settings such as Bot Fight Mode, cache purges after a deploy | dev only |
| `cloudflare/email-token` | API token: Email Routing rules (zone) + destination addresses (account) | The routing that forwards hello@ / security@ / logan@monsterpaws.org to Gmail — change a rule or add an address | dev only |

```sh
CF=$(pass show cloudflare/dns-token)
ZONE=$(curl -s -H "Authorization: Bearer $CF" \
  "https://api.cloudflare.com/client/v4/zones?name=monsterpaws.org" | jq -r '.result[0].id')
curl -s -H "Authorization: Bearer $CF" "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records" | jq '.result[].name'
curl -s -H "Authorization: Bearer $(pass show cloudflare/email-token)" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE/email/routing/rules" | jq '.result[].matchers'
```

### Cloudflare — R2 storage (ADR-0011)

Two credentials, never collapsed into one: the **worker** pair reaches media +
corpus, the **vault** pair reaches only the vault (pg_dumps, the attestation
mirror). Each pair is derived from an R2 token; the tokens are Object Read &
Write, so they work only through the S3 API — every R2 REST call 403s, and
`wrangler` cannot use them. Bucket admin (create, configure) is done in the
dashboard (step 5b).

| Entry | What it is | What it's for | Lands in |
| --- | --- | --- | --- |
| `cloudflare/r2-endpoint` | The account's S3 endpoint URL | Where every S3 client points, both pairs | droplet `.env` once the worker's R2 client is wired (not yet) |
| `cloudflare/r2-access-key-id` | Worker pair, access key id | Read/write media + corpus: vaulting scraped HTML (ADR-0011), card images | droplet `.env` `R2_ACCESS_KEY_ID`, once wired (not yet) |
| `cloudflare/r2-secret-access-key` | Worker pair, secret | same | droplet `.env` `R2_SECRET_ACCESS_KEY`, once wired (not yet) |
| `cloudflare/r2-vault-access-key-id` | Vault pair, access key id | Read/write the vault: nightly pg_dumps, the attestation mirror | droplet `.env` `R2_VAULT_ACCESS_KEY_ID`, when backups go live (step 6) |
| `cloudflare/r2-vault-secret-access-key` | Vault pair, secret | same | droplet `.env` `R2_VAULT_SECRET_ACCESS_KEY`, when backups go live |
| `cloudflare/r2-vault-endpoint` | Same URL as `r2-endpoint`, stored beside the vault pair | Nothing reads it today (`rclone_r2` uses `r2-endpoint` for both) | dev only |
| `cloudflare/r2-token` | Account-owned R2 token, Object Read & Write on media + corpus | The token the worker pair was derived from — re-derive the pair from it, or roll it to revoke the pair | dev only |
| `cloudflare/r2-vault-token` | Account-owned R2 token, Object Read & Write on the vault only | The token the vault pair was derived from | dev only |

```sh
rclone_r2 worker lsf r2:monsterpaws-corpus      # the function is defined in step 5
rclone_r2 vault  lsf r2:monsterpaws-vault
# An account-owned token verifies ONLY at the account endpoint —
# /user/tokens/verify always answers "Invalid API Token" for it:
ACCT=$(pass show cloudflare/r2-endpoint | sed -E 's#https?://([^.]+)\..*#\1#')
curl -s -H "Authorization: Bearer $(pass show cloudflare/r2-token)" \
  "https://api.cloudflare.com/client/v4/accounts/$ACCT/tokens/verify" | jq '.result.status'
```
Verified 2026-09-29, read side: the worker pair reads media + corpus and 403s
on the vault; the vault pair reads the vault and 403s on both others.

### RescueGroups

| Entry | What it is | What it's for | Lands in |
| --- | --- | --- | --- |
| `rescuegroups/api-key` | The API key granted 2026-08-02 on our key application | Polling the nationwide adoptable-animal feed (ADR-0006, ADR-0009). Replay needs no key — it reads the corpus | local `.env` via `npm run env:dev`; droplet `.env` `RESCUEGROUPS_API_KEY` at the first poller deploy |

```sh
npm run env:dev                         # fills RESCUEGROUPS_API_KEY into .env
npm run ingest -- poll --max-pages 1    # smoke: one page, partial (never disappears anything)
```
A wrong key is NOT detectable: the API returns 200 for any non-empty
Authorization header (verified 2026-08-17). Check that a poll returns animals.

### Resend

| Entry | What it is | What it's for | Lands in |
| --- | --- | --- | --- |
| `resend/api-key` | Sending-only API key, domain `monsterpaws.org` (DKIM verified 2026-07-30) | Outbound email as hello@monsterpaws.org: donor updates (roadmap item 8). Cannot read mail or change the domain | droplet `.env` when item 8 lands |

```sh
curl -s https://api.resend.com/emails -H "Authorization: Bearer $(pass show resend/api-key)" \
  -H "Content-Type: application/json" \
  -d '{"from":"hello@monsterpaws.org","to":"<you>","subject":"test","text":"test"}'
```

### Better Stack (ADR-0010) — errors, uptime, heartbeats

Team **Monster Paws** (id `606375`). Every resource below was created by API
from these tokens on 2026-09-29, and step 6d rebuilds them by command. No
global token exists or is needed — both team tokens cover everything we
create; a global one would only add cross-team, billing and usage access.

| Entry | What it is | What it's for | Lands in |
| --- | --- | --- | --- |
| `betterstack/telemetry-token` | Team telemetry API token (premade), read & write | Provisioning from a laptop: creating and inspecting the Errors application through the Telemetry/Errors APIs | dev only |
| `betterstack/telemetry-token-ci` | Team telemetry token named `ci-sourcemaps`, read & write — made by hand, since Better Stack has no API for minting tokens | Uploading source maps during CI's image build, so errors show TypeScript lines. Separate from the dev token so it can be revoked alone if CI leaks it | GH Actions secret `BETTERSTACK_SOURCEMAPS_TOKEN` |
| `betterstack/uptime-token` | Team uptime API token (premade), read & write | Creating, pausing and inspecting monitors and heartbeats by API | dev only |
| `betterstack/errors-dsn` | DSN of the Errors application `monsterpaws` (id `2778816`, `next_js_errors`, 90-day retention, linked to the GitHub repo), assembled as `https://<token>@<ingesting_host>/<id>` | Where the app and worker send errors through the Sentry SDK. Ingest-only, and public in the browser bundle by design — CI passes it to the image build as `NEXT_PUBLIC_SENTRY_DSN` | GH Actions secret `BETTERSTACK_ERRORS_DSN`; droplet `.env` `SENTRY_DSN` at the next deploy |
| `betterstack/heartbeat-ingest-poll` | URL of heartbeat `499765`, "ingest.poll — RescueGroups daily 07:00 UTC": period 24h, grace 3h, **created paused** | The worker pings it after each complete poll, `/fail` on failure; silence past the grace alerts. Secret, since anyone holding it can ping it and hide a real failure. Unpause it in the same deploy that turns the poller on, or it alerts every morning | droplet `.env` at the poller deploy |
| `betterstack/sql-host` | Host of the ClickHouse HTTP "SQL API" connection (team Monster Paws, created in the dashboard 2026-09-30 — a global token would be needed to create it by API) | Reading stored errors, stack frames and their source-map results: `scripts/betterstack-sql.sh` | dev only |
| `betterstack/sql-username` | That connection's username (rotated 2026-09-30 after the first was pasted into a chat) | same | dev only |
| `betterstack/sql-password` | That connection's password — shown once at creation, never retrievable. Read-only, IP-allowlisted to the dev machine's public address | same; if queries start failing, the home IP changed — update the allowlist | dev only |

Not secrets, so GitHub Actions *variables*: `BETTERSTACK_TEAM_ID` (`606375`),
`BETTERSTACK_ERRORS_APP_ID` (`2778816`), `BETTERSTACK_SOURCEMAPS_URL`
(`https://us-west-2a-sourcemaps.betterstackdata.com` — the region pattern from
the docs, resolved by DNS; the API does not expose it, so confirm it once
against the application's Advanced settings).

Monitors (uptime, 3-minute checks, email): `4995720` HTTP status on
`https://monsterpaws.org/` (made by hand 2026-09-29 — it proved Bot Fight Mode
lets the checker through); `4995794` keyword `"ok":true` on
`https://monsterpaws.org/api/health` — which returns 503 and `"ok":false` when
the database is unreachable or the poll is stale, so this one monitor carries
the silent-worker alert (ADR-0010 as amended 2026-09-30).

```sh
U=$(pass show betterstack/uptime-token)
curl -s -H "Authorization: Bearer $U" https://uptime.betterstack.com/api/v2/monitors \
  | jq -c '.data[] | {id, url: .attributes.url, status: .attributes.status}'
curl -s -X PATCH -H "Authorization: Bearer $U" -H "Content-Type: application/json" \
  -d '{"paused":false}' https://uptime.betterstack.com/api/v2/heartbeats/499765   # at the poller deploy
curl -fsS "$(pass show betterstack/heartbeat-ingest-poll)"   # a manual "it ran" ping
```

Notes: `flarectl` (Cloudflare's older Go CLI) is effectively superseded —
the two API curls below are all the DNS we need. `cloudflared` (tunnels) is
not needed; the droplet has a public IP behind the proxy.

## Provisioning (one-time, in order)

```sh
# 1. Droplet — Docker preinstalled via marketplace image, NYC3.
#    s-1vcpu-1gb ($6/mo) while traffic ~zero (ADR-0007 amended: it PULLS
#    images from GHCR, never builds). Upsize in place when load arrives —
#    downsizing is impossible, so start small.
doctl compute droplet create monsterpaws \
  --image docker-20-04 --size s-1vcpu-1gb --region nyc3 \
  --ssh-keys "$(doctl compute ssh-key list --format ID --no-header | head -1)" \
  --wait
IP=$(doctl compute droplet get monsterpaws --format PublicIPv4 --no-header)
# 1c. Swap file (1GB box): keeps pulls/npm hiccups from OOMing
ssh root@$IP 'fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo "/swapfile none swap sw 0 0" >> /etc/fstab'

# 2. Firewall — only 22/80/443 in
doctl compute firewall create --name monsterpaws-fw \
  --inbound-rules "protocol:tcp,ports:22,address:0.0.0.0/0 protocol:tcp,ports:80,address:0.0.0.0/0 protocol:tcp,ports:443,address:0.0.0.0/0" \
  --outbound-rules "protocol:tcp,ports:all,address:0.0.0.0/0 protocol:udp,ports:all,address:0.0.0.0/0" \
  --droplet-ids "$(doctl compute droplet get monsterpaws --format ID --no-header)"

# 3. DNS — A record, proxied (orange cloud). ZONE_ID from the CF dashboard.
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
  --data "{\"type\":\"A\",\"name\":\"monsterpaws.org\",\"content\":\"$IP\",\"proxied\":true}"
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
  --data "{\"type\":\"A\",\"name\":\"www\",\"content\":\"$IP\",\"proxied\":true}"

# 4. SSL mode Full (strict) — after Caddy's first cert issuance
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/ssl" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
  --data '{"value":"strict"}'

# 5. R2 buckets — DONE 2026-07-29 (monsterpaws-media, monsterpaws-vault;
#    S3 round-trip verified). Created via rclone (S3 CreateBucket) — no
#    wrangler needed. Env-only rclone pattern (no config file, keys stay
#    in pass; on the droplet the same RCLONE_CONFIG_R2_* come from .env):
# TWO credentials since 2026-08-17 (ADR-0011) — never collapse them back into
# one, or the worker that parses untrusted HTML every day regains write access
# to the attestation mirror and the pg_dumps that are our last line of defence.
#   worker key (pass cloudflare/r2-access-key-id / -secret-access-key):
#                                              corpus + media
#   vault  key (pass cloudflare/r2-vault-access-key-id / -secret-access-key):
#                                              vault only
rclone_r2() { # $1 = worker|vault, rest = rclone args
  local id sec role=$1; shift
  case $role in
    worker) id=cloudflare/r2-access-key-id;       sec=cloudflare/r2-secret-access-key ;;
    vault)  id=cloudflare/r2-vault-access-key-id; sec=cloudflare/r2-vault-secret-access-key ;;
    *) echo "usage: rclone_r2 worker|vault ..." >&2; return 2 ;;
  esac
  RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare \
  RCLONE_CONFIG_R2_ACCESS_KEY_ID=$(pass show "$id" | head -n1) \
  RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=$(pass show "$sec" | head -n1) \
  RCLONE_CONFIG_R2_ENDPOINT=$(pass show cloudflare/r2-endpoint | head -n1) \
  RCLONE_S3_NO_CHECK_BUCKET=true \
  rclone "$@"
}
# Separation verified 2026-08-17, both directions, read AND write: worker key
# 403s on vault (list and put), vault key 403s on corpus and media. Re-run that
# matrix after any token edit — a split only checked one way isn't a split.
# NO_CHECK_BUCKET is required since 2026-07-30: both tokens are BUCKET-scoped,
# so rclone's bucket-exists probe 403s and it wrongly
# falls back to CreateBucket. Same flag needed by any S3 client we configure.
# e.g. rclone_r2 worker lsf r2:monsterpaws-corpus
#      rclone_r2 vault  rcat r2:monsterpaws-vault/<key>
# (`lsd r2:` and `mkdir` both need account scope — see 5b; with a
# bucket-scoped key they 403 or, with NO_CHECK_BUCKET, no-op silently.)
# Gotcha hit during setup: a freshly-activated R2 account returns TLS
# handshake failures on its S3 endpoint for a few minutes — wait, don't debug.

# 5b. Corpus bucket (ADR-0011) — DONE 2026-08-17 (monsterpaws-corpus;
#     Standard class, ENA, private; live round-trip verified through
#     createR2HtmlVault: put → get → same-key re-put → prefix purge).
#     Scraped HTML only; separate bucket so the worker's daily-exercised
#     credential cannot reach pg_dumps or the attestation mirror.
#     TRAP: `rclone_r2 mkdir` CANNOT create a bucket — NO_CHECK_BUCKET=true
#     suppresses CreateBucket itself, so the command exits 0 having done
#     nothing; drop the flag and an Object-scoped key 403s. Bucket creation
#     needs ACCOUNT scope (Workers R2 Storage · Write), which none of our
#     stored credentials carry — this one was made in the dashboard UI, then
#     added to the "Monster Paws R2" token's bucket list. Do the same next
#     time; don't mint an account-wide key for a one-off.
#     `pass cloudflare/r2-token` and `r2-vault-token` ARE valid — account-owned
#     tokens, which verify only at /accounts/<id>/tokens/verify; the
#     2026-08-17 "Invalid API Token" came from /user/tokens/verify (corrected
#     2026-09-29). They are Object Read & Write tokens: every R2 REST call 403s,
#     so every working path uses the S3 access-key-id/secret derived from them.
#     Separation re-verified 2026-09-29, read side only: worker key reads media
#     + corpus and 403s on vault; vault key reads vault and 403s on both.
#     .env: R2_CORPUS_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY.
#     Consent revocation (ADR-0006 as amended) is one prefix purge — the keys
#     are sharded by shelter slug precisely so this stays a single command:
# rclone_r2 worker purge r2:monsterpaws-corpus/html/<shelter-slug>/
#     Purge prints a benign 403 on GetBucketVersioning — an Object Read &
#     Write token cannot read bucket-level config; rclone assumes unversioned
#     and deletes correctly. Don't chase it; verified 2026-08-17.

# 6. Managed Postgres — DEFERRED until ingest (roadmap item 2). When needed:
doctl databases create monsterpaws-pg --engine pg --version 16 \
  --size db-s-1vcpu-1gb --region nyc3
doctl databases connection monsterpaws-pg   # → DATABASE_URL for .env

# 6b. SSH hardening — part of provisioning, not a later chore. The repo is
#     public: architecture is documented, so the security budget goes to the
#     things that actually admit attackers (keys, tokens, the origin).
ssh root@$IP 'sed -i "s/^#\?PasswordAuthentication.*/PasswordAuthentication no/;
  s/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/" /etc/ssh/sshd_config &&
  systemctl reload ssh && apt-get install -y -q unattended-upgrades &&
  dpkg-reconfigure -f noninteractive unattended-upgrades'

# 6c. Monitoring (ADR-0010) — DONE 2026-07-30 on current droplet:
#     DO metrics agent + alert policies (CPU>80%, mem>90%, disk>85%, 10m
#     windows → account email). Recreate on any droplet rebuild:
#   ssh root@$IP 'curl -sSL https://repos.insights.digitalocean.com/install.sh | bash'
#   doctl monitoring alert create --type "v1/insights/droplet/cpu" --compare GreaterThan \
#     --value 80 --window 10m --entities <droplet-id> --emails <ACCOUNT email> --description "..."
#   # (emails must be DO account members — hello@ silently fails)
#     Logs: docker json-file rotation set in compose (10m×3); read via
#     `ssh <droplet> docker logs monsterpaws-app-1 --since 1h`.
#     Health: /api/health (ok + db + lastCompletePollAt + sha + uptime) —
#     503 unless the database answers AND the newest complete poll is under
#     27 h old (ADR-0010 as amended 2026-09-30); so it is 503 from migration
#     until the first complete poll, by design.

# 6d. Better Stack (ADR-0010 as amended 2026-09-29) — DONE 2026-09-29.
#     Errors + uptime + heartbeats on the free tier; ids and pass entries in
#     the registry above. Rebuild from nothing, team tokens only:
#   U=$(pass show betterstack/uptime-token); T=$(pass show betterstack/telemetry-token)
#   curl -X POST https://uptime.betterstack.com/api/v2/monitors -H "Authorization: Bearer $U" \
#     -H "Content-Type: application/json" -d '{"monitor_type":"keyword",
#     "url":"https://monsterpaws.org/api/health","required_keyword":"\"ok\":true",
#     "check_frequency":180,"email":true}'
#   curl -X POST https://uptime.betterstack.com/api/v2/heartbeats -H "Authorization: Bearer $U" \
#     -H "Content-Type: application/json" -d '{"name":"ingest.poll — RescueGroups daily 07:00 UTC",
#     "period":86400,"grace":10800,"email":true,"paused":true}'
#     → pipe .data.attributes.url into `pass insert -m betterstack/heartbeat-ingest-poll`
#   curl -X POST https://errors.betterstack.com/api/v2/applications -H "Authorization: Bearer $T" \
#     -H "Content-Type: application/json" -d '{"name":"monsterpaws","platform":"next_js_errors"}'
#     → pipe https://<token>@<ingesting_host>/<id> into `pass insert -m betterstack/errors-dsn`
#   pass show betterstack/errors-dsn        | gh secret set BETTERSTACK_ERRORS_DSN
#   pass show betterstack/telemetry-token-ci | gh secret set BETTERSTACK_SOURCEMAPS_TOKEN
#   gh variable set BETTERSTACK_TEAM_ID / BETTERSTACK_ERRORS_APP_ID / BETTERSTACK_SOURCEMAPS_URL
#   curl -X PATCH https://errors.betterstack.com/api/v2/applications/<id> \
#     -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
#     -d '{"github_repository_name":"LoganBresnahan/monster-paws"}'
#     TRAPS: that PATCH (or the field on create) 422s until GitHub is connected
#     in the Better Stack UI — Error tracking → Integrations → GitHub, "Only
#     select repositories" → monster-paws (done by hand 2026-09-29; there is no
#     API for it). Never use "Applications → Connect application" to link a
#     repo: that form CREATES a second application with a second DSN. Never
#     print a token or DSN: extract with jq into a variable and pipe it into pass.

# RULES (public repo):
# - The droplet IP NEVER appears in the repo, docs, or CI logs — placeholders
#   only. Cloudflare's proxy/DDoS protection only helps if the origin can't
#   be addressed directly.
# - Secrets live in pass (dev) / droplet .env (prod) / GH Actions secrets
#   (CI). Architecture is public; keys are the perimeter.
# - Cloudflare bot settings (2026-07-30): Bot Fight Mode ON (retest the
#   Every.org flow when it lands). AI crawlers deliberately ALLOWED — being
#   in AI assistants' answers is donor acquisition, and we aggregate public
#   listings ourselves; do not flip in a settings cleanup. AI Labyrinth off
#   (moot without blocks). security.txt served from public/.well-known/.
# - More deliberate OFFs (2026-07-30) — posture: we hold no payments and
#   WANT our images spread. Script monitoring off (no payment forms ever —
#   card entry is Every.org's PCI scope). Hotlink Protection off (hotlinked
#   cards = viral loop; R2 zero egress makes it free). Leaked-credentials
#   detection off until donor accounts exist — and prefer passwordless
#   (magic links/OAuth) at that point, which moots it permanently.

# 7. First deploy, on the droplet
ssh root@$IP 'git clone <repo-url> monsterpaws && cd monsterpaws &&
  cp .env.example .env && $EDITOR .env &&
  docker compose -f docker-compose.prod.yml up -d --build'
```

## Recurring ops

```sh
# Deploy (also in /deploy skill) — images from GHCR, built by CI
ssh <droplet> 'cd monsterpaws && git pull && docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d'

# Weekly DB copy outside DO (ADR-0003 belt-and-suspenders) — cron on droplet.
# NOT LIVE YET: waits on Managed Postgres (step 6). Set it up in the same
# sitting, or the belt-and-suspenders copy is a plan rather than a backup.
# Uses the VAULT key, not the worker's (ADR-0011) — add R2_VAULT_ACCESS_KEY_ID
# / R2_VAULT_SECRET_ACCESS_KEY to the droplet .env at that point; today the
# droplet holds neither, and nothing on it touches R2.
pg_dump "$DATABASE_URL" | gzip | rclone_r2 vault rcat r2:monsterpaws-vault/pgdump/$(date +%F).sql.gz

# Attestation mirror spot-check
wrangler r2 object get monsterpaws-vault/attestations/<id>.json --pipe

# Droplet snapshot before risky changes
doctl compute droplet-action snapshot <droplet-id> --snapshot-name pre-<change>

# Watch CI
gh run watch <run-id> --exit-status

# Cloudflare cache purge — ONLY needed when a public/ file changed in place
# (same filename, new bytes). HTML isn't edge-cached and /_next/static is
# content-hashed, so normal deploys need no purge. Prefer renaming the file
# (busts browser caches too); purge as fallback:
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $(pass show cloudflare/dns-token)" \
  -H "Content-Type: application/json" \
  --data '{"files":["https://monsterpaws.org/brand/wordmark-v1.png"]}'
# NOTE: requires Zone · Cache Purge · Purge permission — add it to the DNS
# token (or make a dedicated one) the first time this is actually needed.
```

## Deployment architecture

```
                                donors · shelters
                                       │
                                       ▼
                        ┌─────────────────────────────┐
                        │      Cloudflare (free)      │
                        │  DNS · CDN cache · TLS edge │
                        │  DDoS · monsterpaws.org     │
                        └───────┬─────────────┬───────┘
                    proxied,    │             │ public R2 URLs
                    Full strict │             │ (card art, photos)
                                ▼             ▼
        ┌───────────────────────────────┐   ┌─────────────────────────┐
        │    DigitalOcean droplet       │   │     Cloudflare R2       │
        │    (Docker Compose)           │   │  monsterpaws-media      │
        │                               │   │   · original photos     │
        │  ┌───────┐  :3000  ┌───────┐  │   │   · generated card art  │
        │  │ Caddy ├────────►│  app  │  │   │  monsterpaws-vault      │
        │  │ HTTPS │         │ Next  │  │   │   · attestation mirror  │
        │  └───────┘         │  SSR  │  │   │     (flat files)        │
        │                    └───┬───┘  │   │   · weekly pg_dumps     │
        │                        │      │   │  monsterpaws-corpus     │
        │                        │      │   │   · scraped HTML,       │
        │                        │      │   │     content-addressed   │
        │                        │      │   │     (worker-only)       │
        │  ┌──────────────┐      │      │   └─────────────────────────┘
        │  │    worker    │      │      │         ▲ writes (keys in DB)
        │  │   pg-boss    │      │      │         │
        │  │ poller · art │◄─────┤──────┼─────────┘
        │  └──┬───────┬───┘ shared types│
        └─────┼───────┼────────────────-┘
              │       │
              ▼       ▼
  ┌────────────────┐ ┌──────────────────────────────┐
  │  DO Managed    │ │        external APIs         │
  │  Postgres 16   │ │  RescueGroups (poll daily)   │
  │  · PITR        │ │  Every.org   (donations)     │
  │  · pgvector    │ │  Replicate   (image gen)     │
  │  · pg-boss q   │ │  Shelterluv/Petango (tier 1) │
  │  · corpus+FTS  │ └──────────────────────────────┘
  └────────────────┘
```

## CI / deploy pipeline

```
  git push ──► GitHub Actions (ci.yml)                    droplet
              ┌──────────────────────────────┐            ┌──────────────────────┐
              │ verify                       │   manual   │ IMAGE_TAG=<sha> .env │
              │  typecheck                   │  /deploy   │ compose pull         │
              │  vitest ×2   (flaky bar) ◄─┐ ├───────────►│ compose up -d        │
              │  next build  (standalone)  │ │  ship bar  │  · caddy (certs kept)│
              │  playwright vs standalone  │ │  green     │  · app   (pulled)    │
              │    server.js on seeded     │ │            │  · worker(pulled)    │
              │    monsterpaws_e2e         │ │            │                      │
              │ ┌────────────────────────┐ │ │            │ smoke: /api/health   │
              │ │ service: postgres      ├─┘ │            │ rollback: pin the    │
              │ │ pgvector/pgvector:pg16 │   │            │  previous sha tag    │
              │ │ monsterpaws_test +     │   │            └──────────▲───────────┘
              │ │ monsterpaws_e2e,       │   │                       │ pull
              │ │ migrated per run       │   │                       │
              │ │ (ADR-0017)             │   │            ┌──────────┴───────────┐
              │ └────────────────────────┘   │            │ GHCR (public)        │
              │ images  (needs verify; topdog│   push     │  monster-paws-app    │
              │  + hotfix/** pushes)         ├───────────►│  monster-paws-worker │
              │  docker build app + worker   │            │  :<sha> only — prod  │
              │  --target sourcemaps export  │            │  pins IMAGE_TAG      │
              │  (debug IDs stamped offline) │            │  (ADR-0007, oplog 2) │
              │        │ artifact            │            └──────────────────────┘
              │ sourcemaps (needs images)    │
              │  upload, retry until         ├──────────► Better Stack Errors
              │  processed (≤ 6 attempts)    │            (ADR-0010 am. 2026-09-30)
              │  /deploy gate: green for sha │
              └──────────────────────────────┘
```

## Data custody (what lives where, what's sacred)

```
  SACRED (irreplaceable)                 DERIVED (rebuildable)
  ┌──────────────────────────┐           ┌──────────────────────────┐
  │ raw_payloads (JSONB)     │  rebuild  │ animals (canonical)      │
  │ scraped HTML (R2 corpus) ├──────────►│ embeddings (+model tag)  │
  │ event_log                │           │ FTS indexes              │
  │ attestations + R2 mirror │           │ ISR page cache           │
  │ donor accounts           │           │                          │
  └───────────┬──────────────┘           └──────────────────────────┘
              │ backed up: DO PITR (continuous)
              │            + weekly pg_dump → R2 vault (off-DO copy)
              ▼
  purge exceptions (ADR-0006 as amended): rows tagged
  source='rescuegroups' (ToS termination) or source='scrape:<slug>'
  (that shelter revokes consent) are set-deletable — the TWO carve-outs
```

Ingest keys: `RESCUEGROUPS_API_KEY=$(pass show rescuegroups/api-key)` —
granted 2026-08-02, scoped to what the application declared (donations +
keepsakes); the Tracker pixel obligation rides on it (ADR-0006).
