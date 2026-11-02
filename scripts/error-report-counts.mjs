#!/usr/bin/env node
// What production's error reports hold, read from Better Stack as counts and key checks only
// (ADR-0010 as amended 2026-11-02, oplogs 0019 and 0020).
//
//   BETTERSTACK_TELEMETRY_TOKEN=$(pass show betterstack/telemetry-token | head -n1) DROPLET_IP=$IP \
//     node scripts/error-report-counts.mjs <start> <end>     e.g. now-90d now
//
// DROPLET_IP sorts the droplet's own address out as `droplet`: only `public` can be a visitor. It
// goes into the query but is never printed, since the repo and its transcripts never hold it.
// Never select a value from `raw` here: a report's IP would land in a terminal and a transcript.
// Never put the webhook's real secret in this query: that hands it to Better Stack.

const APPLICATION_ID = 2778816;
const MCP = "https://mcp.betterstack.com";

const ADDRESS = "JSONExtract(raw, 'user', 'ip_address', 'String')";
const dropletIp = process.env.DROPLET_IP ?? "";
if (dropletIp && !/^[0-9a-fA-F:.]+$/.test(dropletIp)) {
  console.error("DROPLET_IP is not an address");
  process.exit(64);
}
const droplet = dropletIp ? `${ADDRESS} = '${dropletIp}', 'droplet',
    ` : "";
const printable = (text) => (dropletIp ? text.replaceAll(dropletIp, "<droplet>") : text);
const QUERY = `SELECT
  JSONExtract(raw, 'environment', 'Nullable(String)') AS env,
  JSONExtract(raw, 'tags', 'component', 'Nullable(String)') AS component,
  JSONExtract(raw, 'platform', 'Nullable(String)') AS platform,
  multiIf(
    ${ADDRESS} = '', 'none',
    ${droplet}match(${ADDRESS}, '^(127\\\\.|::1$|::ffff:127\\\\.)'), 'loopback',
    match(${ADDRESS}, '^(10\\\\.|192\\\\.168\\\\.|172\\\\.(1[6-9]|2[0-9]|3[01])\\\\.|fe80:|fc|fd|::ffff:10\\\\.|::ffff:192\\\\.168\\\\.|::ffff:172\\\\.(1[6-9]|2[0-9]|3[01])\\\\.)'), 'private',
    'public'
  ) AS address_kind,
  count() AS reports,
  uniqExact(${ADDRESS}) AS distinct_addresses,
  toDate(min(dt)) AS first_day,
  toDate(max(dt)) AS last_day,
  countIf(JSONHas(raw, 'user')) AS with_user,
  countIf(length(JSONExtractKeys(raw, 'request', 'cookies')) > 0) AS with_a_cookie,
  countIf(JSONHas(raw, 'request', 'query_string')) AS with_query_string,
  countIf(JSONHas(raw, 'request', 'data')) AS with_body,
  countIf(positionCaseInsensitive(raw, 'cf-connecting-ip') > 0) AS naming_cf_ip,
  countIf(positionCaseInsensitive(raw, 'x-forwarded-for') > 0) AS naming_xff,
  countIf(position(raw, 'mp_intents') > 0) AS naming_intent_cookie,
  countIf(position(raw, 'example.com') > 0) AS naming_proof_address,
  countIf(position(raw, 'proof=1') > 0) AS naming_proof_query,
  countIf(match(raw, '(everyorg|test-gift)/[A-Za-z0-9]{20,}')) AS holding_a_secret_path,
  countIf(position(raw, 'everyorg/<secret>') > 0) AS webhook_path_scrubbed
FROM {{source}}
WHERE dt >= {{start_time}} AND dt < {{end_time}}
GROUP BY env, component, platform, address_kind
ORDER BY env, component, platform, address_kind`;

const [start, end] = process.argv.slice(2);
const token = process.env.BETTERSTACK_TELEMETRY_TOKEN;
if (!start || !end || !token) {
  console.error("usage: BETTERSTACK_TELEMETRY_TOKEN=… node scripts/error-report-counts.mjs <start> <end>");
  process.exit(64);
}

let session;
async function rpc(method, params, id) {
  const response = await fetch(MCP, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      ...(session ? { "mcp-session-id": session } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", ...(id ? { id } : {}), method, params }),
    signal: AbortSignal.timeout(60_000),
  });
  session = response.headers.get("mcp-session-id") ?? session;
  const text = await response.text();
  if (!id) return null;
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  return JSON.parse(line ? line.slice(5) : text);
}

// Through `printable` on every path, a throw included: a response can echo the query, which holds
// the droplet's address, and JSON.parse quotes a snippet of what it couldn't read.
try {
  await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "error-report-counts", version: "1" } }, 1);
  await rpc("notifications/initialized", {});
  const result = await rpc(
    "tools/call",
    { name: "query", arguments: { query: QUERY, source_id: APPLICATION_ID, source_type: "exceptions", start_time: start, end_time: end } },
    2,
  );
  console.log(printable((result.result?.content ?? []).map((c) => c.text ?? "").join("\n") || JSON.stringify(result.error ?? result)));
} catch (err) {
  console.error(printable(String(err)));
  process.exitCode = 1;
}
