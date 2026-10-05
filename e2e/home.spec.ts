import { expect, test } from "./fixtures";
import { CONTACT_EMAIL, SOURCE_URL } from "@/ui/site";

test("home page renders the Monster Paws landing", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /monster paws/i })).toBeVisible();
  await expect(
    page.getByText("100% of every donation goes to the shelter"),
  ).toBeVisible();
});

// AGPL-3.0 section 13 asks the running site to offer its source; the footer is
// how every page does it, so it is checked on more than the home page.
for (const path of ["/", "/animals", "/claim"]) {
  test(`${path} carries the footer: contact address and the source link`, async ({ page }) => {
    await page.goto(path);
    const footer = page.getByRole("contentinfo");
    const source = footer.getByRole("link", { name: /source on github/i });
    await expect(source).toHaveAttribute("href", SOURCE_URL);
    await expect(source).toHaveAttribute("target", "_blank");
    await expect(source).toHaveAttribute("rel", /noopener/);
    // Inner pages go home through the wordmark, never an arrow that reads as "back to the list".
    if (path !== "/") {
      await expect(page.getByRole("link", { name: "Monster Paws home" })).toHaveAttribute("href", "/");
      await expect(page.getByText("← Monster Paws")).toHaveCount(0);
    }
    // e2e runs the production build, where `/design` 404s (ADR-0016): no link to it.
    await expect(page.getByRole("link", { name: /^design$/i })).toHaveCount(0);
    await expect(footer.getByRole("link", { name: new RegExp(CONTACT_EMAIL) })).toHaveAttribute(
      "href",
      `mailto:${CONTACT_EMAIL}`,
    );
  });
}

// One look before launch (ADR-0016 as amended 2026-10-02): a dark OS must not darken the site.
test("a visitor whose OS prefers dark still gets the light ground", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).toBe("rgb(250, 244, 232)");
});

// Tailwind v4's preflight leaves buttons on the default arrow; globals.css puts the hand back.
test("buttons and filter dropdowns show the pointer cursor", async ({ page }) => {
  await page.goto("/animals");
  for (const control of [page.getByRole("button", { name: /show me/i }), page.locator("select").first()]) {
    await expect(control).toHaveCSS("cursor", "pointer");
  }
});
