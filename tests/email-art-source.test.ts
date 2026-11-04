import { describe, expect, it, vi } from "vitest";
import { artReaderFromEnv, mediaArtReader } from "@/core/email/art-source";

const TOKEN = "abcDEF123_-abcDEF123_-";
const art = { shareToken: TOKEN, artKeys: ["keepsakes/1/1.jpg", "keepsakes/1/2.jpg"] };

describe("reading a painting from the media hostname (ADR-0036 decision 5)", () => {
  it("fetches the published copy by token and place", async () => {
    const get = vi.fn(async () => new Response(Buffer.from("jpeg-bytes")));
    const bytes = await mediaArtReader("https://media.monsterpaws.org/", get as unknown as typeof fetch)(art, 1);
    expect(bytes.toString()).toBe("jpeg-bytes");
    expect((get.mock.calls[0] as unknown as [string])[0]).toBe(`https://media.monsterpaws.org/share/${TOKEN}/2.jpg`);
  });

  it("throws on a taken-down painting, which leaves it owed and never mails a stale copy", async () => {
    const get = async () => new Response(null, { status: 404 });
    await expect(mediaArtReader("https://media.monsterpaws.org", get as unknown as typeof fetch)(art, 0)).rejects.toThrow(/404/);
  });

  it("refuses a token of the wrong shape before building any URL", async () => {
    const get = vi.fn();
    const reader = mediaArtReader("https://media.monsterpaws.org", get as unknown as typeof fetch);
    await expect(reader({ ...art, shareToken: "../../etc" }, 0)).rejects.toThrow(/shape/);
    await expect(reader({ ...art, shareToken: null }, 0)).rejects.toThrow(/shape/);
    expect(get).not.toHaveBeenCalled();
  });

  it("refuses an oversized painting", async () => {
    const get = async () => new Response(Buffer.alloc(16), { headers: { "content-length": String(16 * 1024 * 1024) } });
    await expect(mediaArtReader("https://media.monsterpaws.org", get as unknown as typeof fetch)(art, 0)).rejects.toThrow(/large/);
  });
});

describe("choosing the art source", () => {
  it("is named by config and never guessed", () => {
    expect(() => artReaderFromEnv({ ART_STORE_DIR: "/tmp/x" })).toThrow(/EMAIL_ART_SOURCE/);
    expect(() => artReaderFromEnv({ EMAIL_ART_SOURCE: "store" })).toThrow(/ART_STORE_DIR/);
    expect(() => artReaderFromEnv({ EMAIL_ART_SOURCE: "media" })).toThrow(/SHARE_BASE_URL/);
    expect(artReaderFromEnv({ EMAIL_ART_SOURCE: "store", ART_STORE_DIR: "/tmp/x" })).toBeTypeOf("function");
    expect(artReaderFromEnv({ EMAIL_ART_SOURCE: "media", SHARE_BASE_URL: "https://media.monsterpaws.org" })).toBeTypeOf("function");
  });
});
