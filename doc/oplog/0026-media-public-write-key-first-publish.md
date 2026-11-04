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

What this opens: anything in the bucket, to anyone who has its key. The bucket lists nothing through a custom domain, and a token can't be guessed. **Never put a photo held for painting in this bucket.** Public access is
bucket-wide. A shelter animal's painting may go here under ADR-0036 decision 4, whose takedown rule covers a withdrawal; this entry publishes only a crew pet's.

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
Both commands have only run against fakes, so this is their first real write. A set now comes from a keepsake's own rows (ADR-0036 as of `9d297c9`), so the proof uses a rehearsal
keepsake painted by the chain in `monsterpaws_demo`, published, taken down, and published again as the set the demo links to. Publishing takes `DATABASE_URL`, `ART_STORE_DIR`,
`SHARE_WRITE_ENDPOINT`, `SHARE_WRITE_BUCKET=monsterpaws-media` and step 2's pair:

    npm run share -- publish <keepsake-id>
It refuses a keepsake without four `art` facts, a size other than 1216×832, and a shelter with no `digify` grant today. Takedown also takes `SHARE_BASE_URL=https://media.monsterpaws.org`, `CLOUDFLARE_ZONE_ID` (the lookup in
`doc/infra.md`'s Cloudflare section) and `CLOUDFLARE_PURGE_TOKEN` (`cloudflare/dns-token` has Cache Purge). Without the purge keys it deletes, says NOT PURGED and exits 2.

    npm run share -- takedown <token>
Verify, first publish: each upload read back and compared by hash; `manifest.json` written last, holding exactly the name, kind and any shelter; no EXIF, XMP or generator text in any JPEG; its files answer 200 with no credentials.
Verify, takedown: its `manifest.json` and a JPEG answer 404 with no credentials.
Verify, final publish: as the first, and once oplog 0025 has put the route live, `curl` of `/share/<token>` and its `painting.jpg` with a bot's user agent answers 200, and the page's `og:image` is that painting's. The token stays out of this entry.
Rollback: `npm run share -- takedown <token>`.

## Run
Steps 1 to 3, 2026-11-04 00:07 to 00:08 UTC, by the moderator; Logan connected the domain with minimum TLS 1.2. Step 4's publish, takedown and
publish, 2026-11-04 02:41 to 02:45 UTC, by `paintings`, on Logan's "ok for beetle" and the moderator's go; its bot `curl` waits on oplog 0025's route.

- **Step 1:** 0 objects and 0 bytes, read before the domain served anything.
- **Step 2:** the worker pair wrote, read and deleted `probe/0026`. `rclone rcat` reported a 501 though the object landed, and `rclone copyto` needed a second attempt, both with `RCLONE_S3_NO_CHECK_BUCKET=true`, because a token scoped to objects can't check a bucket. The share tool's own PUT is what step 4 proves.
- **Step 3:** for about the first minute every request answered 403 with Cloudflare's `error code: 1014`, then it cleared by itself at 00:08:08. Root 404 and a missing key 404, with no listing in the body. The probe answered 200 with no credentials, and to `Twitterbot/1.0` and `facebookexternalhit/1.1`. TLS 1.0 and 1.1 are refused, 1.2 connects. After the delete: 404, and the bucket back to 0 objects.

- **Step 4, prerequisites:** the set is keepsake 1 in `monsterpaws_demo`, Beetle, painted by the chain 2026-11-04 00:46 to 00:52 UTC, four
  marked JPEGs at 1216×832 with no metadata; Logan's OK in `paintings`' chat; the crew's consent line on topdog ("Extended 2026-11-03"); `pass`
  unlocked, its four entries read inside each command and never printed; the zone id looked up as `doc/infra.md` does, never printed.
- **Step 4, first publish, 02:41:18 to 02:41:24:** `npm run share -- publish 1` wrote `1.jpg` to `4.jpg` (142,648, 205,714, 194,372 and
  201,837 bytes) and then `manifest.json` (37 bytes), each read back and matched by sha256. With no credentials all five answered 200, the
  bytes matching the hashes the tool printed; `manifest.json` held exactly `{"name":"Beetle","kind":"Bloodhound"}`; no JPEG held EXIF, XMP,
  an ICC profile or generator text.
- **Step 4, takedown, 02:41:55 to 02:42:00:** `npm run share -- takedown <token>` deleted the share, read every object back as absent, and
  purged 14 URLs. With no credentials `manifest.json`, `1.jpg` and `4.jpg` answered 404, none from cache.
- **Step 4, final publish, 02:42:21 to 02:42:26:** the same five objects and hashes as the first. **Found:** `1.jpg` and `4.jpg` then answered
  404 to a GET for about three minutes while `2.jpg`, `3.jpg` and the manifest answered 200: `cf-cache-status: HIT`, age 55 s at 02:43:04,
  the 404s the takedown's own check fetched at 02:42:10 and the edge kept, as Cloudflare keeps a 404 on a `.jpg` (it doesn't cache
  `.json`). A HEAD answered 200 throughout. They cleared at 02:45:10 with nothing done, and at 02:45:29 all five answered 200 with the
  first publish's checks. So a GET of a share's JPEG before it exists, or in the minutes after a takedown, holds a 404 at the edge for
  about three minutes; a republish soon after a takedown wants a purge of its URLs, or the wait.

## Follow-ups
- The dedicated media write pair in `doc/infra.md` still comes with the real home worker, because the pair used here can also write the corpus.
- `doc/infra.md`: public access is recorded as on for media, and its diagram gains `media.monsterpaws.org` and loses "original photos" from this bucket. `doc/flows.md`'s keepsake-art box stops sending a donor's art here until ADR-0036's rules are settled.
- `SHARE_BASE_URL=https://media.monsterpaws.org` in the droplet's `.env`, in oplog 0025.
- A real donor's set publishes through the handler under ADR-0036, not this entry. Photos held for painting go somewhere private, never here (ADR-0035 decision 11).
  private, never here (ADR-0035 decision 11).
