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
| `digitalocean/api-token` | DO account API token (created 2026-07-29) | Everything `doctl` does: the droplet, firewall, monitoring alert policies (step 6c), snapshots, Managed Postgres when step 6 lands, and the per-job GPU Droplets of GPU rental (below) | dev only |
| `digitalocean/database-url` | Private connection string of Managed Postgres `monsterpaws-pg` (id `a464ff4f…`, PG 16, db-s-1vcpu-1gb, nyc3; created 2026-10-27 by oplog 0001), the cluster's admin user, `sslmode=require`; reachable only from the droplet (firewall rule `droplet:588758367`, private network) | The app's and the worker's `DATABASE_URL`, and `scripts/backup-db.sh`'s source. Admin credentials: a least-privilege app role is a follow-up (oplog 0001) | droplet `.env` |

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
| `cloudflare/r2-vault-access-key-id` | Vault pair, access key id | Read/write the vault: nightly pg_dumps, the attestation mirror | droplet `.env.backup` (never `.env`), set by oplog 0001 |
| `cloudflare/r2-vault-secret-access-key` | Vault pair, secret | same | droplet `.env.backup` (never `.env`), set by oplog 0001 |
| `cloudflare/r2-vault-endpoint` | Same URL as `r2-endpoint`, stored beside the vault pair | Nothing reads it today (`rclone_r2` and the backup script use `r2-endpoint`) | dev only |
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

### Home worker (ADR-0004 as amended 2026-10-05) — *none created yet*

The GPU box runs with a scoped runtime set only; `pass` holds the master
copies as it does the droplet's. Every entry is created at provisioning (an
oplog entry) and lands in the prod distro's `.env`, readable by the
`monsterpaws` Windows user alone.

| Entry | What it is | What it's for | Lands in |
| --- | --- | --- | --- |
| `digitalocean/pg-home-worker-url` | Connection string for a `home_worker` Postgres role: pg-boss's schema plus INSERT on `keepsake_fact`, nothing else | The home worker's `DATABASE_URL`, reached through the tunnel | home `.env` (not created yet) |
| `digitalocean/droplet-tunnel-key` | SSH private key; its `authorized_keys` line on the droplet is `restrict,port-forwarding,permitopen="<pg-host>:25060"` | The home → droplet → Postgres tunnel, and nothing else | home prod distro (not created yet) |
| `cloudflare/r2-media-write-token` | Account-owned R2 token, Object Write only, media bucket only | The pair below is derived from it; roll it to revoke the pair | dev only (not created yet) |
| `cloudflare/r2-media-write-access-key-id` | Media write pair, access key id | Uploading card art from home — can neither read media nor touch corpus or vault | home `.env` (not created yet) |
| `cloudflare/r2-media-write-secret-access-key` | Media write pair, secret | same | home `.env` (not created yet) |
| `cloudflare/r2-models-read-token` | Account-owned R2 token, Object Read only, the models prefix only | The pair below is derived from it; the style LoRA and any weights we make travel dev → R2 → prod through it (ADR-0004 decision 11 as refined) | dev only (not created yet) |
| `cloudflare/r2-models-read-access-key-id` | Models read pair, access key id | The prod fetcher's download of manifest entries whose source is `r2:`; can write nothing | home `.env` (not created yet) |
| `cloudflare/r2-models-read-secret-access-key` | Models read pair, secret | same | home `.env` (not created yet) |

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

### Every.org (ADR-0027)

The **staging** partner webhook, created 2026-10-22 from Logan's account at
staging.every.org/developer: partner name `Monster Paws`, domain
`monsterpaws.org`, URL
`https://staging-hooks.monsterpaws.org/api/webhooks/everyorg/$(pass show everyorg/staging-webhook-secret)`.
That hostname has **no DNS record** until phase 4 of
`doc/plans/adr-0027-accounts-build-plan.md` routes it to `monsterpaws-dev`
through a tunnel, so staging donations never reach the droplet. The
production webhook is a separate setup with its own three entries
(`everyorg/webhook-token`, `auth-token`, `webhook-secret`), made before launch.

| Entry | What it is | What it's for | Lands in |
| --- | --- | --- | --- |
| `everyorg/staging-webhook-token` | The staging webhook's token, shown at creation | The donate link's `webhook_token` parameter, which makes Every.org POST that donation to our webhook. Rides in a URL every donor sees — an identifier, not a secret | local `.env` `EVERYORG_WEBHOOK_TOKEN` via `npm run env:dev` |
| `everyorg/staging-auth-token` | The staging webhook's auth token, shown at creation | Undocumented (docs.every.org, Partner Webhook, read 2026-10-22): asked of partners@every.org whether it rides on each webhook POST | local `.env` `EVERYORG_AUTH_TOKEN` via `npm run env:dev` |
| `everyorg/staging-webhook-secret` | 32 random characters (`pass generate -n`) | The last path segment of the webhook URL above — our own secret beside Every.org's token (ADR-0027 §4) | local `.env` `EVERYORG_WEBHOOK_SECRET` via `npm run env:dev` |
| `everyorg/api-key` | Every.org **production** public API key, created by Logan 2026-10-27 at every.org/developer | Nonprofit lookups by EIN for the shelter-to-nonprofit match (ADR-0029 §2, ADR-0027's `shelter_nonprofits`) | local `.env` via `npm run env:dev`; read by `npm run outreach -- match` |
| `everyorg/api-secret` | The secret issued with that key | Not needed for public lookups; kept for any authenticated partner call | dev only |

### Google — Gmail as Logan (ADR-0029)

Outreach mail leaves as Logan from his own Gmail account over SMTP, never from Resend (ADR-0029 §4). Both entries are made when the first live wave is ready and the app password revoked when outreach ends. Everything that is not `send --live` goes to **Mailpit** (`docker-compose.dev.yml` and CI's `verify` job: SMTP on 1025, the inbox at http://localhost:8025, nothing leaves the machine), and `match` reads the IRS Business Master File from `var/irs/eo_<state>.csv` (public domain, downloaded once by `ensureBmf`, gitignored; delete the file to refresh it).

| Entry | What it is | What it's for | Lands in |
| --- | --- | --- | --- |
| `google/gmail-user` | Logan's Gmail address, the one outreach mail is sent as | `GMAIL_USER` for `npm run outreach -- send --live` (ADR-0029 §4) | local `.env` via `npm run env:dev` |
| `google/gmail-app-password` | A Google app password for that account (Google Account → Security → 2-Step Verification → App passwords), made when the first live wave is ready and revoked when outreach ends | `GMAIL_APP_PASSWORD`: Gmail SMTP on 465 as Logan, at most 40 a day a minute apart, live sends only — Mailpit takes everything else (ADR-0029 §4). Not yet in `pass` (2026-10-27): the gate on the first live wave | local `.env` via `npm run env:dev`; never the droplet |

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
| `betterstack/heartbeat-db-backup` | URL of heartbeat `518590`, "db backup — nightly 08:30 UTC": period 24h, grace 2h (created 2026-10-27 by oplog 0001) | `scripts/backup-db.sh` pings it after an upload over 1 MB lands in the R2 vault; silence past the grace means a night with no off-DO copy (ADR-0003 as amended 2026-10-26). Secret for the same reason as the poll's | droplet `.env.backup`, set by oplog 0001 |
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

### Social accounts (ADR-0032)

Five accounts: four registered to hello@monsterpaws.org (a Cloudflare Email
Routing forward, above) and the YouTube channel under Logan's Google account; display name "Monster Paws", link
https://monsterpaws.org. Posted by hand only (ADR-0032 decision 3): no API
key, app password or scheduler credential exists for any of them, and none is
created without an ADR saying what for. The LinkedIn logo and cover, and the
X and Bluesky avatar and header, and the YouTube banner, are built by `npm run social:assets` into
`var/social/` (gitignored) from `public/brand/`. Avatars, covers and bios were
up on all four by 2026-10-27 (Logan); the Bluesky profile is readable without
a login through `public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=monsterpaws.org`.

| Account | Handle | Made |
| --- | --- | --- |
| LinkedIn company page | Monster Paws — https://www.linkedin.com/company/monster-paws/ | 2026-10-26, assets and copy updated 2026-10-27 |
| X | `@monsterpawsorg` — https://x.com/monsterpawsorg | 2026-10-27 |
| Bluesky | `@monsterpaws.org` — https://bsky.app/profile/monsterpaws.org (the `_atproto` TXT record set 2026-10-27 through `cloudflare/dns-token`; `@monsterpawsorg.bsky.social` redirects) | 2026-10-27 |
| YouTube | `@monsterpawsorg` — https://www.youtube.com/@monsterpawsorg, a brand channel under Logan's Google account | 2026-10-27 |
| Instagram | `@monsterpawsorg` — https://www.instagram.com/monsterpawsorg/ | 2026-10-27 |
| Facebook Page | Monster Paws — https://www.facebook.com/people/Monster-Paws/61595719932459/ (a Page under Logan's personal profile; no username yet, the numeric URL is the address) | 2026-10-28 |

| Entry | What it is | What it's for | Lands in |
| --- | --- | --- | --- |
| `social/linkedin` | The page admin's login is Logan's own LinkedIn; this entry holds the page's URL and admin notes only | Finding the page and who administers it | dev only |
| `social/x` | Password, 2FA recovery codes and TOTP secret of `@monsterpawsorg` | Signing in from a new browser or phone; re-enrolling the authenticator | dev only, never `.env` |
| `social/bluesky` | Password, 2FA recovery codes and TOTP secret of the Bluesky account | Same; and the handle change to the domain | dev only, never `.env` |

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

# 6. Managed Postgres — DONE 2026-10-27 by oplog 0001 (monsterpaws-pg, PG 16,
#    db-s-1vcpu-1gb, nyc3; firewall: the droplet only; daily backups with
#    point-in-time restore over 7 days). Rebuild:
doctl databases create monsterpaws-pg --engine pg --version 16 \
  --size db-s-1vcpu-1gb --region nyc3
doctl databases firewalls append <db-id> --rule droplet:<droplet-id>
#    The PRIVATE connection string, with sslmode=verify-full, piped into
#    pass as digitalocean/database-url and from there into the droplet .env.
#    TRAP: Node's pg treats sslmode=require as verify-full too, and DO signs
#    the cluster with its own project CA, so every connection fails
#    SELF_SIGNED_CERT_IN_CHAIN (2026-10-27) until the droplet holds the CA:
doctl databases get-ca <db-id> -o json | jq -r .certificate | base64 -d \
  | ssh root@$IP 'cat > monsterpaws/do-ca.crt'
#    docker-compose.prod.yml mounts it into app and worker as
#    NODE_EXTRA_CA_CERTS; scripts/backup-db.sh passes it to pg_dump as
#    PGSSLROOTCERT. Public, never committed (.gitignore). Valid to 2036.

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
# Monthly, or before any look/art work after a Windows driver, WSL or kernel
# update — the home GPU stack (Home GPU section): check the four pinned
# versions in comfyui/Dockerfile against intel/compute-runtime,
# intel-graphics-compiler and oneapi-src/level-zero releases and the torch
# xpu wheel; bump the four together; `npm run comfy:build && npm run
# comfy:smoke`. The smoke prints descriptors leaked per image: a runtime
# that prints 0 retires the nofile ulimit in comfyui/compose.yml.
powershell.exe Get-CimInstance Win32_VideoController   # Windows driver version
grep -n "^ARG" comfyui/Dockerfile                        # what we pin

# Deploy (also in /deploy skill) — images from GHCR, built by CI
ssh <droplet> 'cd monsterpaws && git pull && docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d'

# Nightly DB copy outside DO (ADR-0003 as amended 2026-10-26) — droplet cron,
# 08:30 UTC, after the 07:00 poll. Set up by oplog 0001 in the launch sitting.
# scripts/backup-db.sh runs pg_dump and rclone in pinned containers, uploads
# r2:monsterpaws-vault/pgdump/<date>.sql.gz, refuses an object under 1 MB,
# and pings the betterstack/heartbeat-db-backup heartbeat. The VAULT key lives
# in monsterpaws/.env.backup (mode 600), NEVER in .env: compose hands .env to
# the app and the worker (ADR-0011).
#   /etc/cron.d/monsterpaws-backup:
#   30 8 * * * root /root/monsterpaws/scripts/backup-db.sh >> /var/log/monsterpaws-backup.log 2>&1
# By hand: ssh root@$IP 'monsterpaws/scripts/backup-db.sh'
# List:    rclone_r2 vault lsl r2:monsterpaws-vault/pgdump/

# Poll from home (scripts/poll-via-home.sh) — the production poll run on
# this machine, writing to the production database through one SSH
# connection to the droplet (oplog 0001). For a day the droplet cannot reach a
# source: RescueGroups resets every connection from the droplet's address
# (2026-10-27, allowlist asked). Same worker image and command as the
# droplet's job, read from its .env; the database firewall unchanged; TLS
# still verified (the container resolves the database's hostname to the
# tunnel). Pings the poll heartbeat on a complete run. pass unlocked:
scripts/poll-via-home.sh [--max-daily-disappearance R]
# Poll via the bridge (scripts/poll-via-bridge.sh, ADR-0033) — the faster
# shape, and the one to reach for first: the poll runs ON THE DROPLET with
# its own image, .env and CA, and only RescueGroups' requests leave through
# this machine — scripts/rg-proxy.ts on 127.0.0.1:18443 (CONNECT to
# api.rescuegroups.org:443 only), reached over one SSH reverse forward.
# Minutes, not hours; a dropped home link costs a page fetch, never a
# write. The proxy's log lands in var/rg-proxy-<stamp>.log. pass unlocked
# (the DO token only):
scripts/poll-via-bridge.sh [--max-daily-disappearance R]
# The droplet's own schedule is off meanwhile: INGEST_POLL_SCHEDULE=off in its
# .env makes the worker unschedule ingest.poll (ADR-0033 as amended
# 2026-10-28) — delete the line and restart the worker after the allowlist;
# never remove RESCUEGROUPS_API_KEY instead, the bridge reads it. The CLI exits
# 2 on a full run that did not complete, and the bridge then pings /fail.
# Nightly and unattended from a home Task Scheduler task with a restricted
# key is the next step (ADR-0033 decision 7, roadmap Launch).
# TRAP: the droplet's ufw LIMITs 22/tcp — 6 connections in 30 s and it refuses
# that source for minutes, and every retry restarts the count. One SSH
# session per step; never a loop of ssh calls, never a port-22 probe loop.

# Attestation mirror spot-check
wrangler r2 object get monsterpaws-vault/attestations/<id>.json --pipe

# Droplet snapshot before risky changes
doctl compute droplet-action snapshot <droplet-id> --snapshot-name pre-<change>

# Watch CI
gh run watch <run-id> --exit-status

# Disappearance gate refused a poll (ADR-0014 as amended 2026-09-30) — Better
# Stack error "disappearance gate: N of M over D day(s) …". Nothing was written;
# decide wave or bug before tomorrow's 07:00 run:
#   1. Is RescueGroups' count down? Their page-1 meta.count is in the run log;
#      compare against the last run: ssh <droplet> 'docker logs monsterpaws-worker-1 --since 48h | grep ingest.run.completed'
#   2. Which orgs lost the most? A whole org vanishing is a partner leaving RG
#      (real); every org losing a slice is a filter or API change (bug).
#   3. Real → accept it for this run only:
#      docker compose -f docker-compose.prod.yml run --rm worker npm run ingest -- poll --max-daily-disappearance 0.5
#      Bug → leave it; the gate keeps refusing, and a real wave clears itself
#      as the gap grows. Write an oplog entry either way.

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

## Home GPU — the Arc A770 through WSL2 (ADR-0004 as amended 2026-10-05)

Verified 2026-10-05 on Logan's main rig. Everything reproducible lives in
`comfyui/` (Dockerfile, `compose.yml`, `smoke.py`); this section holds what a
container cannot carry — the host side — and the facts that were load-bearing
when it was first made to work.

The machine, as found:

| | |
| --- | --- |
| Windows 11, i7 12th gen, 64 GB | WSL2 kernel 6.18, Ubuntu 24.04, mirrored networking, `.wslconfig` memory=24GB since 2026-10-06 (Logan's VM cap, shared by the general Ubuntu and `monsterpaws-dev`, ADR-0004 decision 10 as revised; takes effect at the next `wsl --shutdown`; the prod account's own `.wslconfig` gets its 24 GB) |
| Intel Arc A770 16 GB | Windows driver 32.0.101.8992 — compute-runtime's WSL support is tested against ≥ 101.8991 |
| Intel UHD 770 (iGPU) | driver 32.0.101.7088; drives both monitors since 2026-10-06 (the MSI G271CQP on the board's DisplayPort, the LG on its HDMI), BIOS Primary Display = IGFX, so the Arc idles for us |
| C: 2 TB NVMe | Holds the general Ubuntu (`C:\wsl\Ubuntu`) and Docker Desktop, nothing of Monster Paws. 191 GB free at the end of 2026-10-06, after Ubuntu's vhdx was compacted 204 → 154 GB (131 GB used inside), Docker's 81 → 28 GB once its build cache and the Monster Paws leftovers were pruned (see *Reclaiming vhdx space* below), and the two redundant copies of Docker's data left from the junction episode were deleted |
| M: 477 GB, the second M.2 (LiteOn) | **Retired from Linux 2026-10-06**: `Clear-Disk` + GPT + one NTFS volume labelled `monsterpaws`. Ubuntu's shim had been installed to the *Windows* EFI partition, not its own — `\EFI\ubuntu` removed and the firmware entry deleted with `bcdedit /delete '{guid}'` (quoted: PowerShell reads braces as a script block). Fast startup off (`powercfg /h off`) so the prod worker's at-boot trigger sees a real boot. Holds `M:\monsterpaws\dev` and, later, the prod account's distro (ADR-0004 decision 10) — nothing else. The general Ubuntu passed through here (`wsl --manage Ubuntu --move`, WSL 3.0, in place, default user kept) and went back to C: the same evening. 457 GB free |
| Docker Desktop's data | Back in its default `C:\Users\<user>\AppData\Local\Docker\wsl` since 2026-10-06 evening; the interim junction to M: of that afternoon is gone. Lessons kept: `docker_data.vhdx` stays attached to the WSL VM after Quit, so `wsl --unmount <vhdx>` before touching it (this is why Docker 4.93's own move failed to delete its source); `DataFolder` in `settings-store.json` is the Hyper-V key and the WSL path is hardcoded, so editing the file does nothing; Docker rebuilds its `docker-desktop` system distro from the ISO on every start, so unregistering it costs nothing |
| `M:\monsterpaws\dev` — the `monsterpaws-dev` distro | Created 2026-10-06 (`wsl --install Ubuntu-24.04 --name monsterpaws-dev --location M:\monsterpaws\dev`, user `oof`), bootstrapped by `scripts/bootstrap-distro.sh`, identity carried over by hand (GPG export/import, pass store, ssh), repo + corpus dump + ComfyUI image carried over; Arc smoke passes from its own docker engine. The general Ubuntu is back at `C:\wsl\Ubuntu` and **stays the default distro**: Docker Desktop integrates with the default (`IntegratedWslDistros: [Ubuntu]` in its settings store), so making `monsterpaws-dev` the default would put Docker's CLI inside the distro decision 11 keeps it out of. Open it explicitly — `wsl -d monsterpaws-dev`, VS Code *Connect to WSL using Distro…*, a Windows Terminal profile |
| Docker Desktop 4.94 | Logan's other projects only; never in the Monster Paws path (decision 11). Its last Monster Paws leftovers — the ComfyUI image, a local app image, the old dev database container and volume — were removed 2026-10-06 after the corpus counts matched the dev distro's. Its WSL integration stays OFF for `monsterpaws-*` distros, or it injects its CLI over the engine inside them |

Reclaiming vhdx space — a distro's `ext4.vhdx` grows and never shrinks on its
own, so compact it whenever the file is far larger than `df` inside says is
used (`monsterpaws-dev` is 22 GB on disk for 20 GB used and needs nothing
yet; Ubuntu's first pass took 13 minutes for 204 → 154 GB). **Never `wsl --manage <distro> --set-sparse true`**: WSL itself warns
that sparse VHDs can corrupt data, and the corpus lives on one of these disks.
Both distros already mount `/` with `discard`, so freed blocks are unmapped
continuously; the only thing sparse would add is the file shrinking on its
own, and that is the part that corrupts. The compaction is therefore a manual
chore, decided 2026-10-06 against a sign-in or nightly task: it needs the
whole VM down, and nothing else on the box needs it on a schedule. Docker
Desktop's `docker_data.vhdx` (87 GB on 2026-10-06) grows the same way and is
compacted by the same script; `docker builder prune -a` first is what makes
that worthwhile (39 GB of build cache went that day; the file shrinks at the
next compaction, not at the prune).
Neither disk is sparse today (`fsutil sparse queryflag <vhdx>`, 2026-10-06);
the inert `sparseVhd=true` line that `.wslconfig` carried under
`[experimental]` was removed the same day. Compaction is offline, and *offline
means the whole VM*: `wsl --terminate Ubuntu` is not enough, the VM keeps a
stopped distro's vhdx open (`0x80070020` from `Optimize-VHD`, verified
2026-10-06) and `wsl --unmount` only knows disks attached with `--mount`. So
every WSL session on the account dies with the `wsl --shutdown`, Claude Code
included, and it must be run by hand from Windows. Quit Docker Desktop first:
its integration restarts Ubuntu seconds after a terminate.

```
# inside the distro first, so freed ext4 blocks are handed back as discards
sudo fstrim -v /
# then quit Docker Desktop and, in an elevated PowerShell
wsl --shutdown
powershell -ExecutionPolicy Bypass -File C:\wsl\compact.ps1   # Optimize-VHD -Mode Full over the three disks, logs to C:\wsl\compact.log
# the same by hand, or without the Hyper-V module, which diskpart replaces:
Optimize-VHD -Path C:\wsl\Ubuntu\ext4.vhdx -Mode Full
diskpart
  select vdisk file="C:\wsl\Ubuntu\ext4.vhdx"
  attach vdisk readonly
  compact vdisk
  detach vdisk
  exit
```

Host prerequisites — nothing is installed inside the WSL distro itself, the
container carries the GPU runtime:

1. Intel Arc Windows driver current (Intel Arc Control or the Intel Driver &
   Support Assistant). `powershell.exe Get-CimInstance Win32_VideoController`
   from WSL shows the version.
2. `wsl --update`; the distro sees `/dev/dxg` (the GPU) and `/usr/lib/wsl/`
   (`lib/` = libdxcore, `drivers/` = a mirror of the Windows driver store).
3. The distro itself: `wsl --install Ubuntu-24.04 --name monsterpaws-dev
   --location M:\monsterpaws\dev`, then as root once
   `bash scripts/bootstrap-distro.sh oof` (docker engine under systemd, node
   via nvm, gh, pass, rclone, doctl, Claude Code, the Playwright browser and
   its system libraries for `npm run e2e` — browsers live in each distro's own
   `~/.cache`, so one installed in the general Ubuntu is invisible here
   (2026-10-15) — and the distro's own
   hostname plus a colour-coded prompt from `scripts/distro-prompt.sh` — dev
   magenta, prod red — because every distro otherwise says `oof@alchemist`)
   and `wsl --terminate` it so the docker group, hostname and wsl.conf apply.
   On the Windows side the `monsterpaws-dev` Windows Terminal profile has a
   leaf-green tab and VS Code's `window.title` includes `${remoteName}`. Identity is carried over by hand: GPG secret key
   export/import needs a terminal for the passphrase, then the pass store,
   `~/.ssh`, `~/.gitconfig`.
4. `npm run comfy:build` then `npm run comfy:smoke` — the smoke prints the
   device and an FP16 matmul rate, or says which of the facts below broke.
5. `npm run comfy:models` fills `var/comfyui/models/` from
   `comfyui/models.manifest` (~10 GB for the SDXL + IP-Adapter set at first,
   66 GB by 2026-10-14 with klein, its encoders and the detectors; the
   fetcher streams each file's sha256 and only names it on a match), and
   `npm run comfy` re-verifies every file before ComfyUI serves. A mismatch
   is a refusal, never a re-download — read the manifest's rule. Both scripts
   create the four data directories as the invoking user first
   (`comfy:dirs`): a bind-mount path that does not exist is created by the
   docker engine as root, and the container, which writes as uid 1000,
   then cannot fill it — the first fetch on 2026-10-07 died exactly so, on
   directories a day-old `up` had left behind. The manifest is baked into
   the image (the image is the decision), so after editing it run
   `comfy:build` before `comfy:models`: the fetcher reads the copy inside
   the container, and an unrebuilt image fetches the old list and says
   `ok` (2026-10-08, the LoRA lines).

What was load-bearing, in the order it was found:

- **Pass `/dev/dxg` and bind-mount all of `/usr/lib/wsl`, not only `lib/`.**
  With `lib/` alone the Intel runtime finds no device (Ubuntu's own build
  aborts in `create_um_km_data_translator.cpp`): the user-mode driver needs
  `drivers/` too.
- **`LD_LIBRARY_PATH=/usr/lib/wsl/lib` inside the container.** WSL adds that
  path to the distro's `ld.so.conf`; a container has no such entry.
- **Intel's compute runtime must be at least as new as the Windows driver,
  and that means GitHub releases, not apt.** The `noble unified` channel
  topped out at 25.18 (mid-2025) against driver 101.8992 (2026), and that
  pairing is the worst kind of broken: the device enumerates, kernels run
  at full speed, and **every host↔device copy returns garbage in both
  directions with no error** — over Level Zero and OpenCL alike, from a
  clean Windows boot, while the iGPU through the same `/dev/dxg` is fine.
  `dmesg` shows `dxgkio_lock2: Ioctl failed: -22` behind every copy — but under runtime
  26.35 the same lock2 failures appear by the thousand during *correct*
  runs (2026-10-08, 2,000–5,000 per minute of generation), so neither
  lock2 nor `dxgkio_reserve_gpu_va: -75` (seen on the working iGPU too)
  tells a broken stack from a working one. Only the smoke's round trip does. Found 2026-10-07 when
  the first generation died in a gather kernel, after a smoke that had only
  timed matmuls. The Dockerfile now pins compute-runtime 26.35.39758.10
  (Intel's own WSL test pairing for driver 101.8991), IGC 2.41.5 and
  libigdgmm 22.10.0 from `intel/compute-runtime` releases, and Level Zero
  loader 1.34.0 from `oneapi-src/level-zero` — the loader must be newer than
  the runtime or torch segfaults in `device_count` (`ZE_ENABLE_LOADER_DEBUG_TRACE=1`
  shows the dispatch-table check failing). Bump the four together, then
  `npm run comfy:smoke`. Older runtimes for the record: 24.39 segfaults in
  `zeInit`, Ubuntu's 23.43 has no Level Zero.
- **Level Zero caps a single allocation at 1 GiB on the A770 and calls it
  "out of memory" with 15 GiB free.** `UR_L0_ENABLE_RELAXED_ALLOCATION_LIMITS=1`,
  set in the image, allocates up to the card (6 GiB verified). Without it
  SDXL at 1024² fails in the sampler.
- **"Can't initialize Level Zero Sysman" is benign.** Sysman (`zes`) is not
  available through `/dev/dxg`; PyTorch warns and enumerates the other way.
- **The free-threaded Python 3.14t the dev shell defaults to has no XPU
  wheel.** The container uses Ubuntu's 3.12; wheels exist for 3.12–3.14.
- **Mirrored networking** makes the container's `127.0.0.1:8188` reachable
  from Windows as well as the distro, so the ComfyUI GUI opens in the normal
  browser.

- **ComfyUI's per-prompt cache flush fills the card and then the host —
  the leak, found 2026-10-08 and fixed in the image.** After every prompt
  ComfyUI calls `torch.xpu.empty_cache()`, handing hundreds of oddly sized
  blocks back to the driver. Under GPU paravirtualisation the Intel driver
  retains what it is handed and reuses none of it (the retained total shows
  as `dedicated` in Windows' counters while PyTorch's own reserved figure
  stays flat), so the card fills with dead blocks in two or three images and
  every image after that lands in the driver's *shared* pool — ~2 GB of
  Windows host memory per image, held until the process exits, and ~28
  descriptors per image with it. The adapter is irrelevant (text-only does
  the same two images later), VRAM is never actually full from PyTorch's
  view, and no driver or runtime switch changes it (NEO allocation caches
  off, the UR pool off, ComfyUI's memory modes — all tried, all identical).
  `custom_nodes/monsterpaws_xpu` makes `empty_cache` a no-op when
  `MONSTERPAWS_KEEP_XPU_CACHE=1`, the image's default: PyTorch reuses its
  own blocks, the driver sees no frees, and six adapter images ran at a
  flat 14 s with the shared pool, host memory and descriptor count all
  flat. The cost is that PyTorch holds its peak (12 GiB here) for the life
  of the process — which is the production shape anyway. The engine's
  1024-descriptor default stays as the safety wall; never raise it.
- **The box freezes on its own, and did before any of this: twelve
  unexpected shutdowns in the thirty days to 2026-10-09, the first on
  2026-09-14, three weeks before ComfyUI touched the Arc.** Read from the
  System log after the fourth freeze of the GPU work (2026-10-09 09:18,
  nothing of ours running, the card idle since the previous evening): nine
  of the twelve came 1–14 minutes after a firmware S3 resume (Kernel-Power
  130), two came under batch load ten hours after a resume (the 2026-10-07
  pair, with the leak filling host memory), one 29 minutes after a resume.
  Each leaves the same trace: no bugcheck written, no GPU timeout-recovery
  event, a WHEA-Logger fatal record at the next boot whose CPER section is a
  *firmware error record reference* under the boot notification type — the
  BIOS logged a fatal hardware error and Windows found it on restart. The
  symptom Logan sees is a stutter (keys repeat, the mouse jumps), then a
  frozen display or a CLOCK_WATCHDOG_TIMEOUT screen that itself freezes.
  Hardware: i7-12700K on an ASUS TUF GAMING B760M-PLUS WIFI D4, BIOS 1805
  (2024-10-29), 2 × 32 GB DDR4 at 3600 MT/s (XMP), Arc A770 on 101.9034,
  a third-party "Virtual Display Driver" also loaded. No memory diagnostic
  has ever run. The leak and the driver made the GPU batches a second
  trigger; they were never the cause. Actions are Logan's and listed in
  `doc/issues.md`, Ops; until a week passes clean after them, treat every
  freeze as the machine, and keep the guard for the load it adds.
- **Switching LoRAs from image to image costs ~12 GB of host memory in one
  step after about five switches (2026-10-08 evening, batch 1b).** One LoRA
  held for six images: every counter flat at 14 s. LoRA changed every image
  (none → watercolor → tinies → …): flat through five switches, then
  Windows free memory fell from 31.5 to 19.2 GB inside the sixth image and
  the watchdog killed the process — with the driver's shared pool,
  PyTorch's reserved pool and VRAM all unchanged, so this is the ComfyUI
  process's own RAM at a re-patch, not the card. The same step hit the
  batch at its tenth image. Mitigation in place: `explore.py` runs a batch
  grouped by LoRA (one or two switches per batch, a fresh process between
  chunks) and `leak_probe.py lora6 loraswitch6` reproduces both results.
  Production holds one LoRA for the life of the process and never meets
  it. Explained the next day: the step is the WSL VM reaching its cap as
  ComfyUI parks the swapped-out model copies in CPU memory — bounded, and
  sized in the memory bullet below.
- **Nothing drives the Arc except through `comfyui/guard.sh`** (built
  2026-10-08, kept after the fix): `guard.sh mem` prints host free, the
  driver's shared pool, dedicated and the descriptor count; `guard.sh up
  [flags]` refuses to start ComfyUI below `FLOOR_GB` (10) and passes flags
  through `COMFY_ARGS` and env through `GPU_ENV`; `guard.sh watch` kills it
  the moment the shared pool passes `SHARED_MAX_GB` (4 — the leak's
  signature, idle is ~1) or host free crosses the floor; `guard.sh drop`
  returns the VM's file cache to Windows, and every `up` runs it first
  (2026-10-14, the memory bullet below); `guard.sh batch <batch> [chunk]` runs the
  explore harness in chunks with a fresh process each time;
  `comfyui/leak_probe.py` is the experiment runner behind it, and
  `restart: "no"` keeps ComfyUI from coming back on its own after a crash.
  The history that earns it: before the fix the leak took host free from
  36.6 to 7.9 GB over nine adapter images (2026-10-07), each leaked
  allocation holding an `anon_inode` descriptor, so the engine's 1024
  `nofile` default stopped a run at "Too many open files" after ~10 images
  — raising it to 1 M (done that morning, undone that evening) removed the
  wall and **Windows froze hard twice**. Diagnose with `ls /proc/1/fd | wc
  -l` inside the container and `guard.sh mem`; the smoke prints descriptors
  per cycle.
- **Two memories, one cap: size the WSL VM for the models ComfyUI parks
  in CPU RAM (2026-10-09).** Windows free memory drops of 12–14 GB in one
  step turned out to be the WSL VM growing to its `.wslconfig` cap (24 GB on
  the dev distro), not the driver: the shared pool stayed at 0.8 GB each
  time. With adapter + style LoRA + canny ControlNet the card is at its
  edge (PyTorch reserved 14.4 GiB, 4.7 free), so ComfyUI's default loader
  parks whatever is not in use in CPU memory — the process reaches 14 GB
  resident, 17 GB high-water, and 1 GB of swap under the 24 GB cap, and
  spikes to the cap about every fifth image. That is bounded and harmless;
  the earlier floor of 20 GB killed it anyway, which is why the guard now
  watches the pool. The two loader flags are not the answer: `--gpu-only`
  pushed the shared pool to 5.3 GB before the first image, `--highvram`
  took 184 s for one image at 18.3 GiB reserved on a 16 GiB card and 4.2 GB
  of pool — both the leak's shape, both killed. Sizing: the production
  distro gets `memory=32GB` in its `.wslconfig` (17 GB process + ~10 GB
  page cache for the model files + headroom; the box has 64); the dev
  distro moved to it on 2026-10-10, with `autoMemoryReclaim=disabled` in
  the same edit after the VM froze three times under a CPU-side model load
  (`doc/issues.md`, Ops). The trade: with reclaim off the VM keeps its page
  cache, so once a batch has touched 32 GB the VM holds 32 GB until the
  next `wsl --shutdown`, and Windows free memory with a browser open fell
  to 7.7 GB mid-batch the same evening — the guard's 10 GB floor killed one
  chunk (pool flat at 1.2 GB) and the batch resumed. That is the floor
  doing its job, not a fault; if it repeats, `memory=28GB` at the next
  shutdown is the adjustment (the process high-water is 17 GB). It repeated
  2026-10-12 (batch 5b): free fell from 21.5 to 8.3 GB between two
  samples 13 s apart, pool 1.3 GB, and the floor stopped one chunk after
  12 images; the batch resumed and finished. Again 2026-10-14 (batch
  7a): free fell to 9.5 GB after 11 images, pool 0.9 GB, with the VM's
  page cache already full from a 4 GB model download and hash.
  **Cause and fix (2026-10-14): the cap was never what was tight; the
  file cache was.** The VM's 27 GB was 1 GB of processes and 26 GB of
  cache, and klein's ComfyUI holds only ~3.4 GB of RAM mid-batch (the
  17 GB high-water was the SDXL stack). The cache came from every
  ComfyUI start: `entrypoint.sh` runs `models.py fetch`, which hashes the
  whole store (66 GB, ~75 s), and that reading alone filled the VM to its
  cap. A bare `guard.sh up` took Windows free from 48.3 to 21.3 GB with
  no model loaded. `models.py` now tells the kernel to forget each file
  as it hashes it (`posix_fadvise DONTNEED`, no root needed, so the
  production worker gets it too): after the same verify, the cache
  stayed at 1 GB, and a start left Windows at 43.6 GB free. A klein run
  under the guard then bottomed at 28.2 GB free during the model load,
  where batch 7a had hit 9.5 and 7.3. The guard also drops the VM's
  cache as root before each start (`guard.sh drop`, through
  `wsl.exe -u root`), for cache from anything else (a download, a
  scorer run). Freed pages reach Windows over 10–40 s; the guard waits
  only when free memory is within 10 GB of the floor. `memory=32GB`
  stays. `autoMemoryReclaim=dropCache` (WSL drops the cache when the VM
  is idle) is untried here; the 10-10 freezes were under `gradual`.
  Still unmeasured: a model load also takes several GB outside the VM
  for a few seconds, about the size of the weights going to the card.
  Anything
  heavier than this graph (SD 3.5, a second ControlNet) needs the card,
  not the VM.
- **The pool rule is also the card's size gauge (2026-10-11).** Loading a
  model set that does not fit shows as the shared pool rising to 4.4–4.8 GB
  during the load and staying there, and the guard kills it: bf16 klein or
  Z-Image beside the 7.5 GB Qwen3 encoder, bf16 Z-Image beside the fp8
  one, Z-Image's 2.9 GB control patch beside its fp8 transformer and fp8
  encoder. What fits: SDXL + adapter + LoRA + ControlNet (14 GB), klein 4B
  fp8 + fp8 encoder (measured in batch 5b, 2026-10-12: ComfyUI loads the
  encoder at 5.4 GB, klein cast to fp8 at 3.7 GB and the VAE at 0.2 GB, all
  resident; Windows reads 13.2–14.4 GB dedicated mid-batch, pool flat at
  1.3 GB — 1.5–2.7 GB of the card left), Z-Image fp8 + fp8 encoder, Chroma fp8 + T5
  fp8 (full, 2.9 GB pool, slow). The idle pool rose from 1.0 to 1.9–2.1 GB
  across the day's model switching and stayed there after the server
  stopped — retained by the driver, not growing further; a reboot returns
  it to ~0.9 GB (2026-10-12). The
  guard now stops a batch whose chunk produced nothing instead of retrying
  it forever.
- **Windows renders desktop apps on the Arc with nothing cabled to it
  (2026-10-11).** Edge, Firefox, the terminal and the compositor draw on
  the Arc as Windows' "high performance" GPU and the frames are copied to
  the UHD 770 for display; the Arc is never idle while a browser is open,
  Arc-software readings include that work, and the cross-adapter copy is
  the likely source of the black-and-white window flicker. Windows 11 Pro
  26H2 on this box shows no "Default high performance GPU" dropdown
  (Settings › System › Display › Graphics › Default settings), so the
  routing is set per app on that page, or by the same key it writes:
  `HKCU\Software\Microsoft\DirectX\UserGpuPreferences`, one value per
  executable path, `GpuPreference=1;` (power saving = UHD 770). Pinned in
  the dev account 2026-10-11: Edge, Firefox, Chrome, Windows Terminal,
  Steam and `steamwebhelper`, the Xbox app and Game Bar overlay, Claude and
  ChatGPT desktop (Store identities), Discord (keyed by its `app-<version>`
  folder, so an update un-pins it until the readout shows it again), VS
  Code, Zed. Explorer, Settings and Task Manager are composited rather than
  self-rendered and are left alone unless the readout names them. The
  readout is `/gpu-health`'s "who is on the Arc" section; whatever it names
  that is not ComfyUI gets an entry. Windows Terminal ignores its entry
  (`Microsoft.WindowsTerminal_8wekyb3d8bbwe!App`, correct identity, still
  on the Arc at ~2% after a fresh boot, 2026-10-12); its renderer picks
  its own adapter, and the compositor's ~1% follows it. Two users the per-app key does not
  move (read 2026-10-11, after the pins): Sunshine, the remote-streaming
  host, encodes the stream on the Arc's media engine (its config sets no
  `adapter_name`, so it picks the best encoder) and pulls the compositor's
  capture onto the Arc with it; and Edge's video playback (decode plus
  video processing, likely its "Enhance videos" upscaler) stays on the
  Arc after its drawing moved. Fixed 2026-10-12: both Sunshine instances
  (`sunshine.conf`, `sunshine_2.conf`) carry `adapter_name = Intel(R) UHD
  Graphics 770`, backups beside them, so stream and capture stay on the
  UHD 770 (HEVC/H.264 there, no AV1 encode); hardware acceleration is off
  in Edge and Firefox (Logan), which takes their video decode off too.
  Linux GUI apps under WSLg (the
  Playwright browser) render through Mesa d3d12 and pick the Arc by
  default: `MESA_D3D12_DEFAULT_ADAPTER_NAME=UHD` in `~/.profile`, written by
  `scripts/bootstrap-distro.sh`, keeps them on the UHD 770. **Production
  account: the same per-app pins before the first job** — it is per user,
  and the provisioning step below says so.
- **Two accounts, one card — the coordination rule.** WSL is per user: the
  `monsterpaws` account runs its own VM with its own `.wslconfig`, and the
  two caps add against 64 GB (production 32; dev drops to 24 while both are
  live). The Arc is shared, not split, and two ComfyUI processes do not fit
  16 GB, so **one ComfyUI on the card at a time, production's by default**:
  a dev batch starts only when the production queue is idle and the guard
  sees an idle pool (dedicated 0, pool ≤ 2 GB); the guard gains a check for
  the other account's container before the first production job. Nothing
  of the dev account needs to be logged in for production to run (Task
  Scheduler, "whether the user is logged on or not"), and nothing of
  production's is reachable from the dev session.
- **Restarts, cheapest first — and "VRAM full" is not one of them.** A
  running batch shows the whole 16 GiB allocated: that is PyTorch's cache
  and ComfyUI's model cache, released on demand and at idle, never a reason
  to restart. The ComfyUI *process* is what holds any leaked host memory
  (the guard restarts it between chunks; by hand `docker compose -f
  comfyui/compose.yml restart comfyui`, models reload in ~30 s, a running
  job is retried by the queue). The WSL VM needs `wsl --shutdown` only for a
  kernel or `.wslconfig` change. Windows needs a reboot only for its GPU
  driver. None of these recovered the 2026-10-07 garbage copies — that was
  the runtime pairing, fixed in the Dockerfile.
- **Resizable BAR is on** (BIOS and Intel Graphics Software both say so,
  2026-10-09). Windows' `Win32_DeviceMemoryAddress` does not show the 16 GB
  window — it listed the Arc at 256 MB with ReBAR enabled — so never read
  ReBAR from that class; Intel's own software is the check.
- **A fast matmul proves nothing about correctness** — see the runtime
  bullet above. The smoke now round-trips values at several sizes, checks a
  3 GiB allocation and a ones-matmul's result, and only then times. Run it
  after any Windows driver, WSL or kernel update, and read
  `dmesg | grep dxg` when it fails.

The smoke result on the working stack (2026-10-07): `torch 2.14.1+xpu`, one
device `Intel(R) Graphics [0x56a0]` with 15,932 MiB, every round trip ok,
FP16 matmul ≈ 79 TFLOPS once warm (the first kernel includes JIT
compilation). The first SDXL generation followed: 1024², 25 steps at
2.3 it/s.
`npm run comfy` then served ComfyUI 0.38.0 on :8188 reporting
`Device: xpu:0 Intel(R) Graphics [0x56a0]`, 15,933 MB VRAM, NORMAL_VRAM; its
"Could not autodetect AIMDO implementation, assuming Nvidia" warning is
cosmetic. The native-Windows ComfyUI fallback named in ADR-0004 decision 2
was not needed.

## GPU rental — per job, dev only (ADR-0004 as amended 2026-10-22)

The anatomy LoRA's cleanups and training run on a DigitalOcean GPU Droplet
created for one job and destroyed when it ends. Never production, never
inference for a donation (that is the home worker's), never a shelter photo
on the box: Commons dogs and the crew only.

- **Limit:** Droplet GPUs, 0 on the account's Tier 2; one requested
  2026-10-22, **approved 2026-10-23**. On that day only the H200
  (`gpu-h200x1-141gb`, $4.47/h, `atl1` only) could be created from the
  control panel; the script defaults to it (`RENTAL_SIZE`, `RENTAL_REGION`
  override).
- **Sizes** (DO's price list, read 2026-10-22; billed per second, 60 s
  minimum): L40S 48 GB $1.57/h (the default: holds Qwen-Image-Edit and
  trains at about 4090 speed); RTX 4000 Ada 20 GB $0.76/h (trains klein
  Base 4B, ~2.5–3× slower); H100 $3.39/h (not needed).
- **Trap: a powered-off GPU Droplet still bills.** Only `doctl compute
  droplet delete` stops the meter, so every job ends in a delete, on
  failure too, and a leftover is looked for with `doctl compute droplet
  list` after each run.
- **The job:** `scripts/gpu-rental.sh up | clean <in> <out> | down |
  status`. `up` creates the droplet from DigitalOcean's "NVIDIA AI/ML Ready"
  image (`gpu-h100x1-base`) with the `monsterpaws-wsl` key, tagged
  `monsterpaws-rental`, ships `comfyui/` (tracked and untracked files),
  builds our ComfyUI image there with `TORCH=cu130` — PyTorch publishes
  torch 2.14.1, the Arc's pin, for CUDA 13.0 and not 12.8 (index read
  2026-10-23) — runs the smoke, and serves ComfyUI on the droplet's
  localhost only. A failed `up` deletes the droplet. `clean` runs
  `comfyui/workflows/qwen-edit-v1.api.json` with the one fixed instruction
  over a folder of PNGs and brings the results and the instruction home.
  `down` deletes every tagged droplet and fails loudly if one is left.
  Training (ai-toolkit, MIT, pinned by commit) is not scripted yet.
- **Traps found on the first run (2026-10-23, an hour, about $4.50):**
  the droplet's Docker builds with the legacy builder, which cannot
  resolve the Dockerfile's `comfy:comfy` chown — `serve` installs
  `docker-buildx` and builds with BuildKit, as home does; Triton compiles
  its CUDA launcher at first use and needs `gcc` and the Python headers,
  which the Arc build never did — a rental-only layer adds them, leaving
  the home image's pins alone; and a long ssh session that drops leaves
  the caller waiting on a dead job, so `serve` and `clean` run detached on
  the box (`comfyui/rental/`) and are polled. `pass` locks itself after a
  few minutes: unlock it before `down`, which needs the token.
- **Models:** `comfyui/models-rental.manifest`, selected by
  `MODELS_MANIFEST`, never `models.manifest`: the home store fetches every
  line of that one at each start, and Qwen-Image-Edit's ~58 GB only ever
  runs on a rented card. Same format, same hash check, same licence record.

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
        │                    └───┬───┘  │   │   · nightly pg_dumps    │
        │                        │      │   │  monsterpaws-corpus     │
        │                        │      │   │   · scraped HTML,       │
        │                        │      │   │     content-addressed   │
        │                        │      │   │     (worker-only)       │
        │  ┌──────────────┐      │      │   └─────────────────────────┘
        │  │    worker    │      │      │         ▲ writes (keys in DB)
        │  │   pg-boss    │      │      │         │
        │  │ poller, jobs │◄─────┤──────┼─────────┘
        │  │ (never art)  │      │      │
        │  └──┬───────┬───┘ shared types│
        └─────┼───────┼────────────────-┘
              │       │
              ▼       ▼
  ┌────────────────┐ ┌──────────────────────────────┐
  │  DO Managed    │ │        external APIs         │
  │  Postgres 16   │ │  RescueGroups (poll daily)   │
  │  · DO backups  │ │  Every.org   (donations)     │
  │  · pgvector    │ │  Replicate   (LoRA training; │
  │  · pg-boss q   │ │     image-gen escape hatch)  │
  │  · corpus+FTS  │ │  Shelterluv/Petango (tier 1) │
  └───────▲────────┘ └──────────────────────────────┘
          │ SSH tunnel: home → droplet → Postgres (the art
          │  worker, planned); the poll bridge reverses it —
          │  droplet → home → RescueGroups, below (ADR-0033)
          │ (the droplet is the trusted source; the house
          │  opens no port to the internet — outbound only)
  ┌───────┴──────────────────────────────────────────────────────┐
  │  Logan's main rig, Windows 11, 64 GB  (planned, item 4;      │
  │  ADR-0004 as amended 2026-10-05)                             │
  │                                                              │
  │  ┌─ Logan's account (dev) ─┐  ┌─ "monsterpaws" std user ──┐  │
  │  │ monsterpaws-dev (M.2)   │  │ monsterpaws-prod (M.2)    │  │
  │  │ repo · pass · /deploy   │  │ 24 GB cap, no C: mount,   │  │
  │  │ docker engine · ComfyUI │  │ interop off               │  │
  │  │                         │  │  systemd → docker engine  │  │
  │  │   ssh localhost:2222 ──────►│  sshd (local port only)   │  │
  │  │   .env (scoped) · pull  │  │  ┌─────────┐ ┌─────────┐  │  │
  │  └─────────────────────────┘  │  │ worker  ├►│ comfyui │  │  │
  │                               │  │ art.gen │◄┤ headless│  │  │
  │   Arc A770 16 GB ─ shared     │  │  ONLY   │ │ xpu     │  │  │
  │   through the host driver;    │  └────┬────┘ └─────────┘  │  │
  │   one ComfyUI at a time       │       │ models store: its │  │
  │   display on the iGPU         │       │ own, filled from  │  │
  │   one WSL VM per account      │       │ the manifest,     │  │
  │                               │       │ hash-verified     │  │
  │                               └───────┼───────────────────┘  │
  └───────────────────────────────────────┼──────────────────────┘
                                          ▼ card art, write-only pair
                                   R2 monsterpaws-media (keys in DB)
```

The home box is a second worker, not a second server: nothing there is in the
request path, it pulls jobs and pushes results, and when it is asleep the art
waits. It runs only CI-built images (ADR-0007 as amended 2026-10-05) and is
deployed like the droplet, over SSH on a port that exists only on the
machine itself. Development never happens on the `monsterpaws` account.
Provisioning it — the Windows user, the distro on the M.2, the Task Scheduler
start, and the scoped credentials in the registry above — is a step here and
an oplog entry when it happens.

### The poll bridge, until RescueGroups allowlists the droplet (ADR-0033)

```
  Logan's machine (monsterpaws-dev)              DigitalOcean droplet
  ┌──────────────────────────────────┐           ┌──────────────────────────────┐
  │ scripts/poll-via-bridge.sh       │ ONE ssh   │ sshd                         │
  │  · pass: DO token → doctl → $IP  ├──────────►│  -R 127.0.0.1:18443          │
  │  · ssh master, -R 18443          │  (ufw     │        │                     │
  │                                  │  LIMIT)   │        ▼                     │
  │ scripts/rg-proxy.ts              │           │ docker run --network host    │
  │  127.0.0.1:18443                 │◄──────────┤  worker:$IMAGE_TAG           │
  │  CONNECT api.rescuegroups.org:443│  reverse  │  --env-file .env, do-ca.crt  │
  │  only — 403 otherwise            │  forward  │  NODE_USE_ENV_PROXY=1        │
  └───────────────┬──────────────────┘           │  HTTPS_PROXY=127.0.0.1:18443 │
                  │ TLS end to end,              │  npm run ingest -- poll      │
                  │ worker ⇄ RescueGroups        │  heartbeat: ok on exit 0,    │
                  │                              │  /fail otherwise             │
                  ▼                              └──────────────┬───────────────┘
        RescueGroups v5 API                                     │ pg, TLS verified
        (refuses the droplet's address:                         ▼
         Spamhaus PBL, UCEPROTECT L3)                    DO Managed Postgres
                                                         (firewall: droplet only)

  Fallback, scripts/poll-via-home.sh: the worker runs at home instead and
  reaches Postgres through an ssh -L tunnel — every write a round trip, ~6 h.
  The droplet's own 07:00 schedule: off (INGEST_POLL_SCHEDULE=off,
  ADR-0033 as amended 2026-10-28). Next (planned, ADR-0033 decision 7): a
  Task Scheduler task at 07:00 UTC, a key restricted to the forced command
  and permitlisten.
```

## CI / deploy pipeline

```
  git push ──► GitHub Actions (ci.yml)                    droplet (+ the home
              ┌──────────────────────────────┐            worker, planned, ADR-0007
              │ verify                       │   manual   ┌─ as amended 2026-10-05)
              │  typecheck                   │  /deploy   │ IMAGE_TAG=<sha> .env │
              │  vitest ×2   (flaky bar) ◄─┐ ├───────────►│ compose pull         │
              │  next build  (standalone)  │ │  ship bar  │ compose up -d        │
              │  playwright vs standalone  │ │  green     │  · caddy (certs kept)│
              │    server.js on seeded     │ │            │  · app   (pulled)    │
              │    monsterpaws_e2e         │ │            │  · worker(pulled)    │
              │                            │ │            │  · comfyui (home)    │
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
              │  docker build app + worker   │            │  monster-paws-comfyui│
              │  + comfyui (planned; built,  │            │   (planned; TORCH=xpu│
              │  not run — CI has no GPU)    │            │   | cuda build arg)  │
              │  --target sourcemaps export  │            │  :<sha> only — prod  │
              │  (debug IDs stamped offline) │            │  pins IMAGE_TAG      │
              │                              │            │  (ADR-0007, oplog 2) │
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
  │ outreach_events,         │           │                          │
  │ shelter_contacts, the    │           │                          │
  │ consent/ .eml in the     │           │                          │
  │ vault (ADR-0029)         │           │                          │
  └───────────┬──────────────┘           └──────────────────────────┘
              │ backed up: DO PITR (continuous)
              │            + nightly pg_dump → R2 vault (off-DO copy)
              ▼
  purge exceptions (ADR-0006 as amended): rows tagged
  source='rescuegroups' (ToS termination) or source='scrape:<slug>'
  (that shelter revokes consent) are set-deletable — the TWO carve-outs
```

Ingest keys: `RESCUEGROUPS_API_KEY=$(pass show rescuegroups/api-key)` —
granted 2026-08-02, scoped to what the application declared (donations +
keepsakes); the Tracker pixel obligation rides on it (ADR-0006).
