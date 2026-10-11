import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

// comfyui/likeness.py is the image eval harness (ADR-0004 auto-QC); the model
// part needs the encoder on disk, so the tests pin the ranking math it hands
// the model's vectors to.
function rank(reference: number[], candidates: Record<string, number[]>) {
  const r = spawnSync("python3", ["-I", "comfyui/likeness.py", "rank"], {
    input: JSON.stringify({ reference, candidates }),
    encoding: "utf8",
  });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim().split("\n").map((l) => {
    const [score, id] = l.split(" ");
    return { id, score: Number(score) };
  });
}

describe("likeness rank (ADR-0004)", () => {
  it("orders candidates by cosine to the reference, best first", () => {
    const out = rank([1, 0, 0], { a: [0.9, 0.1, 0], b: [0, 1, 0], c: [1, 0, 0] });
    expect(out.map((o) => o.id)).toEqual(["c", "a", "b"]);
    expect(out[0].score).toBe(1);
    expect(out[2].score).toBe(0);
  });
  it("is scale-invariant: a longer vector in the same direction scores the same", () => {
    const out = rank([1, 2, 3], { unit: [1, 2, 3], scaled: [2, 4, 6] });
    expect(out[0].score).toBe(out[1].score);
  });
  it("gives a zero vector a score of 0 rather than NaN", () => {
    const out = rank([1, 0], { z: [0, 0] });
    expect(out[0].score).toBe(0);
  });
});
