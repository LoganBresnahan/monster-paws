import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The one invariant that keeps a stranger's payment handle from becoming a
 * click (ADR-0015 as amended 2026-09-04). Descriptions are quoted verbatim and
 * 0.76% of them carry a PayPal.me or Venmo handle; they are harmless only
 * while they render as TEXT.
 *
 * This reads the source rather than the DOM on purpose: the failure mode is a
 * future contributor adding autolinking as an improvement, and that edit is
 * visible here whether or not any fixture happens to contain a URL. Phase 4's
 * e2e asserts the rendered half — zero anchors inside the quotation.
 */
/**
 * Comment lines are excluded, because the comments here WARN about the very
 * strings being searched for — `src/ui/text.ts` tells the reader never to feed
 * decoded text to `dangerouslySetInnerHTML`, and a naive grep fails on the
 * warning instead of on the danger.
 */
function codeOf(source: string): string {
  return source
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/?\*)/.test(line))
    .join("\n");
}

const RENDERERS = [
  "src/app/animals/[id]/page.tsx",
  "src/ui/animal-gallery.tsx",
  "src/ui/animal.tsx",
  "src/ui/text.ts",
];

describe("ADR-0015: source prose is never linkified", () => {
  it.each(RENDERERS)("%s injects no markup and autolinks nothing", (path) => {
    const source = codeOf(readFileSync(path, "utf8"));

    expect(source).not.toContain("dangerouslySetInnerHTML");
    // `linkify`, `autolink`, `<a href={` built from description text — any of
    // these is the change this test exists to catch.
    expect(source.toLowerCase()).not.toMatch(/linkif|autolink/);
  });

  it("renders the description through a plain text node", () => {
    const page = codeOf(readFileSync("src/app/animals/[id]/page.tsx", "utf8"));
    // The exact call, so a refactor that routes description through anything
    // else has to come here and say why.
    expect(page).toContain("{tidyWhitespace(decodeEntities(licensed.description))}");
  });
});
