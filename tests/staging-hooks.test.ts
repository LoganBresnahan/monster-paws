import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The tunnel's reach is this file's text: a widened path or a second rule would
// put the whole dev server on the public internet (ADR-0027 as amended 2026-11-02).
const config = readFileSync(path.resolve(__dirname, "..", "scripts", "staging-hooks.yml"), "utf8");
const lines = config.split("\n").filter((line) => line.trim() && !line.trim().startsWith("#"));

describe("the staging webhook's tunnel ingress (ADR-0027 as amended 2026-11-02)", () => {
  it("forwards only the webhook's path on the staging host, and 404s the rest", () => {
    expect(lines.slice(0, 5)).toEqual([
      "ingress:",
      "  - hostname: staging-hooks.monsterpaws.org",
      "    path: ^/api/webhooks/everyorg/[A-Za-z0-9]+$",
      "    service: http://127.0.0.1:3027",
      "  - service: http_status:404",
    ]);
    expect(config.match(/service:/g)).toHaveLength(2);
  });

  it("never names the production host or a path secret", () => {
    expect(config).not.toMatch(/^\s*(- )?hostname: (hooks\.)?monsterpaws\.org/m);
    expect(config).not.toMatch(/everyorg\/[A-Za-z0-9]{8,}/);
  });

  it("never matches a path that collapses to somewhere else, and matches a 32-character secret", () => {
    const rule = new RegExp(lines[2].replace("    path: ", ""));
    for (const escape of [
      "/api/webhooks/everyorg/../../../design",
      "/api/webhooks/everyorg/%2e%2e/%2e%2e/%2e%2e/design",
      "/api/webhooks/everyorg/x/../../../../api/health",
      "/api/webhooks/everyorg/abc/",
      "/api/webhooks/everyorg/",
      "/design",
    ]) {
      expect(rule.test(escape), escape).toBe(false);
    }
    expect(rule.test(`/api/webhooks/everyorg/${"aZ9".repeat(10)}ab`)).toBe(true);
  });

  it("keeps cloudflared's metrics off the distro's other interfaces", () => {
    expect(lines).toContain("metrics: 127.0.0.1:20241");
  });
});
