# ADR-0011: The corpus vault — a separate R2 bucket, `aws4fetch` as its client

## Context
ADR-0009 makes vaulted HTML the replay substrate: the LLM extractor reads
archived pages, never the live site, so an extraction bug is repaired by
replay with no source contact. That requires somewhere to put the HTML, and a
client to put it there.

Two existing buckets already carry R2 traffic (ADR-0003, ADR-0007):
`monsterpaws-media` (photos, card art — public-read) and `monsterpaws-vault`
(attestation flat-file mirror, weekly pg_dumps — the disaster-recovery copy).
Neither is a fit: the ingest worker writes every day, unattended, from a
process that also parses untrusted HTML.

We also have no S3 client in the dependency tree yet, and the app runs on a
1GB droplet where image size is a real budget.

## Decision

**A third bucket, `monsterpaws-corpus`, for scraped HTML only.**
- The worker's credential is the one exercised daily by the least-trusted
  code path. Scoping it to `corpus` (+ `media` for generated art) means it
  structurally *cannot* reach pg_dumps or the attestation mirror — a
  compromised or buggy worker cannot damage the disaster-recovery copy.
- Deletion postures differ and shouldn't share a lifecycle policy: backups
  rotate, attestations keep forever, scraped HTML is subject to selective
  deletion when a shelter revokes consent (ADR-0006 as amended).

**Content-addressed keys: `html/<shelter-slug>/<sha256-of-html>.html`.**
- An unchanged page re-fetched daily produces the same key, so the vault
  self-dedups; a put is always safe to repeat.
- Sharded by shelter slug because revocation deletes a *prefix* — one
  `rclone purge r2:monsterpaws-corpus/html/<slug>/` honors the obligation.
- The raw row stores the key, never the HTML (keys-not-blobs, ADR-0003). The
  scrape payload is `{ url, vaultKey }`, and since the key embeds the page's
  own hash, the row's `content_hash` changes exactly when the page does —
  stage-1 dedup keeps working without ever reading R2, and no migration is
  needed to carry the key.

**Client: `aws4fetch`** (~3KB, zero dependencies) over `@aws-sdk/client-s3`
(~2MB+ of transitive deps). The vault only ever does single-object
HEAD/PUT/GET against an S3-compatible endpoint; SigV4-over-`fetch` is the
whole requirement. Signing and dispatch are separated in
`src/core/ingest/vault.ts` (`sign()` then an injected `fetch`) so the vault is
exercisable in unit tests without a network or real credentials.

**Writes are HEAD-then-PUT.** The key is the content hash, so a HEAD hit
means the identical bytes are already stored and the write is pure cost — a
daily re-poll of a quiet shelter would otherwise rewrite every page every day
(Class A operations) for no change in state.

**Ordering invariant, enforced in code**: fetch → vault → hash → raw row →
extract. `vaultThenObserve()` is the only sanctioned way to build a scrape
observation, so HTML cannot reach the corpus without reaching R2 first.

## Consequences
- One more bucket and one more scoped token to provision; `doc/infra.md`
  carries both, and `NO_CHECK_BUCKET` remains required for bucket-scoped
  tokens.
- Storage grows unboundedly with pages × distinct versions. At R2 pricing
  (~$0.015/GB-month, zero egress) a few hundred shelters is cents; the
  lifecycle policy ADR-0009 flagged is still owed, but is not urgent.
- `aws4fetch` gives us no retries, multipart, or presigning. Single-object
  operations don't need them; if the vault ever needs multipart, that's the
  revisit trigger, not a patch.
- Signing is per-request rather than per-client-session — negligible for our
  call volume.

## Alternatives
- **Reuse `monsterpaws-vault`**: rejected — it collapses the credential
  separation that is the main point, and mixes rotate-me data with
  keep-forever data under one lifecycle.
- **`@aws-sdk/client-s3`**: rejected for size and for a surface area we
  don't use. Reconsider only if we need multipart or presigned URLs.
- **Cloudflare R2 bindings / Workers**: rejected — we are not on Workers;
  the always-on droplet worker is the architecture (ADR-0001).
- **Store HTML in Postgres JSONB alongside the raw row**: rejected — blobs
  in the DB inflate the backup that ADR-0003 wants to stay cheap, and R2 is
  an order of magnitude cheaper per GB.
- **Keys by URL path rather than content hash**: rejected — a re-fetch would
  overwrite, destroying the version history that makes replay meaningful.

## Revisit triggers
- The vault needs multipart, presigning, or retry policy → re-evaluate the
  AWS SDK.
- Corpus storage passes ~50GB or the bill becomes visible → write the
  lifecycle/retention policy ADR-0009 flagged.
- A second consumer needs read access to scraped HTML → revisit whether the
  bucket stays worker-private.
