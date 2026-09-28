# ADR-0017: Tests own their database; the corpus is not a test fixture

## Context

`raw_payloads` and `event_log` are append-only because the corpus is the
asset (CLAUDE.md): every derived table is rebuildable from it, which is why
ADR-0009 can promise that a normalizer change is repaired by `replay` rather
than by re-fetching. That promise is only worth anything while the raw rows
exist.

Five test files — the Postgres store, merge, lifecycle, visibility and parity
suites — begin each case with

```sql
truncate table raw_payloads, animals, animal_identities, animal_display, event_log
  restart identity
```

Their only guard is `describe.skipIf(!DATABASE_URL)`. That asks whether a
database is *configured*, never whether it is *disposable*, and the documented
way to run them (`npm run db:up`, then `npm test`) points `DATABASE_URL` at the
development database. The suite is therefore designed to wipe whichever
database it is handed, and the only thing standing between it and a real
corpus is that the variable happens to be unset.

On 2026-08-25 the first complete RescueGroups poll wrote 64,110 canonical
animals and their raw payloads. On 2026-09-03 that database held two raw rows.
Nothing could restore them: `doctl databases list` is empty, so there is no
Managed Postgres and the run had gone to the local dev volume; the
RescueGroups adapter never calls `vaultThenObserve`, so R2 holds no copy of an
API payload; and the weekly `pg_dump` in `doc/infra.md` says of itself "NOT
LIVE YET: waits on Managed Postgres". An append-only corpus had a live wipe
and no second copy.

Re-polling cost about fifteen minutes, which is why this reads as an
inconvenience rather than a loss. It will not stay that cheap. Consented
scrapes (item 5) observe pages that change and are not re-fetchable at all;
their vaulted HTML survives in R2 only because the raw rows index it.

## Decision

1. **A test connects only to a database it is entitled to destroy.** The
   Postgres suites read `TEST_DATABASE_URL`; `DATABASE_URL` stops being a test
   input entirely — no fallback, because a fallback is how this happened.
   When the database is unreachable the run **fails**; it never skips. A suite
   that quietly declines to run is the same failure as a suite that wipes the
   wrong database — both report success while doing nothing they promised —
   and the second is at least visible afterwards. Skipping stays available only
   as `SKIP_DB_TESTS=1`, which is a sentence someone has to type.
2. **That database is a separate one, `monsterpaws_test`**, on the same dev
   server, created and migrated by `npm run db:up`. Same server keeps the
   round trip cheap; a separate database is what makes the truncate safe.
   `TEST_DATABASE_URL` defaults to it, so the ordinary machine needs no
   environment at all and the failure mode above is reserved for a database
   that is genuinely missing rather than merely unconfigured.
3. **The truncate helper refuses a database whose name does not end `_test`.**
   The name check is redundant with decision 1 and exists anyway: it fails at
   the point of temptation, loudly, in the one place every suite passes
   through, and it survives someone reintroducing a fallback later.
4. **A corpus worth keeping gets a copy the same day it exists.**
   `npm run db:dump` writes a gzipped `pg_dump` of the dev database to
   `var/dumps/`, and a full poll is followed by one. Isolation stops the test
   suite from deleting the corpus; it does nothing about the dozen other ways
   a single copy dies. The R2 dump in `doc/infra.md` remains the real answer
   and remains blocked on Managed Postgres — this is the local stand-in, not a
   substitute.

## Consequences

- `npm test` now requires a running Postgres. That is the intended trade: 42
  of 172 tests were skipping silently before this ADR, and a machine that
  cannot run them should say so rather than print a green 130. `SKIP_DB_TESTS=1`
  is the documented way out, and it prints what it is skipping.
- The dev database keeps its corpus across test runs, so a poll's output is
  finally durable enough to develop against — which is what makes browse
  pages testable by hand at all.
- Two databases now need migrating. `db:up` handles both; a hand-run
  `db:migrate` against one is a way to see a stale-schema failure in the other.
- `var/dumps/` is gitignored. A dump is a copy of the corpus, not a source of
  truth, and never a thing to restore blindly over a newer database.

## Alternatives

- **Roll each test back in a transaction instead of truncating.** Clean in
  principle and wrong here: stage 4 runs its merge, its events and its display
  upsert in one transaction, and that transaction is the thing under test.
  Wrapping it in an outer one tests savepoint semantics instead.
- **Guard by row count** — refuse to truncate a table holding more rows than a
  test could have created. Fuzzy, and it fails open in exactly the wrong
  moment: right after a wipe, when the corpus is empty and looks like a test
  database.
- **A throwaway container per run** (testcontainers or equivalent). The
  strongest isolation, at a container start per run against a nine-second
  suite. Throwaway databases are already cheap without it — the ADR-0015
  index EXPLAIN used one — so this is a revisit, not a v1.
- **Keep one database and be careful.** This is the status quo, and it is what
  lost the corpus.

## Revisit triggers

- CI runs the DB-backed suites — it must provision Postgres, and it must not
  learn to set `SKIP_DB_TESTS` to go green.
- A suite needs a corpus-sized fixture — truncate-per-test stops being viable
  at 64k rows, and a template database becomes the shape to reach for.
- Managed Postgres lands — check that a shared `.env` has not quietly
  re-flattened dev and test onto one connection string.
- Scraped observations enter the corpus (item 5) — they are not re-fetchable,
  so the local dump stops being a nicety and the R2 copy stops being deferred.

## Amendment (2026-09-28): CI provisions Postgres as a service container

The first revisit trigger fired on the first push after this ADR shipped and
went unanswered for 24 days. Decision 1 made an unreachable database a failure, `ci.yml` had
no database, and every push from 2026-09-04 to 2026-09-28 — five runs — went
red at `npm test` with `ECONNREFUSED :5432`. The `images` job needs `verify`,
so no deployable image was built in that time either. The suite did exactly
what it was told to; nobody was reading the result.

### 1. A service container, the same image as dev

The `verify` job declares a `postgres` service: `pgvector/pgvector:pg16`, the
`monsterpaws` user, password and database, port 5432, gated on `pg_isready`.
These are `docker-compose.dev.yml`'s values on purpose — `TEST_DATABASE_URL`
then resolves by its default, so CI sets no database environment at all and
runs the same `global-setup.ts` path a laptop does: create `monsterpaws_test`,
run the shipped migrations, test. Verified 2026-09-28 against a brand-new
server: 10 migrations applied from zero, 223 of 223 tests green, twice.

### 2. CI never sets `SKIP_DB_TESTS`

The trigger's second half, restated as a rule. A CI that skips the Postgres
suites is the silent green this ADR exists to remove, relocated to the one
place nobody would think to look.

### 3. The production-build e2e still runs with no database

`npm start` in CI gets no `DATABASE_URL`. The one spec today is the landing
page, which needs none; `/animals` answers 500 there. Which database the e2e
server reads, and what seeds it, belongs to the `animal-pages-e2e` slice
(ADR-0015 build plan) — it is pinned there as a carry-in, not decided here.

### Consequences (added)

- The image and credentials now live in two files. A change to one without
  the other breaks CI loudly, which is the acceptable direction to fail in.
- A red CI blocks deploys by construction (ADR-0007 as amended), so a failing
  run is an ops event, not a badge colour. Nothing reports one today except
  the badge and `gh run list`; ADR-0010's alerting does not cover CI.

### Alternatives (added)

- **`SKIP_DB_TESTS=1` in CI.** Rejected by the trigger itself.
- **`docker compose -f docker-compose.dev.yml up -d` as a step.** One source
  of truth for the image, at the cost of a hand-rolled readiness loop and a
  named volume CI has no use for. The service block gets the health gate from
  the platform.
- **testcontainers.** Still the revisit it was above; a service container is
  the same isolation for a job that is already a throwaway machine.

### Revisit triggers (added)

- The e2e suite needs animals → the e2e server gets its own seeded database,
  never `monsterpaws_test`, which the unit suites truncate.
- Managed Postgres lands on a different major version than 16 → dev, CI and
  production move together.
