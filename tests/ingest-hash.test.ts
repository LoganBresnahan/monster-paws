import { describe, expect, it } from "vitest";
import { canonicalJson, contentHashOf } from "@/core/ingest/hash";

describe("ADR-0009 content hashing", () => {
  it("is stable across key order — the false-mismatch failure mode", () => {
    const a = { name: "Rex", species: "dog", breed: "mutt" };
    const b = { breed: "mutt", species: "dog", name: "Rex" };
    expect(contentHashOf(a)).toBe(contentHashOf(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("sorts keys at every depth, not just the root", () => {
    const a = { animal: { name: "Rex", tags: { b: 2, a: 1 } } };
    const b = { animal: { tags: { a: 1, b: 2 }, name: "Rex" } };
    expect(contentHashOf(a)).toBe(contentHashOf(b));
  });

  it("keeps array order significant — reordered photos are a real change", () => {
    expect(contentHashOf({ photos: ["a.jpg", "b.jpg"] })).not.toBe(
      contentHashOf({ photos: ["b.jpg", "a.jpg"] }),
    );
  });

  it("distinguishes values that JSON.stringify would render alike", () => {
    expect(contentHashOf({ age: 3 })).not.toBe(contentHashOf({ age: "3" }));
    expect(contentHashOf({ a: null })).not.toBe(contentHashOf({ a: "null" }));
  });

  it("does not confuse a missing key with an explicit null", () => {
    expect(contentHashOf({ name: "Rex" })).not.toBe(contentHashOf({ name: "Rex", breed: null }));
  });

  it("treats undefined as absent, matching what JSONB storage would keep", () => {
    expect(contentHashOf({ name: "Rex", breed: undefined })).toBe(contentHashOf({ name: "Rex" }));
  });

  it("excludes volatile paths — the never-matching failure mode", () => {
    const first = { meta: { requestId: "req-1" }, animal: { name: "Rex" } };
    const second = { meta: { requestId: "req-2" }, animal: { name: "Rex" } };
    expect(contentHashOf(first)).not.toBe(contentHashOf(second));
    expect(contentHashOf(first, ["meta.requestId"])).toBe(
      contentHashOf(second, ["meta.requestId"]),
    );
  });

  it("excludes a volatile field inside every array element", () => {
    const at = (t: string) => ({ items: [{ id: "1", syncedAt: t }, { id: "2", syncedAt: t }] });
    expect(contentHashOf(at("T1"), ["items[].syncedAt"])).toBe(
      contentHashOf(at("T2"), ["items[].syncedAt"]),
    );
    // The exclusion must not swallow the fields that matter.
    expect(contentHashOf(at("T1"), ["items[].syncedAt"])).not.toBe(
      contentHashOf({ items: [{ id: "1", syncedAt: "T1" }] }, ["items[].syncedAt"]),
    );
  });

  it("names its algorithm so a future change is visible in the corpus", () => {
    expect(contentHashOf({ a: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("rejects non-finite numbers rather than hashing them as null", () => {
    expect(() => contentHashOf({ weight: Number.NaN })).toThrow(/not JSON-safe/);
    expect(() => contentHashOf({ weight: Number.POSITIVE_INFINITY })).toThrow(/weight/);
  });

  it("canonicalizes to the documented shape", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }] })).toBe('{"a":[2,{"c":3,"d":4}],"b":1}');
  });
});
