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

test.describe("ADR-0015 browse filters — counts as you pick", () => {
  // The island and the server run the same facetOptions over the same grid;
  // this is the check that they really do (ADR-0015 as amended 2026-10-04).
  // Picks a STATE, not a kind: the seed is one species, so narrowing by kind
  // changes nothing, while every state holds only part of the herd.
  test("picking a state recounts the Kind menu to exactly what Show me renders", async ({ page }) => {
    await page.goto("/animals");
    const kinds = page.locator("select[name=species] option");
    const everyKind = await kinds.allTextContents();

    const state = (await page.locator("select[name=state] option").allTextContents()).at(1)!;
    await page.locator("select[name=state]").selectOption({ label: state });
    const live = await kinds.allTextContents();
    // The positive control: an island that never recounted would pass the equality below alone.
    expect(live).not.toEqual(everyKind);

    await page.getByRole("button", { name: /show me/i }).click();
    await page.waitForURL(/state=/);
    expect(await kinds.allTextContents()).toEqual(live);
  });

  // Clear is a client navigation that keeps the island mounted; without the
  // key on the URL's filters, its picks outlived the reset.
  test("Clear resets both menus, and Back restores the pick", async ({ page }) => {
    await page.goto("/animals");
    const state = (await page.locator("select[name=state] option").allTextContents()).at(1)!;
    await page.locator("select[name=state]").selectOption({ label: state });
    await page.getByRole("button", { name: /show me/i }).click();
    await page.waitForURL(/state=/);

    await page.getByRole("link", { name: "Clear" }).click();
    await page.waitForURL((url) => url.search === "");
    await expect(page.locator("select[name=state]")).toHaveValue("");
    await expect(page.locator("select[name=species]")).toHaveValue("");

    await page.goBack();
    await page.waitForURL(/state=/);
    await expect(page.locator("select[name=state] option:checked")).toHaveText(state);
  });

  // Newest first is the default; longest waiting is one deliberate pick away,
  // and the order survives "Next" (ADR-0015 as amended 2026-10-05).
  test("sorts newest first by default, and longest waiting on request", async ({ page }) => {
    await page.goto("/animals");
    await expect(page.locator("select[name=sort]")).toHaveValue("newest");
    const listedDates = async () =>
      (await page.locator("main a[href^='/animals/'] p:has-text('Listed ')").allTextContents()).map((t) =>
        new Date(t.replace(/^Listed /, "").split(" · ")[0]).getTime(),
      );
    const newest = await listedDates();
    expect(newest).toEqual([...newest].sort((a, b) => b - a));

    await page.locator("select[name=sort]").selectOption("longest");
    await page.getByRole("button", { name: /show me/i }).click();
    await page.waitForURL(/sort=longest/);
    const longest = await listedDates();
    expect(longest).toEqual([...longest].sort((a, b) => a - b));
    expect(longest).not.toEqual(newest);
  });
});
