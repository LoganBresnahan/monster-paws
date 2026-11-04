# 0026: `monsterpaws-media` goes public, and the crew's first set is published

Status: planned
Planned: 2026-11-03 · Run: —
Why: the Meta demo's share page (ADR-0036, ADR-0028), which needs a painting at a public address, because a social site builds its preview from the
page and image it fetches. Logan, 2026-11-03: "yes bucket okay. its currently private switch it if you can". `monsterpaws-media` was built to be served
publicly (ADR-0011, ADR-0004 as amended 2026-10-29), and public access is off on every bucket until this entry.
Roadmap: Accounts and donating (item 4)

What changes: public access on `monsterpaws-media` through `media.monsterpaws.org`, and with it a new
Cloudflare DNS record; one crew pet's set under `share/<token>/`. Nothing on the droplet, in its `.env` or in the database: `SHARE_BASE_URL` reaches the
droplet in oplog 0025.

What this opens: anything in the bucket, to anyone who has its key. The bucket lists nothing through a custom domain, and a token can't be guessed. **Never
put a photo held for painting in this bucket, or a shelter animal's painting, until Logan has decided what a withdrawal does to a shared painting (ADR-0036).**

Who does what: **Logan does step 3 in the Cloudflare dashboard**, because our tokens can't configure a bucket: `cloudflare/r2-token` answered 403 on the
bucket's domain settings, 2026-11-03 23:56 UTC, and `doc/infra.md` says the same. The moderator runs steps 1 and 2 and step 3's check. `paintings` runs step 4.

## Prerequisites
- [x] The bucket holds nothing: `rclone size`, 0 objects and 0 bytes, 2026-11-03 23:47 UTC. Step 1 reads it again.
- [ ] `pass` unlocked by Logan.
- [ ] For step 4: the handler's set on disk, marked, and Logan's OK on that pet's paintings; `npm run share -- publish` on topdog; ADR-0036 and the consent
      line in `doc/consent/0001-the-crew.md` landed.

## Steps

### 1. Read the bucket again, with the worker pair
    RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare \
      RCLONE_CONFIG_R2_ACCESS_KEY_ID="$(pass show cloudflare/r2-access-key-id | head -n1)" \
      RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$(pass show cloudflare/r2-secret-access-key | head -n1)" \
      RCLONE_CONFIG_R2_ENDPOINT="$(pass show cloudflare/r2-endpoint | head -n1)" \
      rclone size r2:monsterpaws-media --json 2>/dev/null
Verify: `"count":0`. Stop if anything is there: say what, by prefix, before public access goes on.
Rollback: n/a — a read.

### 2. The write key: the worker pair, no new token
Logan, 2026-11-03: "the cloudflare api tokens are already in pass. they are the generic named ones not models or vault. these apply to monsterpaws-corpus and monsterpaws-media".
So `cloudflare/r2-access-key-id` and `cloudflare/r2-secret-access-key` publish, on the dev box only. **That pair can also write the corpus, so `SHARE_WRITE_BUCKET` is fixed to
`monsterpaws-media`, and the pair never goes on the droplet for this.**
Verify, by the moderator: the pair writes, reads and deletes `probe/0026` in media. Statuses only.
Rollback: n/a — no credential changes.

### 3. Public access (Logan)
R2 → `monsterpaws-media` → Settings → Public access → Custom domains → Connect domain: `media.monsterpaws.org`. Leave the `r2.dev` URL off.

Verify, by the moderator, with no credentials:

    curl -s -o /dev/null -w 'root %{http_code}\n' https://media.monsterpaws.org/
    curl -s -o /dev/null -w 'missing %{http_code}\n' https://media.monsterpaws.org/share/none/manifest.json
Both answer 404, or the root 403, and neither lists anything. An unauthenticated read of a probe object answers 200, and it's then deleted.
Rollback: disconnect the domain on the same page. The bucket is private again, and Cloudflare's cached copies age out or get purged.

### 4. Publish one crew pet's set (`paintings`)
Both commands have only run against fakes, so this is their first real write. Run them on a throwaway set first, then publish the real one (ADR-0036 decision 10).
Publishing takes `SHARE_WRITE_ENDPOINT`, `SHARE_WRITE_BUCKET=monsterpaws-media` and step 2's pair:

    npm run share -- publish <crew-slug> <4 files>
It refuses a slug not in `CREW` and any size but 1216×832. Takedown also takes `SHARE_BASE_URL=https://media.monsterpaws.org`, `CLOUDFLARE_ZONE_ID` (the lookup in
`doc/infra.md`'s Cloudflare section) and `CLOUDFLARE_PURGE_TOKEN` (`cloudflare/dns-token` has Cache Purge). Without the purge keys it deletes, says NOT PURGED and exits 2.
Verify, throwaway set: published and read back, then `takedown`, then its `manifest.json` and a JPEG answer 404 with no credentials.
Verify, real set: each upload read back and compared by hash; `manifest.json` written last, holding exactly the name and kind; no EXIF, XMP or generator text in any JPEG;
once oplog 0025 has put the route live, `curl` of `/share/<token>` and its `painting.jpg` with a bot's user agent answers 200, and the page's `og:image` is that
painting's.
Rollback: `npm run share -- takedown`, which deletes the objects and purges Cloudflare.

## Run
<filled in as it happens>

## Follow-ups
- The dedicated media write pair in `doc/infra.md` still comes with the real home worker, because the pair used here can also write the corpus.
- `doc/infra.md`: public access is recorded as on for media, and its diagram gains `media.monsterpaws.org` and loses "original photos" from this bucket. `doc/flows.md`'s keepsake-art box stops sending a donor's art here until ADR-0036's rules are settled.
- `SHARE_BASE_URL=https://media.monsterpaws.org` in the droplet's `.env`, in oplog 0025.
- Before a real donor's painting is ever published: the takedown rule, the `/privacy` line and telling shelters (ADR-0036). Photos held for painting go somewhere
  private, never here (ADR-0035 decision 11).
