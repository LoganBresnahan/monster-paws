import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The nightly wrapper runs against a stub bridge in a scratch checkout, so the
// retry rule is tested without the droplet and the log lands in the scratch var/.
const repo = path.resolve(__dirname, "..");

function nightly(codes: number[]): { calls: string[]; log: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "mp-nightly-"));
  mkdirSync(path.join(dir, "scripts"));
  copyFileSync(path.join(repo, "scripts", "poll-nightly.sh"), path.join(dir, "scripts", "poll-nightly.sh"));
  writeFileSync(path.join(dir, "codes"), codes.join("\n") + "\n");
  // Each call takes the next exit code and records the host it was given.
  writeFileSync(
    path.join(dir, "scripts", "poll-via-bridge.sh"),
    '#!/usr/bin/env bash\ncd "$(dirname "$0")/.."\necho "$BRIDGE_SSH_HOST" >> calls\n' +
      'rc=$(head -n1 codes); sed -i 1d codes; echo "stub exits $rc"; exit "$rc"\n',
    { mode: 0o755 },
  );
  const r = spawnSync("bash", [path.join(dir, "scripts", "poll-nightly.sh")], {
    encoding: "utf8",
    env: { ...process.env, HOME: dir, BRIDGE_SSH_HOST: "", POLL_RETRY_WAIT: "0" },
  });
  expect(r.status).toBe(0);
  const logs = readdirSync(path.join(dir, "var", "nightly"));
  expect(logs).toHaveLength(1);
  return {
    calls: readFileSync(path.join(dir, "calls"), "utf8").trim().split("\n"),
    log: readFileSync(path.join(dir, "var", "nightly", logs[0]), "utf8"),
  };
}

describe("ADR-0033 as amended 2026-10-30 the nightly retries the whole run", () => {
  it("retries a dropped connection and a cut page, and stops at the first success", () => {
    const { calls, log } = nightly([255, 1, 0, 0]);
    expect(calls).toEqual(["monsterpaws-bridge", "monsterpaws-bridge", "monsterpaws-bridge"]);
    expect(log).toMatch(/-- attempt 1 exited 255 .*; retrying in 0 s/);
    expect(log).toMatch(/-- attempt 2 exited 1 .*; retrying in 0 s/);
    expect(log.trimEnd().split("\n").at(-1)).toMatch(/^== exit 0 /);
  });

  it("never retries the gate's exit 2, which wants a person", () => {
    const { calls, log } = nightly([2, 0]);
    expect(calls).toHaveLength(1);
    expect(log).not.toContain("-- attempt");
    expect(log.trimEnd().split("\n").at(-1)).toMatch(/^== exit 2 /);
  });

  it("never retries a run the 3 h bound stopped", () => {
    expect(nightly([124, 0]).calls).toHaveLength(1);
    expect(nightly([137, 0]).calls).toHaveLength(1);
  });

  it("gives up after three attempts with the last attempt's exit", () => {
    const { calls, log } = nightly([255, 1, 255, 0]);
    expect(calls).toHaveLength(3);
    expect(log.trimEnd().split("\n").at(-1)).toMatch(/^== exit 255 /);
  });
});
