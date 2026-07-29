# Infrastructure runbook

Operational companion to ADR-0003/0007 and DIRECTION.md §Infrastructure.
Everything here is CLI-first so provisioning is reproducible and scriptable
into workflows later. Diagrams at the bottom are the source of truth for
the deployment shape.

## CLI roster

| Tool | For | Install | Auth |
| --- | --- | --- | --- |
| `doctl` | DigitalOcean: droplet, firewall, managed PG, snapshots | `cd ~ && wget -qO- https://github.com/digitalocean/doctl/releases/latest/download/doctl-$(curl -s https://api.github.com/repos/digitalocean/doctl/releases/latest \| grep -Po '"tag_name": "v\K[^"]*')-linux-amd64.tar.gz \| tar xz && sudo mv doctl /usr/local/bin` (or `sudo snap install doctl`) | `doctl auth init` (API token from cloud.digitalocean.com/account/api) |
| `wrangler` | Cloudflare R2: buckets, objects, spot-checks | `npm i -g wrangler` | `wrangler login` (or `CLOUDFLARE_API_TOKEN`) |
| Cloudflare API (`curl`) | DNS records, SSL mode, cache — wrangler doesn't do DNS | — | scoped API token (Zone.DNS edit) in `CF_API_TOKEN` |
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

# 5. R2 buckets — images + attestation mirror + db copies
wrangler r2 bucket create monsterpaws-media
wrangler r2 bucket create monsterpaws-vault   # attestation flat files + pg_dumps

# 6. Managed Postgres — DEFERRED until ingest (roadmap item 2). When needed:
doctl databases create monsterpaws-pg --engine pg --version 16 \
  --size db-s-1vcpu-1gb --region nyc3
doctl databases connection monsterpaws-pg   # → DATABASE_URL for .env

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
gh run watch --exit-status
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
