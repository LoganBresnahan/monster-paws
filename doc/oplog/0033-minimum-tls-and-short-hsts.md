# 0033: Cloudflare's minimum TLS to 1.2, and a one-day HSTS

Status: planned
Planned: 2026-11-05 · Run: —
Why: ADR-0007 (Cloudflare in front of Caddy, Full (strict)); Cloudflare's Security Insights, read with Logan; `doc/issues.md`, Ops. Logan: "yes write to issues and oplog wherever these things go"
Commit deployed: n/a — the droplet, the database and the buckets do not change

What is known, read 2026-11-05 UTC. For the zone, `min_tls_version` is `1.0`,
`security_header` is disabled with `max_age` 0, `always_use_https` is `off` and `ssl` is
`strict`. `https://monsterpaws.org/` answers `200` when curl is held to TLS 1.0, and again
when held to 1.1. No host sends `Strict-Transport-Security`.

Who does what: the moderator runs this on Logan's own "go 0033", with `cloudflare/dns-token`.
Logan makes step 5's donation if he chooses to. A 403 on a write stops the entry: Logan can
then make the change in the dashboard, or leave it.

Left out on purpose:
- **Always Use HTTPS for the zone.** `doc/issues.md`, Ops, has the reason. It could get in
  the way of Caddy renewing the origin's certificate, and the main site and `www` already
  redirect.
- **Bot Fight Mode.** It stays off (oplog 0018): it challenged Every.org's webhook.
- **AI Labyrinth.** It stays off (`doc/infra.md`, a deliberate setting).
- **`links.monsterpaws.org` unproxied.** This is Resend's record.
- **`security.txt`.** Ours is already served from `public/.well-known/`.
- **HSTS for subdomains, preload, and `nosniff`.** Each is a larger or separate change.

## Prerequisites
- [ ] Logan's "go 0033", to the session running it.
- [ ] Outside the quiet window: not from 06:45 UTC until that night's `var/nightly/<date>.log`
      shows `== exit`, and not during the 08:30 UTC backup. No roll in progress.
- [ ] `pass` unlocked.
- [ ] The baseline: monitors 4995720 and 4995794 `up`, not paused; `/`, `/animals` and
      `/api/health` answer `200`.

      U=$(pass show betterstack/uptime-token)
      for m in 4995720 4995794; do
        curl -s -H "Authorization: Bearer $U" "https://uptime.betterstack.com/api/v2/monitors/$m" \
          | jq -c --arg m "$m" '{monitor:$m, status:.data.attributes.status, paused:.data.attributes.paused}'
      done
      for p in / /animals /api/health; do
        curl -s -o /dev/null -w "GET https://monsterpaws.org$p %{http_code}\n" "https://monsterpaws.org$p"
      done

## Steps

Each step that touches a setting starts with these lines. Only the filtered fields are
printed, because a refusal's message names the zone's and the token's IDs.

    T=$(pass show cloudflare/dns-token | head -n1)
    Z=$(curl -s -H "Authorization: Bearer $T" "https://api.cloudflare.com/client/v4/zones?name=monsterpaws.org" | jq -r '.result[0].id')
    show() { jq -c '{ok:.success, errors:[.errors[]?.code], value:.result.value}'; }
    get() { curl -s -H "Authorization: Bearer $T" "https://api.cloudflare.com/client/v4/zones/$Z/settings/$1" | show; }
    put() { curl -s -X PATCH -H "Authorization: Bearer $T" -H 'Content-Type: application/json' "https://api.cloudflare.com/client/v4/zones/$Z/settings/$1" -d "$2" | show; }

### 1. Read the settings as they are now

    for s in min_tls_version security_header always_use_https ssl; do get $s; done

Verify: `1.0`, HSTS disabled with `max_age` 0, `off`, `strict`.
Stop if: any differs. Someone changed it, so find out who before going on.
Rollback: nothing changed.

### 2. Minimum TLS to 1.2

    put min_tls_version '{"value":"1.2"}'

Give it a minute, then read it from outside. The `--ciphers` is what lets this machine's curl
offer the old versions at all.

    for v in 1.0 1.1 1.2 1.3; do printf 'tls %s: ' $v; curl -s --max-time 8 -o /dev/null -w '%{http_code}\n' --tlsv$v --tls-max $v --ciphers 'DEFAULT@SECLEVEL=0' https://monsterpaws.org/; done
    curl -s -o /dev/null -w 'media %{http_code}\n' https://media.monsterpaws.org/
    curl -s -o /dev/null -w 'hook %{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' https://monsterpaws.org/api/webhooks/everyorg/wrong

Verify: TLS 1.0 and 1.1 `000`; TLS 1.2 and 1.3 `200`; `media 404` as before; `hook 404`, the
answer every deploy's roll has read on this path.
Stop if: anything other than the old versions fails.
Rollback: `put min_tls_version '{"value":"1.0"}'`.

### 3. HSTS for one day, on the named hosts only

One day because browsers remember the header: if HTTPS broke, a visitor who had seen it would
be refused until it ran out. No `includeSubDomains`, because `links.` isn't proxied.

    put security_header '{"value":{"strict_transport_security":{"enabled":true,"max_age":86400,"include_subdomains":false,"preload":false,"nosniff":false}}}'

Then read each host:

    for h in monsterpaws.org www.monsterpaws.org media.monsterpaws.org; do printf '%s: ' $h; curl -s -o /dev/null -D - https://$h/ | tr -d '\r' | grep -i '^strict-transport-security' || echo none; done

Verify: `max-age=86400` on each, with no `includeSubDomains` and no `preload`. If `media` shows
`none`, the Run records it: that isn't a reason to stop, and `doc/issues.md`'s entry on that
host is corrected.
Stop if: the main site's pages fail, or the header carries more than was asked for.
Rollback: send `max_age` 0 with `enabled` true, so a browser forgets on its next visit, and
turn it off after a day. A browser that doesn't come back forgets within the day:

    put security_header '{"value":{"strict_transport_security":{"enabled":true,"max_age":0,"include_subdomains":false,"preload":false,"nosniff":false}}}'

### 4. The site is unchanged

The prerequisite's reads again, and the error reports:

    node scripts/error-report-counts.mjs now-1h now

Verify: both monitors `up`; `/`, `/animals` and `/api/health` `200`; no new report since step 2.
Stop if: a monitor is down, or a new report names a TLS or webhook failure. Roll back steps 3
and 2.
Rollback: steps 3 and 2.

### 5. A real delivery, Logan's call

Every.org's client was `node` on Amazon's network when oplog 0018 saw it, which should manage
TLS 1.2, but nothing but a delivery proves it. A refused delivery is silent: it would leave a
donor's intent with no donation, and nothing alerts on that. So Logan may make one small
donation through the site. Read before and after, in one SSH session each:

    IP=$(DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token | head -n1) doctl compute droplet get monsterpaws --format PublicIPv4 --no-header)
    ssh root@$IP 'cd monsterpaws && docker run -i --rm --env-file .env -v "$PWD/do-ca.crt:/ca.crt:ro" -e PGSSLROOTCERT=/ca.crt postgres:16-alpine sh -c "psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -At -F \" \""' <<'SQL'
    BEGIN READ ONLY;
    SELECT 'recorded', count(*) FROM everyorg_webhook_decisions WHERE outcome = 'recorded';
    SELECT 'delivered', count(*) FROM resend_webhook_events WHERE event_type = 'email.delivered';
    SELECT 'open intents', count(*) FROM donation_intents WHERE closed_at IS NULL;
    ROLLBACK;
    SQL

Verify: `recorded` and `delivered` each up by one, `open intents` back to what it was.
Stop if: the donation shows at Every.org and `recorded` doesn't move. Roll back step 2, and read
the webhook's state with Logan.
Rollback: a real donation isn't undone. If he skips this, the Run says so, and the follow-up
reads the next real donor's.

### 6. The runbook

`doc/infra.md`'s Cloudflare settings note gains both values, in the commit that fills in this
Run. `doc/issues.md`'s entry and the roadmap's line for this go in that commit too.

Verify: `git show --stat` names all of them.
Rollback: not applicable.

## Run

(Filled in while running.)

## Follow-ups
- A week on with no trouble, a new entry raises HSTS's `max_age`. `includeSubDomains` stays off
  while `links.` isn't proxied, and `preload` is a separate decision that is hard to undo.
- If step 5 was skipped, read the next real donor's delivery against step 5's query.
