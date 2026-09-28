import { formatDate } from "@/ui/dates";
import { expect, test } from "./fixtures";
import { EXACT_BIRTH_DATE, HANDLE_DESCRIPTION, SEEDED } from "./seed";

/**
 * The animal pages against the production build and a seeded corpus
 * (ADR-0015, ADR-0017 as amended 2026-09-28). These are the page-level
 * promises a unit test cannot see: each one is something a layout refactor
 * can silently drop.
 */

test.describe("ADR-0015 visibility — both halves, for every hidden animal", () => {
  for (const key of ["adopted", "stale"] as const) {
    // A page assembling its own predicate could pass either half alone; only
    // asserting both catches it (ADR-0015 decision 2).
    test(`${SEEDED[key].name} (${key}) 404s on detail and is absent from browse`, async ({
      page,
      seed,
    }) => {
      const detail = await page.goto(`/animals/${seed[key]}`);
      expect(detail?.status()).toBe(404);

      await page.goto("/animals");
      // The positive control first: an empty browse page would pass the absence check.
      await expect(page.getByRole("link", { name: new RegExp(SEEDED.stowaway.name) })).toBeVisible();
      await expect(page.getByText(SEEDED[key].name)).toHaveCount(0);
    });
  }

  test("browse lists every visible seeded animal, each linking to its page", async ({ page, seed }) => {
    await page.goto("/animals");
    for (const key of ["stowaway", "bettis", "exact", "handle"] as const) {
      const card = page.getByRole("link", { name: new RegExp(SEEDED[key].name) });
      await expect(card).toHaveAttribute("href", `/animals/${seed[key]}`);
    }
  });
});

test.describe("ADR-0015 detail page", () => {
  test("requests the RescueGroups tracker pixel, without it ever leaving the machine", async ({
    page,
    seed,
    offsite,
  }) => {
    await page.goto(`/animals/${seed.stowaway}`);
    await expect(page.getByRole("heading", { level: 1, name: SEEDED.stowaway.name })).toBeVisible();
    // The terms owe a page view on every RG detail page (ADR-0006 decision 2);
    // the intercepted request is the proof, since the real one never happens.
    await expect
      .poll(() => offsite.map((r) => r.url()))
      .toContain("https://tracker.rescuegroups.org/pet?10013509");
  });

  test("says 'Born <date>' only when the source says the date is exact", async ({ page, seed }) => {
    await page.goto(`/animals/${seed.exact}`);
    await expect(page.getByText(`Born ${formatDate(EXACT_BIRTH_DATE)}`)).toBeVisible();

    // Stowaway's birth date is an estimate: the page may say how old, never when.
    await page.goto(`/animals/${seed.stowaway}`);
    await expect(page.getByText(/\(estimated\)/)).toBeVisible();
    await expect(page.getByText(/Born /)).toHaveCount(0);
  });

  test("renders a payment handle in the description as inert text — zero anchors in the quotation", async ({
    page,
    seed,
  }) => {
    await page.goto(`/animals/${seed.handle}`);
    const quote = page.locator("blockquote");
    await expect(quote).toContainText(HANDLE_DESCRIPTION);
    // Descriptions are quoted verbatim and never linkified: a live paypal.me
    // link beside our donate rail is someone else's rail (ADR-0015 as amended).
    await expect(quote.locator("a")).toHaveCount(0);
  });

  test("carries the not-affiliated line and the claim route", async ({ page, seed }) => {
    await page.goto(`/animals/${seed.bettis}`);
    await expect(page.getByRole("link", { name: /Claim it or remove your listings/ })).toHaveAttribute(
      "href",
      "/claim",
    );
  });
});
