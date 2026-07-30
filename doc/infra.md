# Infrastructure runbook

Operational companion to ADR-0003/0007 and DIRECTION.md §Infrastructure.
Everything here is CLI-first so provisioning is reproducible and scriptable
into workflows later. Diagrams at the bottom are the source of truth for
the deployment shape.

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
# 1. Droplet — Docker preinstalled via marketplace image, NYC3, 2vCPU/4GB
doctl compute droplet create monsterpaws \
  --image docker-20-04 --size s-2vcpu-4gb --region nyc3 \
  --ssh-keys "$(doctl compute ssh-key list --format ID --no-header | head -1)" \
  --wait
IP=$(doctl compute droplet get monsterpaws --format PublicIPv4 --no-header)

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
rclone_r2() {
  RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare \
  RCLONE_CONFIG_R2_ACCESS_KEY_ID=$(pass show cloudflare/r2-access-key-id) \
  RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=$(pass show cloudflare/r2-secret-access-key) \
  RCLONE_CONFIG_R2_ENDPOINT=$(pass show cloudflare/r2-endpoint) \
  RCLONE_S3_NO_CHECK_BUCKET=true \
  rclone "$@"
}
# NO_CHECK_BUCKET is required since 2026-07-30: the R2 token is BUCKET-scoped
# (media+vault only), so rclone's bucket-exists probe 403s and it wrongly
# falls back to CreateBucket. Same flag needed by any S3 client we configure.
# e.g. rclone_r2 lsd r2:   ·   rclone_r2 mkdir r2:<bucket>
# Gotcha hit during setup: a freshly-activated R2 account returns TLS
# handshake failures on its S3 endpoint for a few minutes — wait, don't debug.

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

# 7. First deploy, on the droplet
ssh root@$IP 'git clone <repo-url> monsterpaws && cd monsterpaws &&
  cp .env.example .env && $EDITOR .env &&
  docker compose -f docker-compose.prod.yml up -d --build'
```

## Recurring ops

```sh
# Deploy (also in /deploy skill)
ssh <droplet> 'cd monsterpaws && git pull && docker compose -f docker-compose.prod.yml up -d --build'

# Weekly DB copy outside DO (ADR-0003 belt-and-suspenders) — cron on droplet
pg_dump "$DATABASE_URL" | gzip | rclone rcat r2:monsterpaws-vault/pgdump/$(date +%F).sql.gz

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
  │  Postgres 16   │ │  RescueGroups (poll ~30m)    │
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
  │ event_log                ├──────────►│ embeddings (+model tag)  │
  │ attestations + R2 mirror │           │ FTS indexes              │
  │ donor accounts           │           │ ISR page cache           │
  └───────────┬──────────────┘           └──────────────────────────┘
              │ backed up: DO PITR (continuous)
              │            + weekly pg_dump → R2 vault (off-DO copy)
              ▼
  purge exception (ADR-0006): rows tagged source='rescuegroups'
  are set-deletable to honor ToS termination — the ONE carve-out
```
