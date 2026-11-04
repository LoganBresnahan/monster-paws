import { expect, test } from "./fixtures";
import { SEEDED } from "./seed";

/**
 * The donate loop's doors on the production build, with Every.org configured as production and
 * Stowaway's shelter claimed in the seed, so the missing grant is the only thing keeping real
 * money away (ADR-0002 as amended 2026-11-02). The donor's path itself waits for a real grant.
 */

// Proves nothing against a server with EVERYORG_ENV unset (`npm run e2e:prod`): that shows no button anyway.
test("a claimed shelter with no permission to paint shows no Sponsor button", async ({ page, seed }) => {
  await page.goto(`/animals/${seed.stowaway}`);
  await expect(page.getByRole("heading", { name: SEEDED.stowaway.name, exact: true })).toBeVisible();
  await expect(page.locator(`a[href="/animals/${seed.stowaway}/sponsor"]`)).toHaveCount(0);
});

test("its sponsor page isn't there either", async ({ request, seed }) => {
  expect((await request.get(`/animals/${seed.stowaway}/sponsor`)).status()).toBe(404);
});

test("the hidden test page answers 404 with no secret configured", async ({ request }) => {
  expect((await request.get("/test-gift/anything")).status()).toBe(404);
  expect((await request.get("/test-gift/undefined")).status()).toBe(404);
});

test("the privacy page is reached from the footer and states what it promises", async ({ page }) => {
  await page.goto("/");
  await page.locator('footer a[href="/privacy"]').click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { name: "Privacy", exact: true })).toBeVisible();
  const text = await page.locator("main").innerText();
  expect(text).toContain("we erase it after 30 days");
  expect(text).toContain("It lasts 30 days");
  expect(text).toContain("If a shelter withdraws permission");
});

test("the thank-you page shows a browser with no cookie no gift", async ({ page }) => {
  await page.goto("/thanks");
  await expect(page.getByText("find a donation from this browser")).toBeVisible();
  await expect(page.getByText("Bookmark this page")).toHaveCount(0);
});
