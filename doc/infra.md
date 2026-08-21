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
| `wrangler` | Cloudflare R2: buckets, objects, spot-checks | **no install** — `npx wrangler@latest` (rare ops; keep it out of package.json) | `CLOUDFLARE_API_TOKEN=$(pass show cloudflare/r2-token)` — token scoped Account·R2·Edit |
| Cloudflare API (`curl`) | DNS records, SSL mode, cache — wrangler doesn't do DNS | — | `CF_API_TOKEN=$(pass show cloudflare/dns-token)` — token scoped Zone·DNS·Edit |
| `rclone` | Shipping pg_dumps + attestation mirror to R2 (S3-compatible) | `sudo apt install rclone` | `rclone config` → S3 provider, R2 endpoint |
| `gh` | repo, Actions runs, CI watch (already installed) | — | `gh auth login` |

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
#     `pass cloudflare/r2-token` is NOT a valid CF API token (verified
#     2026-08-17: "Invalid API Token" from /user/tokens/verify) — every
#     working path uses the S3 access-key-id/secret entries instead.
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
#     Health: /api/health (ok + sha + uptime) — point external uptime check
#     here; extended with DB + poller-age at ingest.

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
              │ typecheck                    │   manual   │ git pull             │
              │ vitest ×2   (flaky bar)      │  /deploy   │ compose up -d --build│
              │ next build  (standalone)     ├───────────►│  · caddy (certs kept)│
              │ playwright vs `next start`   │  ship bar  │  · app   (rebuilt)   │
              │   (prod bytes, not dev)      │  green     │  · worker(rebuilt)   │
              └──────────────────────────────┘            │ smoke: /api/health   │
                                                          │ rollback: checkout   │
                                                          │  prev sha + rebuild  │
                                                          └──────────────────────┘
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
