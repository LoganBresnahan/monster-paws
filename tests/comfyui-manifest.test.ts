import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The manifest is the licence record ADR-0004 §1 requires and the hash list
// the store is verified against (decision 11); the Python fetcher is the one
// parser, so the test drives it rather than re-implementing the format here.
const repo = path.resolve(__dirname, "..");
const fetcher = path.join(repo, "comfyui", "models.py");

function checkWith(manifest: string): { status: number | null; out: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "mp-manifest-"));
  copyFileSync(fetcher, path.join(dir, "models.py"));
  writeFileSync(path.join(dir, "models.manifest"), manifest);
  const r = spawnSync("python3", ["-I", path.join(dir, "models.py"), "check"], { encoding: "utf8" });
  return { status: r.status, out: r.stdout + r.stderr };
}

describe("comfyui/models.manifest (ADR-0004 decision 11)", () => {
  it("the committed manifest parses and every entry carries a licence and a date", () => {
    const out = execFileSync("python3", ["-I", fetcher, "check"], { encoding: "utf8" });
    expect(out).toMatch(/^ok: \d+ entries/);
    const lines = readFileSync(path.join(repo, "comfyui", "models.manifest"), "utf8")
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#"));
    for (const line of lines) {
      const [file, source, sha, licence, checked] = line.trim().split(/\s+/);
      // `detect/` is read by transformers for subject detection (ADR-0026), never by ComfyUI.
      expect(file, line).toMatch(/^(checkpoints|ipadapter|clip_vision|loras|controlnet|diffusion_models|text_encoders|vae|model_patches|detect)\//);
      expect(source, line).toMatch(/^(hf:[^/]+\/[^/]+\/.+|r2:.+)$/);
      expect(sha, line).toMatch(/^[0-9a-f]{64}$/);
      expect(licence, line).toMatch(/^[A-Za-z0-9.+-]+$/);
      expect(checked, line).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("refuses a hash that is not sha256", () => {
    const r = checkWith("checkpoints/x.safetensors hf:a/b/x.safetensors deadbeef MIT 2026-10-07\n");
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/sha256/);
  });

  it("refuses a line without a licence or a date", () => {
    const r = checkWith(`checkpoints/x.safetensors hf:a/b/x.safetensors ${"0".repeat(64)} MIT\n`);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/5 columns/);
  });

  it("refuses a path that escapes the store", () => {
    const r = checkWith(`../x.safetensors hf:a/b/x.safetensors ${"0".repeat(64)} MIT 2026-10-07\n`);
    expect(r.status).not.toBe(0);
  });
});
