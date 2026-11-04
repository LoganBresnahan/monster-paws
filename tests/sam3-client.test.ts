import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const script = path.resolve(__dirname, "..", "comfyui", "sam3_test.py");

describe("the sam3 client's bright lines (ADR-0028)", () => {
  it("refuses unapproved photos and other models, against a stub server that never reaches Meta", () => {
    const run = spawnSync("python3", ["-I", script], { encoding: "utf8" });
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(run.stderr).toMatch(/^OK/m);
  });
});
