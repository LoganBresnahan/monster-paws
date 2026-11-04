import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PrivacyPage from "@/app/privacy/page";

/** Logan approved these words on 2026-11-04, "approved, for the wording": change them only with him (ADR-0035 question 7, ADR-0036). */
describe("the privacy page", () => {
  const text = renderToStaticMarkup(PrivacyPage())
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'");

  it("says a painting should arrive, that rare errors can stop one, and where to write", () => {
    expect(text).toContain(
      "The painting is our thank-you, and it should reach your inbox once it's ready. In rare cases, an error or something out of our control can stop one being made or sent. If that happens, write to hello@monsterpaws.org and we'll sort it out. Your donation goes to the shelter either way.",
    );
  });

  it("says what a share page shows and when it comes down (ADR-0036)", () => {
    expect(text).toContain(
      "The painting also gets its own page, so you can share it. Anyone with the link can open that page. It shows the painting and the animal's name, and nothing about you. We take it down if you ask, or if the shelter withdraws permission. Paintings we've already emailed you stay in your inbox either way.",
    );
  });

  it("never promises a painting flatly after a shelter withdraws", () => {
    expect(text).toContain("For a donation already made, we still try to paint our thank-you");
    expect(text).not.toContain("still gets its painting");
  });

  it("says donation, and never that a painting is the donor's", () => {
    expect(text).not.toMatch(/\bgifts?\b/i);
    expect(text).not.toContain("Your painting");
    expect(text).not.toContain("stay yours");
  });
});
