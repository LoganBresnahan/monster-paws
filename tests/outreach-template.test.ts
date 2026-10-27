import { describe, expect, it } from "vitest";
import { mailpitMessageBody, mailpitMessages } from "@/core/outreach/mailpit";
import { renderAsk, type AskInput } from "@/core/outreach/template";
import { mailpitTransport } from "@/core/outreach/transport";
import { SKIP_DB_TESTS } from "./support/db";

/**
 * The ask's obligations, one assertion each (ADR-0029 §3; ADR-0004 as
 * amended 2026-08-02 §2; ADR-0022 §5; ADR-0002 as amended 2026-10-26;
 * ADR-0028). A clause here is a promise made to a shelter, so a wording
 * change that drops one fails before `preview` runs.
 */
const base: AskInput = {
  shelter: {
    name: "Quiet Hollow Rescue",
    city: "Northbrook",
    state: "IL",
    visibleCount: 12,
    shelterViewUrl: "https://monsterpaws.org/animals?shelter=rescuegroups%3Aorg%3A77",
  },
  claim: "unclaimed",
  everyorgProfileUrl: "https://www.every.org/quiet-hollow-rescue",
  timing: { event: "the Meta Global AI Developer Hackathon", until: "4 November 2026" },
  sender: { name: "Logan Bresnahan", role: "founder", email: "logan@example.org" },
};

describe("ADR-0029 the ask", () => {
  const ask = renderAsk(base);

  it("says who we are and that we keep $0, and names their count with the live link", () => {
    expect(ask.subject).toBe("Quiet Hollow Rescue on Monster Paws — 12 adoptable animals, and a question");
    expect(ask.text).toContain("Every donation goes to the shelter. We keep $0.");
    expect(ask.text).toContain("12 adoptable animals of yours are on the site through your RescueGroups listings");
    expect(ask.text).toContain("in Northbrook, IL");
    expect(ask.text).toContain("https://monsterpaws.org/animals?shelter=rescuegroups%3Aorg%3A77");
  });

  it("shows the crew and the demo as the example, by link to our site", () => {
    expect(ask.text).toContain("https://monsterpaws.org/#crew");
    expect(ask.text).toContain("https://monsterpaws.org/demo");
  });

  it("asks to paint from the listing photos, says they go to third-party AI services, stoppable, and asks about the rights (ADR-0004 §2)", () => {
    expect(ask.text).toContain("May we paint your animals from the photos in your listings?");
    expect(ask.text).toContain("sent to third-party services to be processed");
    expect(ask.text).toContain("You can stop this at any time");
    expect(ask.text).toContain("confirm the photos are yours to license");
  });

  it("states the retention term up front: keepsakes already given stay with those donors (ADR-0022 §5)", () => {
    expect(ask.text).toContain(
      "keepsakes already given to donors — the animal's name, breed, age, photo and artwork — stay with those donors",
    );
  });

  it("carries the claim line, with the profile link, when the profile is unclaimed or unknown — and not when claimed", () => {
    expect(ask.text).toContain("Could you claim your free Every.org profile?");
    expect(ask.text).toContain("https://www.every.org/quiet-hollow-rescue");

    const unknown = renderAsk({ ...base, claim: "unknown", everyorgProfileUrl: null });
    expect(unknown.text).toContain("Could you claim your free Every.org profile?");
    expect(unknown.text).toContain("https://www.every.org/nonprofits");

    const claimed = renderAsk({ ...base, claim: "claimed" });
    expect(claimed.text).not.toContain("Could you claim");
    expect(claimed.text).toContain("your Every.org profile is already claimed");
  });

  it("names the hackathon as timing and never as endorsement, and only while it is on (ADR-0028)", () => {
    expect(ask.text).toContain("our entry in the Meta Global AI Developer Hackathon, which runs until 4 November 2026");
    expect(ask.text).toContain("not anyone's endorsement of us");
    const after = renderAsk({ ...base, timing: null });
    expect(after.text).not.toMatch(/hackathon/i);
    expect(after.text).not.toMatch(/Meta/);
  });

  it("offers the way out in their own one word", () => {
    expect(ask.text).toContain(`reply "remove" and we take your listings down`);
  });

  it("signs as a person", () => {
    expect(ask.text.trimEnd().endsWith("Logan Bresnahan\nfounder, Monster Paws\nlogan@example.org")).toBe(true);
  });

  it("reads whole as plain text — no markup — and the HTML says the same sentences", () => {
    expect(ask.text).not.toMatch(/<[a-z]/i);
    for (const sentence of [
      "We keep $0.",
      "sent to third-party services to be processed",
      "stay with those donors",
      `reply "remove"`,
    ]) {
      expect(ask.html).toContain(sentence.replace(/"/g, "&quot;"));
    }
  });

  it("loads images only from monsterpaws.org, and never a listing's photo", () => {
    const sources = [...ask.html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
    expect(sources).toEqual(["https://monsterpaws.org/brand/crew/beetle-painting.jpg"]);
    expect(ask.html).not.toMatch(/rescuegroups\.org|cloudfront|cloudinary/);
  });

  it("escapes a shelter's name in HTML, and reads one animal in the singular", () => {
    const one = renderAsk({ ...base, shelter: { ...base.shelter, name: "Paws & Claws <Rescue>", visibleCount: 1 } });
    expect(one.subject).toContain("1 adoptable animal, and a question");
    expect(one.text).toContain("1 adoptable animal of yours is on the site");
    expect(one.html).toContain("Paws &amp; Claws &lt;Rescue&gt;");
    expect(one.html).not.toContain("<Rescue>");
  });

  it.skipIf(SKIP_DB_TESTS)("lands in Mailpit as a preview would, both parts intact", async () => {
    const stamp = `ask-preview-${Date.now()}`;
    const rendered = renderAsk({ ...base, shelter: { ...base.shelter, name: stamp } });
    const sent = await mailpitTransport().send({
      from: `${base.sender.name} <${base.sender.email}>`,
      to: "preview@example.org",
      ...rendered,
    });
    const landed = (await mailpitMessages()).find((m) => `<${m.MessageID}>` === sent.messageId);
    expect(landed?.Subject).toBe(rendered.subject);
    const body = await mailpitMessageBody(landed!.ID);
    expect(body.Text).toContain("We keep $0.");
    expect(body.HTML).toContain("https://monsterpaws.org/brand/crew/beetle-painting.jpg");
  });

  it("writes to a shelter whose name nobody published without inventing one", () => {
    const nameless = renderAsk({ ...base, shelter: { ...base.shelter, name: null, city: null, state: null } });
    expect(nameless.text).toContain("Hi your shelter team,");
    expect(nameless.text).not.toContain(" in ,");
  });
});
