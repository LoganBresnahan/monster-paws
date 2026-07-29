import { expect, test } from "@playwright/test";

test("home page renders the Monster Paws landing", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /monster paws/i })).toBeVisible();
  await expect(page.getByText(/100% .* shelter/i)).toBeVisible();
});
