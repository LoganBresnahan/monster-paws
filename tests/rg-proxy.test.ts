import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { connectTarget, createRgProxy, RESCUEGROUPS_API } from "../scripts/rg-proxy";

const servers: net.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

function listen<T extends net.Server>(server: T): Promise<number> {
  servers.push(server);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

/** Sends a raw CONNECT and returns the proxy's status line. */
function connect(proxyPort: number, target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(proxyPort, "127.0.0.1", () =>
      sock.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`),
    );
    sock.once("data", (d) => {
      resolve(d.toString().split("\r\n")[0]);
      sock.destroy();
    });
    sock.on("error", reject);
  });
}

describe("ADR-0033 the home end of the poll bridge", () => {
  it("allows only the RescueGroups API by default", () => {
    expect(RESCUEGROUPS_API).toBe("api.rescuegroups.org:443");
  });

  it("normalises CONNECT targets and rejects anything that is not host:port", () => {
    expect(connectTarget("API.RescueGroups.org:443")).toBe("api.rescuegroups.org:443");
    expect(connectTarget("api.rescuegroups.org:0443")).toBe("api.rescuegroups.org:443");
    expect(connectTarget("api.rescuegroups.org")).toBeNull();
    expect(connectTarget("http://api.rescuegroups.org:443/")).toBeNull();
    expect(connectTarget("user@api.rescuegroups.org:443")).toBeNull();
    expect(connectTarget(undefined)).toBeNull();
  });

  it("splices bytes to an allowed target", async () => {
    const echo = net.createServer((s) => s.pipe(s));
    const echoPort = await listen(echo);
    const target = `127.0.0.1:${echoPort}`;
    const lines: string[] = [];
    const proxyPort = await listen(createRgProxy({ allow: [target], log: (l) => lines.push(l) }));

    const reply = await new Promise<string>((resolve, reject) => {
      const sock = net.connect(proxyPort, "127.0.0.1", () =>
        sock.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`),
      );
      let buf = "";
      sock.on("data", (d) => {
        buf += d.toString();
        if (buf.includes("\r\n\r\n") && !buf.includes("ping")) sock.write("ping");
        if (buf.endsWith("ping")) {
          resolve(buf);
          sock.destroy();
        }
      });
      sock.on("error", reject);
    });
    expect(reply.startsWith("HTTP/1.1 200")).toBe(true);
    expect(lines).toContain(`CONNECT ${target}`);
  });

  // Never an open proxy: every other host, port or method is refused.
  it("refuses other hosts, other ports and lookalike hosts", async () => {
    const proxyPort = await listen(createRgProxy({ log: () => {} }));
    for (const target of [
      "example.com:443",
      "api.rescuegroups.org:80",
      "api.rescuegroups.org:22",
      "api.rescuegroups.org.evil.example:443",
      "127.0.0.1:5432",
    ]) {
      expect(await connect(proxyPort, target)).toBe("HTTP/1.1 403 Forbidden");
    }
  });

  it("refuses plain-HTTP forwarding", async () => {
    const proxyPort = await listen(createRgProxy({ log: () => {} }));
    const status = await new Promise<number | undefined>((resolve, reject) =>
      http
        .get({ host: "127.0.0.1", port: proxyPort, path: "http://api.rescuegroups.org/v5/" }, (res) => {
          res.resume();
          resolve(res.statusCode);
        })
        .on("error", reject),
    );
    expect(status).toBe(405);
  });
});
