import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// comfyui/guard.sh's cache drop with Windows faked on PATH: each FreePhysicalMemory read takes the next reading from
// a list, and `sleep` only counts, so the 5 s waits cost nothing here.
const bin = mkdtempSync(join(tmpdir(), "guard-"));
afterAll(() => rmSync(bin, { recursive: true, force: true }));
const fake = (name: string, body: string) => {
  writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(bin, name), 0o755);
};
fake("powershell.exe", `case "$*" in *FreePhysicalMemory*)
  n=$(cat "$GUARD_POS" 2>/dev/null || echo 0); echo $((n + 1)) > "$GUARD_POS"
  v=$(sed -n "$((n + 1))p" "$GUARD_FREE"); [ -n "$v" ] || v=$(tail -n 1 "$GUARD_FREE"); echo "$v";;
*) echo 1.0;; esac`);
fake("wsl.exe", "exit 0");
fake("docker", "exit 0");
fake("sleep", `echo x >> "$GUARD_SLEPT"`);

function drop(readings: number[], env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(bin, "run-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "free"), readings.join("\n") + "\n");
  const r = spawnSync("comfyui/guard.sh", ["drop"], {
    encoding: "utf8",
    env: { ...process.env, ...env, PATH: `${bin}:${process.env.PATH}`, GUARD_FREE: join(dir, "free"), GUARD_POS: join(dir, "pos"), GUARD_SLEPT: join(dir, "slept") },
  });
  expect(r.status, r.stderr).toBe(0);
  let slept = 0;
  try {
    slept = readFileSync(join(dir, "slept"), "utf8").split("\n").filter(Boolean).length;
  } catch {}
  return { line: r.stdout.split("\n").find((l) => l.startsWith("guard: dropped")), slept };
}

describe("the guard's cache drop", () => {
  it("waits for the art worker's floor when it passes one, so a 20–22 GB reading isn't refused unwaited (2026-11-04)", () => {
    const { line, slept } = drop([20.2, 20.2, 20.9, 23.1], { WAIT_GB: "22" });
    expect(line).toMatch(/Windows free 20\.2 → 23\.1 GB$/);
    expect(slept).toBe(2);
  });

  it("waits no longer than before for a batch's restart, its own floor plus 10", () => {
    expect(drop([20.2, 20.2, 20.9, 23.1])).toMatchObject({ slept: 0 });
    expect(drop([15, 15, 19.9, 20.1])).toMatchObject({ slept: 2 });
  });

  it("gives up after a minute, so a real shortfall still skips", () => {
    const { line, slept } = drop([20.2], { WAIT_GB: "22" });
    expect(slept).toBe(12);
    expect(line).toMatch(/Windows free 20\.2 → 20\.2 GB$/);
  });
});
