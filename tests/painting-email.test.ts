import { describe, expect, it } from "vitest";
import { emailLinkOrigin, renderPaintingEmail, type PaintingEmailInput } from "@/core/email/painting-email";

const input: PaintingEmailInput = {
  to: "pat@example.org",
  sendKey: "tok123",
  animalName: "Beetle",
  paintings: [Buffer.from("1"), Buffer.from("2"), Buffer.from("3"), Buffer.from("4")],
  shareToken: "tok123",
  unsubscribeToken: "uns456",
  origin: "https://monsterpaws.org",
};

describe("the painting email (ADR-0027 as amended 2026-11-02, ADR-0035)", () => {
  const mail = renderPaintingEmail(input);

  it("carries all four paintings inline, each attached under its own file name", () => {
    expect(mail.attachments.map((a) => a.filename)).toEqual([
      "beetle-painting-1.jpg",
      "beetle-painting-2.jpg",
      "beetle-painting-3.jpg",
      "beetle-painting-4.jpg",
    ]);
    for (const attachment of mail.attachments) {
      expect(attachment.contentType).toBe("image/jpeg");
      expect(mail.html).toContain(`src="cid:${attachment.contentId}"`);
    }
    expect(mail.text).toContain("attached");
  });

  it("states no amount, never says money arrived, and never says choose one", () => {
    const words = `${mail.subject} ${mail.text} ${mail.html}`.toLowerCase();
    expect(words).not.toMatch(/\$\d|\bamount\b|received|your donation|choose|pick one|favou?rite/);
  });

  it("never says gift, and never that a painting is theirs (Logan, 2026-11-04)", () => {
    for (const variant of [mail, renderPaintingEmail({ ...input, animalName: "A310627" })]) {
      expect(`${variant.subject} ${variant.text} ${variant.html}`.toLowerCase()).not.toMatch(/\bgifts?\b|yours|your painting|to keep/);
    }
  });

  it("uses Logan's approved words", () => {
    expect(mail.subject).toBe("We painted Beetle to say thank you");
    expect(mail.text).toContain("We painted Beetle four ways as our thank-you.");
    expect(mail.text).toContain("They're attached to this email too.");
    expect(mail.html).toContain("You can view the paintings here");
    expect(mail.text).toContain("We sent this because this address was entered when a donation to Beetle's shelter was started on Monster Paws.");
  });

  it("opens with a title, and the plain text reads whole without it", () => {
    expect(mail.html).toMatch(/<h1 [^>]*font-size: 28px[^>]*>Thank you for thinking of Beetle\.<\/h1>/);
    expect(mail.text.startsWith("Thank you for thinking of Beetle. We painted Beetle four ways as our thank-you.")).toBe(true);
  });

  it("says why this address got it, in the text and the HTML", () => {
    const why = "We sent this because this address was entered when a donation to Beetle's shelter was started on Monster Paws.";
    expect(mail.text).toContain(why);
    expect(mail.html).toContain(why.replaceAll("'", "&#39;"));
  });

  it("has a Share button to the keepsake's page, and none without a token, never a dead link", () => {
    expect(mail.html).toContain('href="https://monsterpaws.org/share/tok123"');
    expect(mail.text).toContain("https://monsterpaws.org/share/tok123");
    const none = renderPaintingEmail({ ...input, shareToken: null });
    expect(none.html).not.toContain("/share/");
    expect(none.text).not.toContain("/share/");
    expect(none.html).not.toContain("You can view the paintings here");
  });

  it("has a one-click unsubscribe header and a link in the body, both to the same URL", () => {
    const url = "https://monsterpaws.org/unsubscribe/uns456";
    expect(mail.headers).toEqual({ "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    expect(mail.html).toContain(`href="${url}"`);
    expect(mail.text).toContain(url);
  });

  it("is byte-identical on a retry, or Resend refuses the same key as a different body", () => {
    expect(renderPaintingEmail(input)).toEqual(mail);
    expect(mail.idempotencyKey).toBe("painting-email-tok123");
  });

  it("escapes a listing's name in the HTML and keeps a usable file name", () => {
    const odd = renderPaintingEmail({ ...input, animalName: `<b>Mr. "Paws"</b>` });
    expect(odd.html).not.toContain("<b>Mr");
    expect(odd.attachments[0].filename).toBe("b-mr-paws-b-painting-1.jpg");
    expect(renderPaintingEmail({ ...input, animalName: "🐾" }).attachments[0].filename).toBe("monster-paws-painting-1.jpg");
  });
});

describe("a listing's name in the email", () => {
  it("drops a listing's notes everywhere the name goes", () => {
    const mail = renderPaintingEmail({ ...input, animalName: "Sparrow (Courtesy Post) Foster or Adopt Me!" });
    expect(mail.subject).toBe("We painted Sparrow to say thank you");
    expect(mail.attachments[0].filename).toBe("sparrow-painting-1.jpg");
    expect(`${mail.text} ${mail.html}`).not.toMatch(/courtesy|adopt me/i);
  });

  it("uses no name at all when none survives, and still sends the paintings", () => {
    const mail = renderPaintingEmail({ ...input, animalName: "URGENT FOSTER HOMES NEEDED FOR CATS" });
    expect(mail.subject).toBe("We painted your chosen animal to say thank you");
    expect(mail.attachments).toHaveLength(4);
    expect(mail.text).toContain("the animal you chose");
    expect(mail.text).toContain("a donation to a shelter was started");
    expect(`${mail.subject} ${mail.text} ${mail.html}`).not.toMatch(/urgent|null|undefined/i);
  });
});

describe("the email's link origin", () => {
  it("defaults to the site, takes config, and drops a trailing slash", () => {
    expect(emailLinkOrigin({})).toBe("https://monsterpaws.org");
    expect(emailLinkOrigin({ EMAIL_LINK_ORIGIN: "http://localhost:3000/" })).toBe("http://localhost:3000");
  });
});
