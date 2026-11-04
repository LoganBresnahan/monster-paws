# 0021: Remove Logan's test gifts, and close `/test-gift`

Status: run
Planned: 2026-11-04 · Run: 2026-11-04, 04:30 to 04:31 UTC
Why: ADR-0027 as amended 2026-11-02: a gift with no animal doesn't belong in the totals, and its rows go before Spencer's button opens, found only by `animal_external_id = 'test-gift'` and never by slug or EIN, which Spencer's real gifts will share. Logan, directly, 2026-11-04: "yes clean up test donations". His earlier word on the totals, 2026-11-02: "yes delete the test stats rows". Roadmap: Accounts and donating (item 4)

What changes: production's rows below, deleted in one transaction; `EVERYORG_TEST_PAGE_SECRET` out of the droplet's `.env`, and app and worker recreated to read that, so the page answers 404. Its code goes in oplog 0029's image.

What this opens: nothing. **The bank gift:** submitted 14:30 UTC on 2026-11-03, it had no webhook at oplog 0023's read, about 9 h 54 min on, or at this entry's read, about 14 h on. If one arrives after this, it lands as `no_intent`, its raw row still holding `netAmount`, and no donation is recorded. Logan gave this word knowing that. Every.org's own records and his receipts are untouched.

Who does what: **Logan gave the word above, to the session running this.** Production steps run in one SSH session per step (the droplet's ufw `LIMIT` on 22/tcp).

## Prerequisites
- [x] Read 2026-11-04 04:29 UTC, counts only: 4 intents, all `test-gift` and all `source = manual`, 2 of them closed; 2 donations, both theirs; 2 `donation_stats` rows, both theirs; 5 payloads, ids 1, 2, 35, 36 and 37, of which 2 name these intents; 5 decisions; 0 `sign_in_links` on them; 0 keepsakes.
- [x] The three payloads that stay are oplog 0019's proof and oplog 0023's two proofs: no `partner_donation_id` on a `test-gift` intent, no donor in them.
- [x] `pass` unlocked by Logan.
- [x] Not within an hour of 06:00, 07:00 or 08:30 UTC.
- [x] The moderator told first.

## Steps

### 1. Delete in one transaction, which aborts unless the counts are exactly these
Decisions before payloads, donations before both, intents last, because of the foreign keys. If a delivery arrives first, the counts differ and nothing changes: read again and amend this entry.

    IP=$(DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token | head -n1) doctl compute droplet get monsterpaws --format PublicIPv4 --no-header)
    ssh root@$IP 'cd monsterpaws && docker run -i --rm --env-file .env -v "$PWD/do-ca.crt:/ca.crt:ro" -e PGSSLROOTCERT=/ca.crt postgres:16-alpine sh -c "psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -At -F \" \""' <<'SQL'
    BEGIN;
    CREATE TEMP TABLE gone_intents ON COMMIT DROP AS SELECT id FROM donation_intents WHERE animal_external_id = 'test-gift';
    CREATE TEMP TABLE gone_payloads ON COMMIT DROP AS SELECT id FROM everyorg_webhook_payloads WHERE partner_donation_id IN (SELECT id FROM gone_intents);
    DELETE FROM donations WHERE intent_id IN (SELECT id FROM gone_intents);
    DELETE FROM everyorg_webhook_decisions WHERE payload_id IN (SELECT id FROM gone_payloads);
    DELETE FROM everyorg_webhook_payloads WHERE id IN (SELECT id FROM gone_payloads);
    DELETE FROM donation_stats WHERE animal_external_id = 'test-gift';
    DELETE FROM donation_intents WHERE id IN (SELECT id FROM gone_intents);
    DO $$
    DECLARE n bigint[];
    BEGIN
      n := ARRAY[(SELECT count(*) FROM gone_intents), (SELECT count(*) FROM gone_payloads),
                 (SELECT count(*) FROM donation_intents), (SELECT count(*) FROM donations), (SELECT count(*) FROM donation_stats),
                 (SELECT count(*) FROM everyorg_webhook_payloads), (SELECT count(*) FROM everyorg_webhook_decisions)];
      IF n <> ARRAY[4,2,0,0,0,3,3]::bigint[] THEN RAISE EXCEPTION 'counts differ: %', n; END IF;
    END $$;
    COMMIT;
    SELECT 'intents', count(*) FROM donation_intents;
    SELECT 'donations', count(*) FROM donations;
    SELECT 'stats', count(*) FROM donation_stats;
    SELECT 'payloads', string_agg(id::text, ',' ORDER BY id) FROM everyorg_webhook_payloads;
    SELECT 'decisions', count(*) FROM everyorg_webhook_decisions;
    SQL
Verify: `COMMIT`; `intents 0`, `donations 0`, `stats 0`, `payloads 1,<two ids>`, three ids left, `decisions 3`.
Stop if: `counts differ`. The transaction rolled back.
Rollback: none once committed. A managed database's point-in-time restore is the only way back, and nothing here is worth one.

### 2. Close the page
The secret is read and used on the droplet, and never printed. `up -d` recreates app and worker, because `env_file` is read at creation, and Caddy holds requests through it.

    ssh root@$IP 'cd monsterpaws && S=$(grep ^EVERYORG_TEST_PAGE_SECRET= .env | cut -d= -f2-) &&
      cp .env .env.before-0021 && chmod 600 .env.before-0021 && sed -i "/^EVERYORG_TEST_PAGE_SECRET=/d" .env && grep -c "^EVERYORG_TEST_PAGE_SECRET=" .env;
      time docker compose -f docker-compose.prod.yml up -d app worker 2>&1 | tail -2 | cut -c1-70; sleep 15;
      printf "url = \"https://monsterpaws.org/test-gift/%s\"\n" "$S" | curl -s -o /dev/null -w "test-gift %{http_code}\n" -K -; unset S; rm -f .env.before-0021;
      docker compose -f docker-compose.prod.yml ps --format "{{.Service}} {{.Status}}" </dev/null'
    curl -fsS https://monsterpaws.org/api/health
Verify: the key counts `0`; `test-gift 404`; both containers up; health 200 on the same sha.
Rollback: the secret is in `pass` as before, if it's wanted back: add its line and `up -d app worker`.

## Run
**Step 1, 04:30 UTC.** `BEGIN`, 4 intents and 2 payloads selected, `DELETE` 2 donations, 2 decisions, 2 payloads, 2 stats and 4 intents, the guard passed, `COMMIT`. After: `intents 0`, `donations 0`, `stats 0`, payloads 1, 36 and 37, none naming an intent, and their decisions `before_this_table`, `unparsable` and `unparsable`.

**Step 2, 04:31 UTC.** The key counts `0`. `up -d app worker` took 1.94 s, with no POST loop this time, and Caddy's hold was measured in oplogs 0023 and 0025. `test-gift 404` with the real secret. Both containers up; health 200 on `0989a18`. `.env.before-0021` removed, since it held the secret.

**The bank gift** still had no webhook when this ran: not among the payloads read at 04:29 UTC. Nothing failed, and nothing was rolled back.

## Follow-ups
- `/test-gift`'s code leaves in oplog 0029's image, and `doc/plans/adr-0027-accounts-build-plan.md`'s carry-in closes with it.
- `EVERYORG_TEST_PAGE_SECRET` leaves `doc/infra.md`'s registry and `pass` with that code.
