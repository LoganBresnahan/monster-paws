# 0027: The art worker's way in — the `home_worker` role and a restricted tunnel key

Status: planned
Planned: 2026-11-04 · Run: —
Why: a real gift's painting runs on the home card, and its job and facts live in production's Postgres (ADR-0004 as amended
2026-10-05, `doc/flows.md`, Keepsake art). Logan, to the moderator, 2026-11-03: "i want real donations working". Roadmap: Accounts and
donating (item 4)

What changes: a new Postgres role, `home_worker`, with its grants; one new line in the droplet's `/root/.ssh/authorized_keys`; two
new `pass` entries, `digitalocean/droplet-tunnel-key` and `digitalocean/pg-home-worker-url`. No image, compose file, `.env`, DNS or
table changes, and nothing restarts.

What this opens: a database login reachable only through that key. No job runs under it until `paintings` starts the worker, and
the sweep sends none until oplog 0028, with `SHELTERS` empty until oplog 0029. It can read and change pg-boss's whole schema, read
`keepsake`'s id, share token and time, and read and add `keepsake_fact` rows. It can't read an address, a donation, a webhook
payload or an intent id: `scripts/home-worker-grants.sql` is the list.

Who does what: **Logan gives the word for step 1, in the session that runs it.** Production steps run in one SSH session per step
(the droplet's ufw `LIMIT` on 22/tcp).

## Prerequisites
- [ ] Logan's word to run the worker on the dev distro for now, and not the separate distro and Windows account of ADR-0004 as amended
      2026-10-05, recorded as an amendment there first. Its keys live beside dev's on this box, so they're made for this role alone and
      rolled when the real home distro exists.
- [ ] Oplog 0025 has run: the grants name `keepsake.share_token`, which migration 0017 adds. Read back in step 1.
- [ ] `pass` unlocked by Logan.
- [ ] Not within an hour of 06:00, 07:00 or 08:30 UTC, and nothing in the main checkout from 06:45 UTC until that night's log shows `== exit`.
- [x] The grants rehearsed on a scratch database, 2026-11-04 00:10 UTC, then dropped, with pg-boss 12.26.3 and the grants applied before the
      queue existed, as they will be here. The owner made the queue and sent a job; under the scoped role a worker with `migrate`, `supervise` and
      `schedule` off and `max: 2` started, took the job, read the token and the facts, wrote an art fact and completed it, with no error. Refused
      with 42501: `donor_email`, `keepsake.intent_id`, `donations`, `everyorg_webhook_payloads`, `animals`, `email_suppressions`, a keepsake
      insert, a fact update or delete, a new table, and dropping `pgboss.job`.
- [x] The key line proved on a throwaway OpenSSH 9.6p1, 2026-11-04 00:12 UTC, the build oplog 0009 proved its line on. The line `doc/infra.md` had
      planned, `restrict,port-forwarding,permitopen=…`, **ran a command as root and copied a file out by scp**, because `restrict` doesn't stop a
      command and `-R` stayed open. This entry's line, with a forced command and a closed listen port: no command ran, scp copied nothing, `-R` was
      refused, a forward to port 22 got no banner, and the forward to the database answered.

## Steps

### 1. Record what's there — this is the rollback
    IP=$(DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token | head -n1) doctl compute droplet get monsterpaws --format PublicIPv4 --no-header)
    DB_ID=$(DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token | head -n1) doctl databases list --format ID,Name --no-header | awk '$2=="monsterpaws-pg"{print $1}')
    DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token | head -n1) doctl databases user list "$DB_ID" --format Name --no-header
    ssh root@$IP 'cd monsterpaws && ssh -V 2>&1 | cut -c1-20; wc -l < ~/.ssh/authorized_keys; grep -c monsterpaws-home-worker ~/.ssh/authorized_keys;
      docker run --rm -i --env-file .env -v "$PWD/do-ca.crt:/ca.crt:ro" -e PGSSLROOTCERT=/ca.crt postgres:16-alpine sh -c "psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -At -F \" \""' <<'SQL'
    SELECT current_user;
    SELECT tableowner FROM pg_tables WHERE schemaname = 'pgboss' AND tablename = 'job';
    SELECT column_name FROM information_schema.columns WHERE table_name = 'keepsake' ORDER BY 1;
    SELECT count(*) FROM keepsake;
    SQL
Verify: OpenSSH 9.6, what the line was proved on; no `home_worker` user; 0 `monsterpaws-home-worker` lines, and the line count recorded; `current_user` and `pgboss.job`'s owner are the same role, since
`ALTER DEFAULT PRIVILEGES` reaches only tables that role creates; `keepsake` has `share_token`.
Stop if: the owner differs, or `share_token` is absent: 0025 hasn't run.
Rollback: n/a — a read.

### 2. Make the key
    ssh-keygen -q -t ed25519 -N '' -C monsterpaws-home-worker -f ~/.ssh/monsterpaws-home-worker
    pass insert -m digitalocean/droplet-tunnel-key < ~/.ssh/monsterpaws-home-worker
Verify: `pass show digitalocean/droplet-tunnel-key | head -1` reads as an OpenSSH private key header, and the file is mode 600.
Rollback: `rm ~/.ssh/monsterpaws-home-worker*; pass rm -f digitalocean/droplet-tunnel-key`.

### 3. Add its line, one SSH session
Never drop `command=` or `permitlisten=`: the proof above shows what this key does without them. The hostname stays in that file and is never printed.

    URL=$(pass show digitalocean/database-url | head -n1); HP=${URL#*@}; HP=${HP%%/*}
    LINE="restrict,port-forwarding,permitlisten=\"127.0.0.1:9\",permitopen=\"$HP\",command=\"/bin/false\" $(cat ~/.ssh/monsterpaws-home-worker.pub)"
    printf '%s\n' "$LINE" | ssh root@$IP 'cp ~/.ssh/authorized_keys ~/.ssh/authorized_keys.before-0027 && cat >> ~/.ssh/authorized_keys &&
      wc -l < ~/.ssh/authorized_keys; grep -c monsterpaws-home-worker ~/.ssh/authorized_keys'
Verify: the line count is one more than step 1's; 1 `monsterpaws-home-worker` line.
Rollback: `ssh root@$IP 'cp ~/.ssh/authorized_keys.before-0027 ~/.ssh/authorized_keys'`.

### 4. Prove the key on the droplet, 8 s apart
    K="-i $HOME/.ssh/monsterpaws-home-worker -o BatchMode=yes -o IdentitiesOnly=yes -n"
    echo "command: [$(ssh $K root@$IP 'echo RAN' 2>&1 | head -1 | cut -c1-40)]"; sleep 8
    scp -i ~/.ssh/monsterpaws-home-worker -o BatchMode=yes -o IdentitiesOnly=yes root@$IP:/etc/hostname /tmp/0027-got 2>&1 | head -1 | cut -c1-40; ls /tmp/0027-got 2>/dev/null || echo "nothing copied"; sleep 8
    timeout 6 ssh $K -N -o ExitOnForwardFailure=yes -R 127.0.0.1:18080:127.0.0.1:22 root@$IP 2>&1 | head -1 | cut -c1-70
Verify: `command: []` with no `RAN`; nothing copied; the `-R` is refused. The root key still works: the next step uses it.
Stop if: `RAN` appears or a file copies. Run step 3's rollback before anything else.

### 5. The role, with its password straight into `pass`
    URL=$(pass show digitalocean/database-url | head -n1); HP=${URL#*@}; TAIL=${HP#*/}; HP=${HP%%/*}
    PW=$(DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token | head -n1) doctl databases user create "$DB_ID" home_worker --format Password --no-header)
    printf 'postgresql://home_worker:%s@%s/%s\n' "$PW" "$HP" "$TAIL" | pass insert -m digitalocean/pg-home-worker-url >/dev/null; unset PW
    ssh root@$IP 'cd monsterpaws && git log --oneline -1 && DB=$(grep ^DATABASE_URL= .env | cut -d= -f2- | sed -E "s#^.*/([^/?]+).*#\1#");
      docker run --rm -i --env-file .env -v "$PWD/do-ca.crt:/ca.crt:ro" -e PGSSLROOTCERT=/ca.crt postgres:16-alpine sh -c "psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -At -v role=home_worker -v db=$DB -f -"' < scripts/home-worker-grants.sql
Verify: `doctl databases user list` shows `home_worker`; 8 `GRANT` lines and 1 `ALTER DEFAULT PRIVILEGES`; `pass show digitalocean/pg-home-worker-url | grep -c home_worker` prints 1.
Rollback: `doctl databases user delete "$DB_ID" home_worker --force` after `DROP OWNED BY home_worker` as admin; `pass rm -f digitalocean/pg-home-worker-url`.

### 6. Prove the role from here, through the tunnel
This is the tunnel's first run, and TLS verifies the database's own name through it. Nothing is selected from a donor table that the role can read.

    scripts/home-worker-tunnel.sh & T=$!; sleep 4
    URL=$(pass show digitalocean/pg-home-worker-url | head -n1); HP=${URL#*@}; HP=${HP%%/*}; H=${HP%:*}
    ssh root@$IP 'cat monsterpaws/do-ca.crt' > /tmp/0027-ca.crt
    DATABASE_URL=$URL docker run --rm -i --network host --add-host "$H:127.0.0.1" -e DATABASE_URL -v /tmp/0027-ca.crt:/ca.crt:ro -e PGSSLROOTCERT=/ca.crt postgres:16-alpine \
      sh -c 'psql "$DATABASE_URL" -At -F " "' <<'SQL' 2>&1 | sed -E 's/^.*(permission denied).*$/\1/'
    SELECT current_user;
    SELECT count(*) FROM pgboss.queue;
    SELECT count(*) FROM keepsake_fact;
    SELECT id FROM keepsake LIMIT 1;
    SELECT count(donor_email) FROM donation_intents;
    SELECT intent_id FROM keepsake LIMIT 1;
    SELECT count(*) FROM donations;
    SELECT count(*) FROM everyorg_webhook_payloads;
    SELECT count(*) FROM email_suppressions;
    SELECT count(*) FROM animals;
    CREATE TABLE public.x (a int);
    UPDATE keepsake_fact SET value = '1' WHERE false;
    SQL
    kill "$T"; rm -f /tmp/0027-ca.crt /tmp/0027-got
Verify: `home_worker`; a number each for the queue and facts; the keepsake read returns; **`permission denied` for each of the next eight lines**. Tunnel down at the end: `pgrep -fc '[m]onsterpaws-home-worker'` prints 0. The brackets keep `pgrep` from finding its own shell.
Stop if: any donor table answers. Run step 5's rollback and tell Logan.
Rollback: step 5's, then step 3's.

## Run
<filled in as it happens>

## Follow-ups
- `doc/infra.md`'s Home worker registry and step 8: where the two entries actually live, and the exception.
- Oplog 0028: the sweep on, the mail, dark. `paintings`' worker runs under this role with `max` capped, `migrate`, `supervise` and `schedule` off, and calls only `work`.
- Roll both keys when the real home distro is built.
