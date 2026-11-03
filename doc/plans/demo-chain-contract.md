# The demo chain's contract: keepsake, job, art

The local chain for the Meta demo: a crew pet, a staging gift, a painting on the home card, an email.
It lands on topdog and runs only on the dev box: the sweep starts only with `ART_SWEEP=on`, which the droplet's
compose never sets, and it reaches only the crew. Deadline: 2026-11-04 21:00 UTC.

## Database

`monsterpaws_demo` on the dev Postgres, holding only the crew (ADR-0028 §4 and §6). `npm run demo:seed`
creates, migrates and fills it. Never the shared `monsterpaws`: the staging gate skips the grant, and that
database holds listings.

## Keepsake

`src/db/schema.ts`, migration 0017:

| column | meaning |
| --- | --- |
| `keepsake.id` | the job's `keepsakeId` |
| `keepsake.intent_id` | `NOT NULL UNIQUE`; the address and the donation are reached through it |
| `keepsake.share_token` | 128 bits, base64url, 22 characters; read it from the row |
| `keepsake.snapshotted_at` | when the sweep wrote it |

`donation_id` is gone. Read the donation through `donations.intent_id`.

## Facts the handler reads

`keepsake_fact` rows, each on `CREW_BASIS`. `FACT` in `src/core/keepsake.ts` names the fields. The handler
reads these and never `animals` or `animal_display` (ADR-0022 §1).

| field | value |
| --- | --- |
| `name`, `species`, `kind`, `age` | a string, from `src/ui/crew.ts` |
| `sex` | `female` or `male` |
| `source_photo` | `{ pet: "plum", photo: null }`: `photo` null leaves the choice to the painter's crop table, which reads the originals in `var/crew/` |

## The job

`src/core/keepsake.ts`. Import these and don't restate them.

- Queue `ART_GENERATE` (`art.generate`), created with `ART_QUEUE_OPTIONS` on both sides, since `send` throws on a missing queue.
- Data `{ keepsakeId }`. The sweep sends with `artJobOptions`, a key plus a one-hour slot, and sends again each hour while no art exists.
- The handler exits at once if any `art` fact exists, and runs one job at a time. A slot boundary can queue a second job, which then finds the art.
- If a cycle can outlast `ART_QUEUE_OPTIONS.expireInSeconds`, change it there.

## Art

Four `keepsake_fact` rows with `field = 'art'`, written in one transaction on `CREW_BASIS`, each
`{ key: artKey(keepsakeId, candidate), candidate }` with `candidate` 1 to 4 in generation order. Owed means no art
fact, so a part-written set would never be finished. Files live at `artFilePath(key)`, under `ART_STORE_DIR`, which is
absolute and shared across worktrees. The share page's published copy is `paintings`' (oplog 0026), under the token.

## The email

A keepsake with four `art` facts and no row in `emails`' sent table (migration 0019) is ready to send. The sent
record isn't a `keepsake_fact`, because those are deleted by basis. The address is `donation_intents.donor_email`,
through `keepsake.intent_id`. No amount goes in the mail, and it doesn't say money arrived (ADR-0035 decision 10).

## Running it

    DATABASE_URL=<dev postgres>/monsterpaws_demo
    ART_STORE_DIR=/home/oof/monsterpaws-demo/var/keepsakes
    ART_SWEEP=on                  # the sweep's worker only

Leave `RESCUEGROUPS_API_KEY` unset in any worker pointed here, or `npm run worker` registers `ingest.poll`.
`art.generate` needs an art-only worker mode, which `paintings` owns. Guard batches stop from 06:45 UTC until the
main checkout's poll log says `== exit`.

## Cut, and owed before any real donor

Slice C's return signal and ADR-0035's limits; the photo hold; oplog 0021; the sweep's reach past the crew; `paintings`
and `emails` on the droplet's and home's real paths. ADR-0022's "no public paintings" stands for everything but the
crew until Logan decides what a withdrawal does to a shared painting.
