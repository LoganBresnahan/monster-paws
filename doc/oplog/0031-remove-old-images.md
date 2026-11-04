# 0031: Remove old images from the droplet, before oplog 0029 pulls another

Status: planned
Planned: 2026-11-04 · Run: —
Why: DigitalOcean's alert, 2026-11-04 15:28:49 UTC: the disk over 85%. Logan, directly: "check the droplet's disk and clean up old images before 0029". Roadmap: Accounts and donating (item 4)

What changes: old images deleted, by name. Nothing restarts, and no file, volume, log or `.env` is touched.

What this opens: nothing. Rolling back past `0989a18` would pull its image from GHCR again, which still holds them.

**Keep, read in the 15:48 UTC read below:** `83b2bc9`, running; `0989a18`, the one before it; `caddy:2-alpine`, running; `postgres:16-alpine`, which oplogs read through; **`postgres:16.4-alpine` and `rclone/rclone:1.68.2`, which the nightly backup runs (`scripts/backup-db.sh`). Never `docker image prune -a`: it would take these two.**

Who does what: Logan gave the word above, to the session running this. One SSH session per step.

## Prerequisites
- [x] Read 2026-11-04 15:48 UTC, by Logan's word: `/` 25G, 22G used, 2.7G free, 90%. Docker: 29 images, 15.77 GB, 13.33 GB reclaimable; containers 2.5 MB; volumes 13 KB; build cache 0. Container logs 120 KB. `/var/log` 644M, 576M of it the journal. `/root/monsterpaws` 21M. **It's images.** Each deploy keeps its predecessor, at about 1.7 GB, and nothing has ever removed one.
- [x] What references what, read: compose names only `${IMAGE_TAG}`, with no default; the bridge poll runs `IMAGE_TAG`'s worker; the backup's two images above. Nothing names `latest` or `rollback-0002`.
- [ ] Not within an hour of 06:00, 07:00 or 08:30 UTC.

## Steps

### 1. Remove them by name
`docker rmi` refuses an image a container uses, so a mistake here fails loudly. The pattern can't reach `83b2bc9`, `0989a18` or anything outside the two repositories.

    IP=$(DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token | head -n1) doctl compute droplet get monsterpaws --format PublicIPv4 --no-header)
    ssh root@$IP 'df -h / | tail -1; docker images --format "{{.Repository}}:{{.Tag}}" | grep -E "/monster-paws-(app|worker):(12c451f|cc8ca32|40cb846|c45e085|a2610f5|34d36ff|c58d87f|rollback-0002$|latest$)" | xargs -r docker rmi 2>&1 | grep -c "^Untagged"; df -h / | tail -1; docker system df | head -2; docker images --format "{{.Repository}}:{{.Tag}}" | sed -E "s#ghcr.io/loganbresnahan/##" | cut -c1-40'
    curl -fsS https://monsterpaws.org/api/health
Verify: 18 untagged; free space about 10 GB or more; the six kept images listed; all three containers up; health 200 on `83b2bc9`.
Stop if: a kept image is gone: pull it again before anything else.
Rollback: `docker pull` the image by its tag. GHCR holds every sha.

## Run
<filled in as it happens>

## Follow-ups
- `doc/infra.md`'s Recurring ops says to do this after a deploy, since this disk holds about a dozen images.
- The journal's 576M is untouched: not the problem, and Logan asked about images.
- Oplog 0029's pull, once this has run.
