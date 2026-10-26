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

// A placeholder end to end: no money moves and nothing is stored, so the walk
// through is the whole contract (DIRECTION.md, bright lines).
test("the demo walks a crew pet from pick to adoption day", async ({ page }) => {
  await page.goto("/demo");
  await expect(page.getByText("Demo: no money moves")).toBeVisible();
  await page.getByRole("button", { name: "Sponsor Beetle" }).click();

  const donate = page.getByRole("button", { name: /^Donate/ });
  await expect(donate).toHaveText("Donate $10");
  const other = page.getByLabel("Another amount, in dollars");
  await other.fill("0");
  await expect(donate).toBeDisabled();
  await other.fill("1");
  await expect(donate).toHaveText("Donate $1");
  await donate.click();

  await expect(page.getByText("Painting Beetle's keepsake")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Beetle's keepsake is here 🎉" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("$1 to her shelter")).toBeVisible();

  await page.getByRole("button", { name: "What happens next →" }).click();
  await page.getByRole("button", { name: "Show the first update" }).click();
  await page.getByRole("button", { name: "Next update" }).click();
  await page.getByRole("button", { name: "Next update" }).click();
  await expect(page.getByText("✓ Confirmed by the shelter")).toHaveCount(3);
  await page.getByRole("button", { name: "Adoption day 🎉" }).click();
  await expect(page.getByText("Beetle was adopted today. You were part of that.")).toBeVisible();
  await expect(page.getByRole("link", { name: "See adoptable animals" })).toHaveAttribute("href", "/animals");

  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page.getByRole("heading", { name: "Who would you like to sponsor?" })).toBeVisible();
});
