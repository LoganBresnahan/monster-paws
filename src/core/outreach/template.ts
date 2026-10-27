import type { EveryorgClaim } from "@/db/schema";

/**
 * The one ask, rendered per shelter (ADR-0029 §3). Every sentence here is an
 * obligation a test pins by presence or absence; change the wording and run
 * `tests/outreach-template.test.ts` before `preview`. A lawyer reads the
 * rendered ask before any shelter does (ADR-0028).
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

/** Our own painting, hosted by us — never a stored copy of a shelter's listing photo (ADR-0029 §3). */
export const ASK_IMAGE = { path: "/brand/crew/beetle-painting.jpg", alt: "A watercolour keepsake of Beetle, one of our own dogs — the face of Monster Paws" };

/** Every URL in the prose is a link in the HTML, so a reader taps it; the text part keeps the bare URL. Runs on escaped text. */
function linkify(escaped: string): string {
  return escaped.replace(/https?:\/\/[^\s<]+?(?=[.,;:)]*(?:\s|$|<))/g, (url) => `<a href="${url}">${url}</a>`);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function animals(count: number): string {
  return count === 1 ? "1 adoptable animal" : `${count} adoptable animals`;
}

export function renderAsk(input: AskInput): RenderedAsk {
  const origin = input.origin ?? DEFAULT_ORIGIN;
  const { shelter, sender } = input;
  const name = shelter.name ?? "your shelter";
  const where = [shelter.city, shelter.state].filter(Boolean).join(", ");

  const subject = `${name} on Monster Paws — ${animals(shelter.visibleCount)}, and a question`;

  const paragraphs: { text: string; link?: string }[] = [
    { text: `Hi ${name} team,` },
    {
      text: `I'm ${sender.name}, ${sender.role} of Monster Paws (${origin}), a small project in Chicago that helps people sponsor shelter animals. Every donation goes to the shelter. We keep $0.`,
    },
    {
      text: `Right now ${animals(shelter.visibleCount)} of yours ${shelter.visibleCount === 1 ? "is" : "are"} on the site through your RescueGroups listings, each linking back to you${where ? ` in ${where}` : ""}:`,
      link: shelter.shelterViewUrl,
    },
    {
      text: `The idea: a donor picks one of your animals, gives what they like, and gets a small painted keepsake of that animal. You can see it with our own pets at ${origin}/#crew, and walk through the whole thing at ${origin}/demo.`,
    },
    { text: "Two things I'd like to ask:" },
    {
      text: `1. May we paint your animals from the photos in your listings? The paintings are made with AI image tools, which means the photos are sent to third-party services to be processed. You can stop this at any time, and we take the paintings down. If you say yes, I'd also ask you to confirm the photos are yours to license — shelter photos often come from volunteers, fosters and adopters.`,
    },
  ];

  if (input.claim !== "claimed") {
    paragraphs.push({
      text: `2. Could you claim your free Every.org profile? Every.org is how a donation reaches you, and it takes card donations only for a nonprofit that has claimed its profile. It takes a few minutes, and it gives you donate buttons and payouts for every donor, not only ours:`,
      link: input.everyorgProfileUrl ?? "https://www.every.org/nonprofits",
    });
  } else {
    paragraphs.push({
      text: `2. Nothing — your Every.org profile is already claimed, so donations can reach you today. Thank you for that.`,
    });
  }

  paragraphs.push({
    text: `One plain term, so there is no surprise later: if you withdraw permission, we stop painting, take the paintings down and delete the photos we painted from, but keepsakes already given to donors — the animal's name, breed, age and painting — stay with those donors.`,
  });

  if (input.timing) {
    paragraphs.push({
      text: `Why this week: we are building this as our entry in ${input.timing.event}, which runs until ${input.timing.until}, so I'm writing to Chicago-area shelters now. That is our deadline, not anyone's endorsement of us.`,
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
