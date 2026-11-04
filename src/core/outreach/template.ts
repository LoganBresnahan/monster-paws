import type { EveryorgClaim } from "@/db/schema";

/**
 * The one ask, rendered per shelter (ADR-0029 §3). Every sentence here is an
 * obligation a test pins by presence or absence; change the wording and run
 * `tests/outreach-template.test.ts` before `preview`. Logan reads the
 * rendered ask in Mailpit before any shelter does (ADR-0029 as amended
 * 2026-10-27: no lawyer's read).
 */
export interface AskShelter {
  name: string | null;
  city: string | null;
  state: string | null;
  visibleCount: number;
  /** the live shelter view on monsterpaws.org */
  shelterViewUrl: string;
}

export interface AskInput {
  shelter: AskShelter;
  /** from `shelter_nonprofits.everyorg_claim`; `unknown` when there is no match yet */
  claim: EveryorgClaim;
  /** the shelter's Every.org page when matched, for the claim line */
  everyorgProfileUrl: string | null;
  /**
   * Why it is this week — the hackathon as timing, never as endorsement. An
   * input, not a constant: a wave after the deadline renders without it
   * (ADR-0028).
   */
  timing: { event: string; until: string } | null;
  sender: { name: string; role: string; email: string };
  origin?: string;
}

export interface RenderedAsk {
  subject: string;
  text: string;
  html: string;
}

export const DEFAULT_ORIGIN = "https://monsterpaws.org";

/** Our own painting, hosted by us — never a stored copy of a shelter's listing photo (ADR-0029 §3); never move `src/app/opengraph-image.jpg`, since mail already sent keeps loading this URL. */
export const ASK_IMAGE = { path: "/opengraph-image.jpg", alt: "Beetle, a bloodhound, painted in watercolour: a Monster Paws painting." };

/** Every URL in the prose is a link in the HTML, so a reader taps it; the text part keeps the bare URL. Runs on escaped text. */
function linkify(escaped: string): string {
  return escaped.replace(/https?:\/\/[^\s<]+?(?=[.,;:)]*(?:\s|$|<))/g, (url) => `<a href="${url}">${url}</a>`);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** What a person would call the shelter: a listing's own name can carry a legal wrapper and stray spaces ("Ruff Redemption Rescue, Inc ", "Animal House Project dba SafeHaven Animal Rescue Team", found 2026-11-02). */
function spokenName(name: string): string {
  const dba = name.split(/\s+d\/?b\/?a\s+/i);
  return dba[dba.length - 1].trim().replace(/[,\s]+(inc|nfp|llc)\.?$/i, "").trim();
}

function animals(count: number): string {
  return count === 1 ? "1 adoptable animal" : `${count} adoptable animals`;
}

export function renderAsk(input: AskInput): RenderedAsk {
  const origin = input.origin ?? DEFAULT_ORIGIN;
  const { shelter, sender } = input;
  const name = spokenName(shelter.name ?? "your shelter");
  const where = [shelter.city, shelter.state].filter(Boolean).join(", ");

  const subject = `${name} on Monster Paws — ${animals(shelter.visibleCount)}, and a question`;

  const paint = `May we paint your animals from the photos in your listings? The paintings are made with AI image tools, which means the photos are sent to third-party services to be processed. You can withdraw at any time. If you say yes, I'd also ask you to confirm the photos are yours to license — shelter photos often come from volunteers, fosters and adopters.`;

  const paragraphs: { text: string; link?: string }[] = [
    { text: /\bteam$/i.test(name) ? `Hi ${name},` : `Hi ${name} team,` },
    {
      text: `I'm ${sender.name}, ${sender.role} of Monster Paws (${origin}), a small project in Chicago that helps people sponsor shelter animals. Every donation goes to the shelter. We keep $0.`,
    },
    {
      text: `Right now ${animals(shelter.visibleCount)} of yours ${shelter.visibleCount === 1 ? "is" : "are"} on the site through your RescueGroups listings, each linking back to you${where ? ` in ${where}` : ""}:`,
      link: shelter.shelterViewUrl,
    },
    {
      text: `The idea: a donor picks one of your animals and gives what they like to you. As our thank-you, we try to send them a small painting of that animal. You can see it with our own pets at ${origin}/#crew, and walk through the whole thing at ${origin}/demo.`,
    },
  ];

  // Never mention Every.org to a shelter that has claimed its profile: there is nothing to ask of it (ADR-0029 §3; Logan, 2026-11-02).
  if (input.claim === "claimed") {
    paragraphs.push({ text: "One thing I'd like to ask:" }, { text: paint });
  } else {
    paragraphs.push(
      { text: "Two things I'd like to ask:" },
      { text: `1. ${paint}` },
      {
        text: `2. Could you claim your free Every.org profile? Every.org is how a donation reaches you, and it takes card donations only for a nonprofit that has claimed its profile. It takes a few minutes, and it gives you donate buttons and payouts for every donor, not only ours:`,
        link: input.everyorgProfileUrl ?? "https://www.every.org/nonprofits",
      },
    );
  }

  paragraphs.push({
    text: `One plain term, so there is no surprise later: if you withdraw permission, we stop taking donations for your animals and take down their public pages. For a donation already made, we still try to paint our thank-you, and we delete the photos once that's done. Paintings already sent, with the animal's name, breed and age, can't be recalled.`,
  });

  if (input.timing) {
    paragraphs.push({
      text: `Why this week: we are building this as our entry in ${input.timing.event}, which runs until ${input.timing.until}, so I'm writing to shelters now. That is our deadline, not anyone's endorsement of us.`,
    });
  }

  paragraphs.push(
    { text: `If you'd rather not be on the site at all, reply "remove" and we take your listings down.` },
    { text: "Thanks for reading, and for the work you do." },
    { text: `${sender.name}\n${sender.role}, Monster Paws\n${sender.email}` },
  );

  const text = paragraphs.map((p) => (p.link ? `${p.text}\n${p.link}` : p.text)).join("\n\n");

  const html = [
    `<!doctype html><html><body style="font-family: Georgia, serif; font-size: 16px; line-height: 1.5; color: #2b2320; max-width: 36em; margin: 0 auto; padding: 1em;">`,
    ...paragraphs.map((p) => {
      const body = linkify(escapeHtml(p.text)).replace(/\n/g, "<br>");
      const link = p.link ? `<br><a href="${escapeHtml(p.link)}">${escapeHtml(p.link)}</a>` : "";
      return `<p>${body}${link}</p>`;
    }),
    `<p><img src="${origin}${ASK_IMAGE.path}" alt="${escapeHtml(ASK_IMAGE.alt)}" width="480" style="max-width: 100%; height: auto; border-radius: 8px;"></p>`,
    `</body></html>`,
  ].join("\n");

  return { subject, text, html };
}
