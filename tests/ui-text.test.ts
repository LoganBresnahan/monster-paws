import { describe, expect, it } from "vitest";
import { decodeEntities, tidyWhitespace } from "@/ui/text";

/**
 * Cases taken from the 2026-09-04 RescueGroups corpus (ADR-0018), where 72% of
 * descriptions are entity-encoded and none contain a tag.
 */
describe("decodeEntities", () => {
  it("decodes the entities the corpus actually contains", () => {
    expect(decodeEntities("I&#39;m a chill girl.&nbsp;")).toBe("I'm a chill girl. ");
    expect(decodeEntities("Angels &amp; Us &mdash; 12&frac12; lbs")).toBe("Angels & Us — 12½ lbs");
    expect(decodeEntities("she&rsquo;s &ldquo;perfect&rdquo;")).toBe("she’s “perfect”");
    expect(decodeEntities("line&#10;break")).toBe("line\nbreak");
    expect(decodeEntities("&#x1F415; hex")).toBe("🐕 hex");
  });

  it("leaves an unknown name standing rather than guessing a character", () => {
    expect(decodeEntities("100&percnt; good &nonsense; dog")).toBe("100&percnt; good &nonsense; dog");
  });

  it("never throws on a malformed numeric entity", () => {
    expect(decodeEntities("&#999999999; &#xZZ; &#0;")).toBe("&#999999999; &#xZZ; &#0;");
    expect(decodeEntities("&#55296;")).toBe("&#55296;"); // lone surrogate
  });

  // The output is a text node, never markup: this is what keeps decoding
  // someone else's prose from being an injection (ADR-0018).
  it("decodes markup into characters, not into tags", () => {
    expect(decodeEntities("&lt;script&gt;")).toBe("<script>");
  });
});

describe("tidyWhitespace", () => {
  it("collapses blank runs to one blank line and strips trailing space", () => {
    expect(tidyWhitespace("A dog.   \n\n\n\n\nA cat.")).toBe("A dog.\n\nA cat.");
    // The document's own edges are trimmed; indentation INSIDE it is not (below).
    expect(tidyWhitespace("  padded  \n")).toBe("padded");
  });

  // The 4,000px listing: every gap in it was a line holding one `&nbsp;`.
  it("removes lines that decoding left holding only a non-breaking space", () => {
    expect(tidyWhitespace(decodeEntities("Story.&nbsp;\n&nbsp;\n&nbsp;\n&nbsp;\nMore."))).toBe(
      "Story.\n\nMore.",
    );
  });

  it("leaves the shelter's own formatting inside a line alone", () => {
    expect(tidyWhitespace("Fees:\n  Kitten    $125\n  Cat       $75")).toBe(
      "Fees:\n  Kitten    $125\n  Cat       $75",
    );
  });
});
