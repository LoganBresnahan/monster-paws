import { expect, test } from "./fixtures";

// The home page's two ways in: a shelter reading the consent email lands here
// first (ADR-0028 as amended 2026-10-26).
test("the hero's buttons lead to the animals and the demo", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "See adoptable animals" })).toHaveAttribute("href", "/animals");
  await expect(page.getByRole("link", { name: "See a demo" })).toHaveAttribute("href", "/demo");
});

test("a crew painting and photo open whole and close three ways", async ({ page }) => {
  await page.goto("/");
  const open = page.locator("dialog[open]");
  await page.getByRole("button", { name: "See Beetle's painting larger" }).click();
  await expect(open).toHaveCount(1);
  await expect(open.getByRole("img", { name: "Beetle, painted in watercolour" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(open).toHaveCount(0);

  await page.getByRole("button", { name: "See the photo of Stacey" }).click();
  await expect(open).toHaveCount(1);
  // a click on the backdrop lands on the dialog element itself, outside its figure
  await page.mouse.click(4, 4);
  await expect(open).toHaveCount(0);

  await page.getByRole("button", { name: "See the photo of Plum" }).click();
  await open.getByRole("button", { name: "Close" }).click();
  await expect(open).toHaveCount(0);
});

// The demo walks the real pages with the crew (ADR-0028 as amended 2026-10-26,
// later): browse, listing, sponsor, a checkout placeholder, thanks, and the
// pretend collection. No money moves and nothing is stored, so the walk is the
// whole contract; the pet and amount ride in the URL.
test("the demo walks a crew pet from browse to adoption day", async ({ page }) => {
  await page.goto("/demo");
  await expect(page.getByText("Demo: no money moves")).toBeVisible();
  await page.getByRole("link", { name: /^Beetle/ }).click();
  await page.waitForURL(/\/demo\/beetle$/);
  await expect(page.getByRole("heading", { name: "Beetle", level: 1 })).toBeVisible();

  await page.getByRole("link", { name: "Sponsor Beetle" }).click();
  await page.waitForURL(/\/demo\/beetle\/sponsor/);
  const other = page.getByLabel("Another amount, in dollars");
  await other.fill("0");
  await expect(page.getByRole("link", { name: /Continue to checkout/ })).toHaveCount(0);
  await other.fill("1");
  await page.getByRole("link", { name: "Continue to checkout · $1" }).click();

  await page.waitForURL(/\/demo\/beetle\/checkout\?amount=1/);
  await expect(page.getByText("Checkout placeholder")).toBeVisible();
  await page.getByRole("link", { name: "Complete the demo donation" }).click();

  await page.waitForURL(/\/demo\/beetle\/thanks\?amount=1/);
  await expect(page.getByText("Your $1 is on its way to Beetle's shelter.")).toBeVisible();
  await expect(page.getByRole("img", { name: "A photo of Beetle" })).toBeVisible();
  await page.getByRole("link", { name: "See Beetle in your collection" }).click();

  await page.waitForURL(/\/demo\/collection\/beetle\?amount=1/);
  // The keepsake is being painted when the card first shows, never there at once.
  await expect(page.getByText("Painting Beetle's keepsake")).toBeVisible();
  await expect(page.getByRole("button", { name: "See Beetle's keepsake larger" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("$1 to her shelter")).toBeVisible();

  await expect(page.getByText("✓ Confirmed by the shelter")).toHaveCount(1);
  await page.getByRole("button", { name: "Next update" }).click();
  await page.getByRole("button", { name: "Next update" }).click();
  await expect(page.getByText("✓ Confirmed by the shelter")).toHaveCount(3);
  await page.getByRole("button", { name: "Adoption day 🎉" }).click();
  // Adoption is the story's last update, never a badge over the keepsake.
  await expect(page.getByRole("listitem").filter({ hasText: "Beetle was adopted today. You were part of that." })).toBeVisible();
  await expect(page.getByText("Adopted!")).toHaveCount(0);
});

test("a crew name the demo does not have is a 404", async ({ page }) => {
  const response = await page.goto("/demo/nobody");
  expect(response?.status()).toBe(404);
});
