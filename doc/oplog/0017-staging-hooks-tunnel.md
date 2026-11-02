# 0017: The staging webhook's tunnel: staging-hooks.monsterpaws.org to the dev server

Status: planned
Planned: 2026-11-02 · Run: —
Why: ADR-0027 as amended 2026-11-02; roadmap: Accounts and donating (item 4);
`doc/plans/adr-0027-accounts-build-plan.md`, `everyorg-webhook-endpoint`.
Every.org's staging webhook (made 2026-10-22, `doc/infra.md`) posts to a
hostname with no DNS record, so no staging delivery can land yet.
Commit deployed: n/a — the droplet, the database and the buckets do not change

What changes: one new tunnel on the Cloudflare account and one new proxied
CNAME in the live zone. No existing record is edited. `monsterpaws.org` and
`www` are not touched, and nothing opens a port at home (the tunnel is outbound
only). The hostname must never reach the droplet: a CNAME to the tunnel has no
address behind it, and Caddy has no site for this host.

Who does what: Logan makes the one credential this needs (the first
prerequisite), since Cloudflare has no API for minting a token from what `pass`
holds. Everything else runs from `~/monsterpaws-donate`. Every step is one shell
call that first defines:

    CF=$(pass show cloudflare/dns-token)
    T=$(pass show cloudflare/tunnel-token)
    API=https://api.cloudflare.com/client/v4
    ZONE=$(curl -s -H "Authorization: Bearer $CF" "$API/zones?name=monsterpaws.org" | jq -r '.result[0].id')
    ACCT=$(curl -s -H "Authorization: Bearer $CF" "$API/zones/$ZONE" | jq -r '.result.account.id')
    HOST=staging-hooks.monsterpaws.org

Nothing prints a token, the account ID, the zone ID or the tunnel's ID. All
four are filtered by `jq`, and the tunnel's secret goes straight into `pass`.

Read on 2026-11-02, before planning:
- `cloudflare/dns-token` lists tunnels but gets 403 creating one, a POST with no
  name, which changes nothing either way. It is the Zone token infra.md
  describes, so tunnel creation needs its own token.
- The same token gets 403 reading `bot_management` and 403 on GraphQL's firewall
  events, so **Bot Fight Mode's state and any event it logs can be read only in
  the dashboard**. See "The unproven part".
- The zone holds `monsterpaws.org` and `www` (A, proxied), `links` (CNAME, DNS
  only), and neither `staging-hooks` nor `hooks`.

## Prerequisites
- [ ] **Logan:** a new account-owned token at dash.cloudflare.com → Manage
      Account → Account API Tokens. Permission `Account · Cloudflare Tunnel ·
      Edit` (Cloudflare's API guide also lists it as `Cloudflare One Connector:
      cloudflared Write`, either one), this account only, no expiry, no IP filter
      (a home IP changes). Stored with `pass insert cloudflare/tunnel-token`.
- [ ] `pass` unlocked: `pass show cloudflare/tunnel-token >/dev/null` exits 0.
- [ ] The token works, at the account endpoint since it is account-owned:
      `curl -s -H "Authorization: Bearer $T" "$API/accounts/$ACCT/tokens/verify" | jq -r .result.status`
      prints `active`.
- [ ] The hostname is still free:
      `curl -s -H "Authorization: Bearer $CF" "$API/zones/$ZONE/dns_records?name=$HOST" | jq '.result | length'`
      prints `0`.
- [ ] No tunnel of that name:
      `curl -s -H "Authorization: Bearer $T" "$API/accounts/$ACCT/cfd_tunnel?name=staging-hooks&is_deleted=false" | jq '.result | length'`
      prints `0`.
- [ ] `tests/staging-hooks.test.ts` is green.
- [ ] The path secret fits the rule:
      `pass show everyorg/staging-webhook-secret | grep -cE '^[A-Za-z0-9]+$'`
      prints `1`.
- [ ] The pinned cloudflared itself sends only the webhook's shape to
      `127.0.0.1:3027`. Only the probe prints `Matched rule #0`; every other
      path prints `#1`, the catch-all:

      IMG=$(sed -nE 's/^IMAGE=//p' scripts/staging-hooks.sh)
      for p in /api/webhooks/everyorg/oplog0017probe / /api/health /design \
        '/api/webhooks/everyorg/../../../design' \
        '/api/webhooks/everyorg/%2e%2e/%2e%2e/%2e%2e/design' \
        '/api/webhooks/everyorg/x/../../../../api/health'; do
        printf '%s: ' "$p"
        docker run --rm -v "$PWD/scripts/staging-hooks.yml:/etc/cloudflared/config.yml:ro" "$IMG" \
          tunnel --config /etc/cloudflared/config.yml ingress rule "https://staging-hooks.monsterpaws.org$p" 2>&1 | grep -E '^Matched'
      done

## Steps

### 1. Create the tunnel, its secret straight into `pass`
A locally managed tunnel (`config_src: local`), so its ingress is
`scripts/staging-hooks.yml` in this repo, reviewable and tested, and not a
setting on the dashboard.

    SECRET=$(openssl rand -base64 32)
    R=$(jq -n --arg s "$SECRET" '{name:"staging-hooks", config_src:"local", tunnel_secret:$s}' \
      | curl -s -X POST -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d @- "$API/accounts/$ACCT/cfd_tunnel")
    jq -c '{success, errors:[.errors[]?.message], name:.result.name, config_src:.result.config_src}' <<<"$R"
    jq -c --arg s "$SECRET" '{AccountTag:.result.account_tag, TunnelID:.result.id, TunnelName:.result.name, TunnelSecret:$s}' <<<"$R" \
      | pass insert -m cloudflare/staging-hooks-tunnel-credentials >/dev/null

Verify: the printed line shows `success: true`, `name: staging-hooks`,
`config_src: local`; and
`pass show cloudflare/staging-hooks-tunnel-credentials | jq -c '{a:(.AccountTag|length), id:(.TunnelID|length), s:(.TunnelSecret|length), name:.TunnelName}'`
shows `a: 32, id: 36, s: 44, name: staging-hooks`.
Rollback: `ID=$(pass show cloudflare/staging-hooks-tunnel-credentials | jq -r .TunnelID); curl -s -X DELETE -H "Authorization: Bearer $T" "$API/accounts/$ACCT/cfd_tunnel/$ID" | jq -c '{success}'; pass rm -f cloudflare/staging-hooks-tunnel-credentials`

### 2. The proxied CNAME, the zone's only change

    ID=$(pass show cloudflare/staging-hooks-tunnel-credentials | jq -r .TunnelID)
    jq -n --arg c "$ID.cfargotunnel.com" \
      '{type:"CNAME", name:"staging-hooks", content:$c, proxied:true, ttl:1,
        comment:"Staging webhook tunnel to monsterpaws-dev, never the droplet (oplog 0017, ADR-0027)"}' \
      | curl -s -X POST -H "Authorization: Bearer $CF" -H 'Content-Type: application/json' -d @- "$API/zones/$ZONE/dns_records" \
      | jq -c '{success, errors:[.errors[]?.message], name:.result.name, type:.result.type, proxied:.result.proxied, tunnel:(.result.content|endswith(".cfargotunnel.com"))}'

Verify: `success: true`, `type: CNAME`, `proxied: true`, `tunnel: true`; and the
record list is the three names above plus this one, each of the three unchanged:
`curl -s -H "Authorization: Bearer $CF" "$API/zones/$ZONE/dns_records?per_page=100" | jq -r '.result[] | select(.type=="A" or .type=="CNAME") | "\(.type) \(.name) proxied=\(.proxied)"'`.
Rollback: `RID=$(curl -s -H "Authorization: Bearer $CF" "$API/zones/$ZONE/dns_records?name=$HOST" | jq -r '.result[0].id'); curl -s -X DELETE -H "Authorization: Bearer $CF" "$API/zones/$ZONE/dns_records/$RID" | jq -c '{success}'`

### 3. With no connector running, the host answers from Cloudflare, never the droplet

    curl -s -o /dev/null -D - "https://$HOST/" | grep -iE '^(HTTP|server:)'
    export DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token | head -n1)
    IP=$(doctl compute droplet list --format Name,PublicIPv4 --no-header | awk '$1 == "monsterpaws" {print $2}')
    dig +short "$HOST" @1.1.1.1 | grep -qxF "$IP" && echo "RESOLVES TO THE DROPLET" || echo "not the droplet's address"

Verify: `530` (Cloudflare's code for a tunnel with no connector), `server:
cloudflare`, and `not the droplet's address`. A 200 or anything from Caddy here
means this host reaches the droplet: run step 2's rollback at once.
Rollback: step 2's.

### 4. Start the connector and read what it opens

    npm run hooks -- up
    npm run hooks -- status

Then, with no dev server on :3027:

    for p in / /api/health /design \
      '/api/webhooks/everyorg/../../../design' \
      '/api/webhooks/everyorg/%2e%2e/%2e%2e/%2e%2e/design' \
      '/api/webhooks/everyorg/x/../../../../api/health'; do
      curl -s --path-as-is -o /dev/null -w "GET $p %{http_code}\n" "https://$HOST$p"
    done
    curl -s -o /dev/null -D - -X POST -H 'Content-Type: application/json' -d '{}' \
      "https://$HOST/api/webhooks/everyorg/oplog0017probe" | grep -iE '^(HTTP|server:|cf-mitigated:)'

Verify:
- `status` shows at least one `Registered tunnel connection`.
- Each GET answers `404`: the catch-all, so `/api/health`, which the droplet
  would answer 200 or 503, is not reached. A `502` on a traversal path means the
  rule matched it and the path could reach the dev server: run
  `npm run hooks -- down`, and do not bring it up until the rule is fixed.
- The POST answers `502`: the webhook's rule matched and the dev server is not
  there. No `cf-mitigated` line.

Rollback: `npm run hooks -- down`.

### 5. Leave it down until a staging session needs it

    npm run hooks -- down
    curl -s -o /dev/null -w "%{http_code}\n" "https://$HOST/"

Verify: `530`.
Rollback: `npm run hooks -- up`.

## The unproven part: Bot Fight Mode
infra.md records Bot Fight Mode on since 2026-07-30, with "retest the Every.org
flow when it lands". It applies to this host as it does to the rest of the zone.
A curl from home passing step 4 proves nothing about Every.org's servers, and
reports differ on whether a free-plan zone can exempt one path. Only a real
delivery proves it, in the `everyorg-webhook-endpoint` slice, not here.

If a real staging donation completes, the tunnel shows connections, and
`everyorg_webhook_payloads` stays empty, read the dashboard's Security → Events
for the host (Logan, or a token with analytics read). If it shows a Bot Fight
Mode challenge, the choice goes to Logan: off for the whole zone, or another way
in. Either way it gets its own oplog entry. This entry does not touch the
setting.

## Rollback of the whole entry
In order: `npm run hooks -- down`; step 2's rollback; step 1's rollback. Then
`cloudflare/tunnel-token` can be rolled in the dashboard. The Every.org webhook
keeps its URL, which goes back to resolving nowhere.

## Run
<added on the day>

## Follow-ups
<added on the day>
