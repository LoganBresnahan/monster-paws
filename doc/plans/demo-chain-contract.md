# The painting chain's contract: keepsake, job, art

From a recorded gift to an email: a crew pet on the dev box, or a listing whose shelter holds a `digify` grant. It lands on
topdog and stays dark: the sweep starts only with `ART_SWEEP=on`, a line in that machine's `.env` with its own oplog entry, and
`SHELTERS` holds no grant. Only a recorded gift paints, so a bank donor waits for the webhook until slice C ships. Deadline:
2026-11-04 21:00 UTC.

## Database

`monsterpaws_demo` on the dev Postgres, holding only the crew (ADR-0028 §4 and §6). `npm run demo -- seed` creates,
migrates and fills it, and refuses any other database. Never the shared `monsterpaws`: the staging gate skips the grant,
and that database holds listings. A real staging gift needs Logan's pick of nonprofit, by
`npm run demo -- seed --slug <s> --ein <e> --name <n>`.

`npm run demo -- gift <pet> <email>` records a gift through the real decision with no Every.org in it, for rehearsals,
since only Logan can run a staging one. Use an address of ours: it gets real mail once the mail runs.

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

`keepsake_fact` rows, all on one basis: `CREW_BASIS` for a crew pet, `grantBasis(slug)` for a listing. `FACT` in
`src/core/keepsake.ts` names the fields. The handler reads these and never `animals` or `animal_display` (ADR-0022 §1). A
field a listing doesn't publish has no row.

| field | value |
| --- | --- |
| `name`, `species`, `kind`, `age`, `sex` | a string, from `src/ui/crew.ts` or the listing. A listing's name is as published and can carry notes such as "Adopt Me!" |
| `shelter` | a listing's shelter name, for the card's credit (ADR-0006 decision 5); a crew pet has none |
| `source_photo` | crew only, `{ pet: "plum", photo: null }`: `photo` null leaves the choice to the painter's crop table, which reads the originals in `var/crew/`. It names a pet and holds no photo |

A listing's photos are never a fact: under a grant a keepsake holds no photo (ADR-0022 as amended 2026-10-27). They arrive in the job.

## The job

`src/core/keepsake.ts`. Import these and don't restate them.

- Queue `ART_GENERATE` (`art.generate`), created with `ART_QUEUE_OPTIONS` on both sides, since `send` throws on a missing queue.
- Data `{ keepsakeId, photos? }`. `photos` is a listing's licensed photos, read at each send, and a crew pet has none. Fetch them at paint time on the home box and delete your copies when the set is done (ADR-0022 as amended 2026-11-02).
- The sweep sends with `artJobOptions`, a key plus a one-hour slot, and sends again each hour while no art exists. A gift past 30 minutes with no art raises an alert once an hour.
- On production the sweep creates the queue, and `home_worker` may not, so a worker under that role only calls `work` (oplog 0027). Cap its pool and pg-boss's, since the cluster is a `db-s-1vcpu-1gb`.
- The handler exits at once if any `art` fact exists, and runs one job at a time. A slot boundary can queue a second job, which then finds the art.
- If a cycle can outlast `ART_QUEUE_OPTIONS.expireInSeconds`, change it there.

## Art

Four `keepsake_fact` rows with `field = 'art'`, written in one transaction on `CREW_BASIS`, each
`{ key: artKey(keepsakeId, candidate), candidate }` with `candidate` 1 to 4 in generation order. Owed means no art
fact, so a part-written set would never be finished. Files live at `artFilePath(key)`, under `ART_STORE_DIR`, which is
absolute and shared across worktrees. The share page's published copy is `paintings`' (oplog 0026), under the token.
On production the droplet sends the mail and can't read a file at home, so a real gift's art must reach `media.monsterpaws.org`
under the token before the mail can use it.

## The email

A keepsake with four `art` facts and no row in `emails`' sent table (migration 0019) is ready to send. The sent
record isn't a `keepsake_fact`, because those are deleted by basis. The address is `donation_intents.donor_email`,
through `keepsake.intent_id`. No amount goes in the mail, and it doesn't say money arrived (ADR-0035 decision 10).

## Running it

    DATABASE_URL=<dev postgres>/monsterpaws_demo
    ART_STORE_DIR=$HOME/monsterpaws/var/keepsakes   # the main checkout's var/, which every worktree can reach
    ART_SWEEP=on                  # the sweep's worker only

Leave `RESCUEGROUPS_API_KEY` unset in any worker pointed here, or `npm run worker` registers `ingest.poll`.
`art.generate` needs an art-only worker mode, which `paintings` owns. Guard batches stop from 06:45 UTC until the
main checkout's poll log says `== exit`.

## Cut for now, and owed

Slice C's return signal and ADR-0035's limits, which count only unconfirmed gifts. The photo hold on the droplet: the photos are
fetched at paint time at home instead. Oplog 0021 stays due, and the sweep can't reach `test-gift`, which has no animal. ADR-0022's
"no public paintings" stands until Logan decides on real paintings on share pages. The art worker's own distro and Windows account
(ADR-0004 as amended 2026-10-05) need his word to skip.
