import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import type { SeedManifest } from "./seed";

/**
 * ADR-0030: every page sends a card, with its own words and the brand image.
 * The image URL is absolute under production's host on every environment, so
 * it is fetched here by path against the server under test.
 */
const BASE = "https://monsterpaws.org";

async function meta(page: Page, selector: string): Promise<string | null> {
  const el = page.locator(`head meta[${selector}]`);
  return (await el.count()) ? el.first().getAttribute("content") : null;
}

function jpegDimensions(b: Buffer): [number, number] {
  let i = 2;
  while (i < b.length) {
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xc2) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error("no frame header");
}

const PAGES: Array<[string, (seed: SeedManifest) => string]> = [
  ["home", () => "/"],
  ["browse", () => "/animals"],
  ["an animal", (seed) => `/animals/${seed.exact}`],
  ["claim", () => "/claim"],
  ["demo", () => "/demo"],
];

for (const [name, pathOf] of PAGES) {
  test(`${name} sends a card with its own title, description and the brand image`, async ({ page, seed, request }) => {
    await page.goto(pathOf(seed));
    const title = await page.title();
    const description = await meta(page, 'name="description"');
    expect(description).toBeTruthy();
    expect(await meta(page, 'property="og:title"')).toBe(title);
    expect(await meta(page, 'property="og:description"')).toBe(description);
    expect(await meta(page, 'property="og:site_name"')).toBe("Monster Paws");
    // No og:url: a platform would take it as canonical, and the root's would
    // send every inner page's share to the home page.
    expect(await meta(page, 'property="og:url"')).toBeNull();
    expect(await meta(page, 'name="twitter:card"')).toBe("summary_large_image");

    const image = await meta(page, 'property="og:image"');
    expect(image).toMatch(new RegExp(`^${BASE}/opengraph-image`));
    expect(await meta(page, 'property="og:image:width"')).toBe("1216");
    expect(await meta(page, 'property="og:image:height"')).toBe("832");
    expect(await meta(page, 'property="og:image:alt"')).toMatch(/Beetle/);
    expect(await meta(page, 'name="twitter:image"')).toMatch(new RegExp(`^${BASE}/`));

    const res = await request.get(new URL(image!).pathname + new URL(image!).search);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/jpeg");
    expect(jpegDimensions(await res.body())).toEqual([1216, 832]);
  });
}
