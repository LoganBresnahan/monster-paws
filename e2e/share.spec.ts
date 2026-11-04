import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { SHARE_GIFT_MANIFEST, SHARE_GIFT_TOKEN, SHARE_MANIFEST, SHARE_TOKEN } from "./share-fixture";

const BASE = "https://monsterpaws.org";
// Bluesky's card fetcher, off Next's default bot list: the case where metadata could be streamed (ADR-0036).
const OFF_THE_LIST = "Mozilla/5.0 (compatible; Bluesky Cardyb/1.1; +mailto:support@bsky.app)";
const SHARE = `/share/${SHARE_TOKEN}`;

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

// /deploy's container has no SHARE_BASE_URL yet, so these run on `npm run e2e` only (ADR-0036).
test.skip(Boolean(process.env.PW_BASE_URL), "needs a server started with the share fixture");

test("the share page shows all four paintings, and each opens its own page", async ({ page }) => {
  await page.goto(SHARE);
  await expect(page.getByRole("heading", { name: "Beetle's paintings", level: 1 })).toBeVisible();
  await expect(page.getByText("Bloodhound · painted in watercolour")).toBeVisible();
  for (const n of [1, 2, 3, 4]) {
    await expect(page.getByRole("img", { name: `painting ${n} of 4` })).toHaveAttribute(
      "src",
      `${SHARE}/${n}/painting.jpg`,
    );
  }
  const first = page.getByRole("img", { name: "painting 1 of 4" });
  await expect.poll(() => first.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1216);
  await page.getByRole("link", { name: "Save or share painting 3 of Beetle" }).click();
  await page.waitForURL(`**${SHARE}/3`);
  await expect(page.getByRole("link", { name: "Save" })).toHaveAttribute("download", "beetle-monster-paws-3.jpg");
  await expect(page.getByRole("link", { name: "Save" })).toHaveAttribute("href", `${SHARE}/3/painting.jpg`);
  await page.getByRole("link", { name: /See all 4/ }).click();
  await page.waitForURL(`**${SHARE}`);
});

test("each painting's card is that painting, kept out of search", async ({ page, request }) => {
  for (const n of [1, 4]) {
    await page.goto(`${SHARE}/${n}`);
    const title = await page.title();
    expect(await meta(page, 'property="og:title"')).toBe(title);
    expect(await meta(page, 'property="og:site_name"')).toBe("Monster Paws");
    expect(await meta(page, 'property="og:url"')).toBeNull();
    expect(await meta(page, 'name="twitter:card"')).toBe("summary_large_image");
    expect(await meta(page, 'name="robots"')).toContain("noindex");
    const image = `${BASE}${SHARE}/${n}/painting.jpg`;
    expect(await meta(page, 'property="og:image"')).toBe(image);
    expect(await meta(page, 'name="twitter:image"')).toBe(image);
    expect(await meta(page, 'property="og:image:width"')).toBe("1216");
    expect(await meta(page, 'property="og:image:height"')).toBe("832");

    const res = await request.get(`${SHARE}/${n}/painting.jpg`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/jpeg");
    expect(res.headers()["x-robots-tag"]).toBe("noindex");
    expect(jpegDimensions(await res.body())).toEqual([1216, 832]);
  }
});

test("a preview bot off Next's list gets the card in <head>", async ({ request }) => {
  const html = await (await request.get(`${SHARE}/2`, { headers: { "user-agent": OFF_THE_LIST } })).text();
  expect(html.indexOf(`${BASE}${SHARE}/2/painting.jpg`)).toBeGreaterThan(-1);
  expect(html.indexOf('property="og:image"')).toBeLessThan(html.indexOf("</head>"));
});

test("a shelter's animal carries the shelter's credit and no guessed kind; a crew pet has no credit", async ({ page }) => {
  for (const path of [`/share/${SHARE_GIFT_TOKEN}`, `/share/${SHARE_GIFT_TOKEN}/2`]) {
    await page.goto(path);
    await expect(page.getByText("Painted with permission from A Test Shelter.")).toBeVisible();
    await expect(page.getByText(/^Painted in watercolour/)).toBeVisible();
    await expect(page.locator("main")).not.toContainText(SHARE_GIFT_MANIFEST.email);
  }
  await page.goto(SHARE);
  await expect(page.getByText(/Painted with permission/)).toHaveCount(0);
});

test("nothing about a donor reaches the page, whatever the file holds, and no cookie is set", async ({ request }) => {
  for (const path of [SHARE, `${SHARE}/1`]) {
    const res = await request.get(path);
    const html = await res.text();
    for (const value of [SHARE_MANIFEST.email, SHARE_MANIFEST.intentId, SHARE_MANIFEST.donorName, "4242"]) {
      expect(html).not.toContain(value);
    }
    expect(res.headers()["set-cookie"]).toBeUndefined();
  }
});

test("the share links carry that painting's URL, and load no platform script", async ({ page, offsite }) => {
  await page.goto(`${SHARE}/2`);
  const url = encodeURIComponent(`${BASE}${SHARE}/2`);
  await expect(page.getByRole("link", { name: "Facebook", exact: true }).first()).toHaveAttribute("href", new RegExp(url));
  await expect(page.getByRole("link", { name: "LinkedIn", exact: true }).first()).toHaveAttribute("href", new RegExp(url));
  await expect(page.getByRole("link", { name: "X", exact: true }).first()).toHaveAttribute("href", new RegExp(url));
  await expect(page.getByRole("link", { name: "Bluesky", exact: true }).first()).toHaveAttribute("href", new RegExp(url));
  expect(offsite.filter((r) => r.resourceType() === "script")).toEqual([]);
});

// Desktop Chromium on Linux has no `navigator.canShare`, so the phone's path is stubbed here: this proves the
// button hands over the image file, not that a real phone's sheet offers Instagram.
test("on a phone, Share hands the image file to the share sheet", async ({ page }) => {
  await page.addInitScript(() => {
    const nav = navigator as Navigator & { shared?: ShareData[] };
    nav.shared = [];
    nav.canShare = () => true;
    nav.share = async (data) => {
      nav.shared!.push(data as ShareData);
    };
  });
  await page.goto(`${SHARE}/2`);
  // Both buttons open the same sheet; Instagram's name is there so a person can find it.
  for (const name of ["Share the image", "Instagram"]) {
    await page.getByRole("main").getByRole("button", { name }).click();
    const shared = await page.evaluate(() => {
      const data = (navigator as Navigator & { shared: ShareData[] }).shared.at(-1)!;
      return { url: data.url, name: data.files?.[0].name, type: data.files?.[0].type, size: data.files?.[0].size };
    });
    expect(shared.url).toBeUndefined();
    expect(shared.name).toBe("beetle-monster-paws-2.jpg");
    expect(shared.type).toBe("image/jpeg");
    expect(shared.size).toBeGreaterThan(1000);
  }
});

test("without a share sheet, there is no Share button, and Copy link copies the painting's URL", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    (navigator as unknown as { canShare?: unknown }).canShare = undefined;
  });
  await page.goto(`${SHARE}/2`);
  await expect(page.getByRole("button", { name: "Share the image" })).toHaveCount(0);

  // Instagram has no share link, so without a sheet its button saves the image and says what to do next.
  const instagram = page.getByRole("main").getByRole("link", { name: "Instagram" });
  await expect(instagram).toHaveAttribute("download", "beetle-monster-paws-2.jpg");
  const download = page.waitForEvent("download");
  await instagram.click();
  expect((await download).suggestedFilename()).toBe("beetle-monster-paws-2.jpg");
  await expect(page.getByRole("status")).toContainText("Instagram doesn't take links");

  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${BASE}${SHARE}/2`);
});

test("a token nobody published, a malformed one and a fifth painting are 404s", async ({ request }) => {
  for (const path of [
    "/share/nobodyPublishedThis000",
    "/share/too-short",
    "/share/..%2F..%2Fetc%2Fpasswd0000",
    `${SHARE}/5`,
    `${SHARE}/5/painting.jpg`,
    `${SHARE}/1/painting.jpg?x=1`,
    "/share/nobodyPublishedThis000/1/painting.jpg",
  ]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
});

test("a share page never says you give to get", async ({ page }) => {
  for (const path of [SHARE, `${SHARE}/1`]) {
    await page.goto(path);
    await expect(page.getByRole("main")).not.toContainText(/\b(keepsakes?|gifts?|yours|you get|you keep|collection|in exchange)\b/i);
  }
});

test("robots.txt leaves /share open, so the bots can read the page", async ({ request }) => {
  expect(await (await request.get("/robots.txt")).text()).not.toContain("/share");
});
