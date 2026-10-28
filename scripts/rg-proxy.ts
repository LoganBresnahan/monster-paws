import http from "node:http";
import net from "node:net";

/**
 * The home end of the poll bridge (ADR-0033): an HTTPS CONNECT proxy on this
 * machine's loopback, reached from the droplet's worker through one SSH
 * reverse forward, so RescueGroups sees our home address while the database
 * connection stays droplet → Managed Postgres. TLS runs end to end between
 * the worker and RescueGroups; this process only splices bytes.
 *
 *   tsx scripts/rg-proxy.ts [port]      default 18443, logs one line per tunnel
 */

export const RESCUEGROUPS_API = "api.rescuegroups.org:443";

/** `host:port` of a CONNECT target, lowercased, or null if malformed. */
export function connectTarget(url: string | undefined): string | null {
  const m = /^([a-z0-9.-]+):(\d{1,5})$/i.exec(url ?? "");
  return m ? `${m[1].toLowerCase()}:${Number(m[2])}` : null;
}

export function createRgProxy({
  allow = [RESCUEGROUPS_API],
  log = (line: string) => console.log(line),
}: { allow?: string[]; log?: (line: string) => void } = {}): http.Server {
  const allowed = new Set(allow);
  const server = http.createServer((req, res) => {
    // Never an open proxy: plain-HTTP forwarding is refused outright (ADR-0033).
    log(`refused ${req.method} ${req.url}`);
    res.writeHead(405, { Connection: "close" }).end();
  });

  server.on("connect", (req, client: net.Socket, head: Buffer) => {
    const target = connectTarget(req.url);
    // Exact host:port match only — a suffix or wildcard here makes this an
    // open relay for anything on the droplet's loopback (ADR-0033).
    if (!target || !allowed.has(target)) {
      log(`refused CONNECT ${req.url}`);
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const started = Date.now();
    const [host, port] = target.split(":");
    const upstream = net.connect(Number(port), host);
    // An unhandled socket 'error' kills the process and every tunnel with it.
    const fail = (side: string) => (err: Error) => {
      log(`error ${side} ${target}: ${err.message}`);
      client.destroy();
      upstream.destroy();
    };
    client.on("error", fail("client"));
    upstream.on("error", fail("upstream"));
    upstream.setKeepAlive(true, 15_000);
    upstream.on("connect", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      client.pipe(upstream).pipe(client);
      log(`CONNECT ${target}`);
    });
    upstream.on("close", () => {
      log(`closed ${target} after ${((Date.now() - started) / 1000).toFixed(1)} s, ${upstream.bytesRead} B in`);
      client.destroy();
    });
  });
  return server;
}

if (process.argv[1]?.endsWith("rg-proxy.ts")) {
  const port = Number(process.argv[2] ?? 18443);
  const stamp = () => new Date().toISOString();
  createRgProxy({ log: (line) => console.log(`${stamp()} ${line}`) }).listen(port, "127.0.0.1", () =>
    console.log(`${stamp()} rg-proxy on 127.0.0.1:${port}, allowing ${RESCUEGROUPS_API} only`),
  );
}
