import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The crew's photos come off phones with GPS in their EXIF, and ComfyUI writes
// the whole workflow and prompt into every painting's PNG; neither may ship.
// Only plain JPEGs are allowed here, and only the segments that hold pixels:
// any APPn but JFIF (EXIF, XMP, ICC, Photoshop) or a comment fails.
const dir = path.resolve(__dirname, "..", "public", "brand", "crew");
const ALLOWED = new Set([0xe0, 0xdb, 0xc4, 0xdd, 0xc0, 0xc1, 0xc2]);

function segments(b: Buffer): number[] {
  expect(b.readUInt16BE(0)).toBe(0xffd8);
  const seen: number[] = [];
  let i = 2;
  while (i < b.length) {
    expect(b[i]).toBe(0xff);
    const m = b[i + 1];
    if (m === 0xd9) break;
    seen.push(m);
    i += 2 + b.readUInt16BE(i + 2);
    if (m === 0xda) {
      // entropy-coded data runs to the next marker that is neither a stuffed 0xFF00 nor a restart
      while (i < b.length - 1 && !(b[i] === 0xff && b[i + 1] !== 0x00 && (b[i + 1] < 0xd0 || b[i + 1] > 0xd7))) i++;
    }
  }
  return seen;
}

describe("public/brand/crew carries pixels only", () => {
  const files = readdirSync(dir);

  it("holds the crew's files, and every one is a JPEG", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(f).toMatch(/^[a-z]+-(painting|photo|thumb)\.jpg$/);
  });

  it.each(files)("%s has no metadata segment", (f) => {
    const extra = segments(readFileSync(path.join(dir, f))).filter((m) => m !== 0xda && !ALLOWED.has(m));
    expect(extra.map((m) => `0x${m.toString(16)}`)).toEqual([]);
  });
});
