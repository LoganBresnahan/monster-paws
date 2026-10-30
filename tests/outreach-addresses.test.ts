import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  USER_AGENT,
  contactLinks,
  extractAddresses,
  findAddresses,
  isAddress,
  parseRobots,
  politeFetcher,
  robotsAllows,
  siteOrigin,
  type FetchedPage,
  type PageFetcher,
} from "@/core/outreach/addresses";
import { confirmAddress, confirmedAddress, contactsOf, recordAddressCandidates } from "@/core/outreach/contacts";
import { closeDb, type Db } from "@/db/client";
import { SKIP_DB_TESTS, testDb, truncateOutreach } from "./support/db";

/**
 * The address finder on HTML strings and a scripted site (ADR-0029 §2): what
 * it reads, what it refuses, that it obeys robots.txt and paces itself, and
 * that nothing it finds is an address to send to until a person confirms it.
 */

describe("ADR-0029 address extraction", () => {
  it("reads mailto links, plain addresses, entities and the usual obfuscations, each once, lowercased", () => {
    const html = `
      <a href="mailto:Adopt@QuietHollow.org?subject=Hi">Email us</a>
      <p>Or write to info@quiethollow.org, or volunteers [at] quiethollow [dot] org.</p>
      <p>Fosters: foster (at) quiethollow (dot) org · Board: board at quiethollow dot org</p>
      <p>Press: press&#64;quiethollow&#46;org</p>
      <p>ADOPT@quiethollow.org again</p>`;
    expect(extractAddresses(html)).toEqual([
      "adopt@quiethollow.org",
      "board@quiethollow.org",
      "foster@quiethollow.org",
      "info@quiethollow.org",
      "press@quiethollow.org",
      "volunteers@quiethollow.org",
    ]);
  });

  it("rejects the look-alikes a page is full of", () => {
    const html = `
      <img src="/img/icon@2x.png"> <script src="https://cdn.example/react@18.3.1/index.js"></script>
      <link href="styles@print.css"> sourceMappingURL=app@abc123.map
      <p>Reach us at hello@quiethollow.org</p>`;
    expect(extractAddresses(html)).toEqual(["hello@quiethollow.org"]);
    expect(isAddress("icon@2x.png")).toBe(false);
    expect(isAddress("react@18.3.1")).toBe(false);
    expect(isAddress("a@b")).toBe(false);
    expect(isAddress("first.last+tag@sub.shelter.org")).toBe(true);
  });

  it("finds contact and about links on the same site only, at most a handful", () => {
    const origin = new URL("https://quiethollow.org");
    const html = `
      <a href="/contact-us/">Contact</a> <a href="https://quiethollow.org/about/team">Our team (about)</a>
      <a href="https://facebook.com/quiethollow">Contact us on Facebook</a> <a href="/adopt">Adopt</a>
      <a href="/reach-us">Reach us</a> <a href="/contact-us/">Contact again</a>`;
    expect(contactLinks(html, origin)).toEqual(["/contact-us/", "/about/team", "/reach-us"]);
  });

  it("turns what RescueGroups publishes as a website into an origin, or nothing", () => {
    expect(siteOrigin("quiethollow.org")?.toString()).toBe("https://quiethollow.org/");
    expect(siteOrigin("http://www.quiethollow.org/adopt?x=1")?.toString()).toBe("http://www.quiethollow.org/");
    expect(siteOrigin("")).toBeNull();
    expect(siteOrigin("mailto:x@y.org")).toBeNull();
    expect(siteOrigin("not a url at all")).toBeNull();
  });
});

describe("ADR-0029 robots.txt", () => {
  const robots = `
    User-agent: *
    Disallow: /admin/
    Disallow: /private
    Allow: /private/contact

    User-agent: MonsterPawsBot
    Disallow: /about

    User-agent: Googlebot
    Disallow: /`;

  it("reads our own group when there is one, else the wildcard, longest rule winning and allow on a tie", () => {
    const ours = parseRobots(robots);
    expect(robotsAllows(ours, "/about")).toBe(false);
    expect(robotsAllows(ours, "/contact")).toBe(true);
    expect(robotsAllows(ours, "/admin/x")).toBe(true);

    const anyone = parseRobots(robots, "SomeOtherBot");
    expect(robotsAllows(anyone, "/admin/x")).toBe(false);
    expect(robotsAllows(anyone, "/private")).toBe(false);
    expect(robotsAllows(anyone, "/private/contact")).toBe(true);
    expect(robotsAllows(anyone, "/about")).toBe(true);
  });

  it("treats wildcards and end anchors, and an empty file as open", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /*.pdf$\nDisallow: /tmp*\n");
    expect(robotsAllows(rules, "/files/a.pdf")).toBe(false);
    expect(robotsAllows(rules, "/files/a.pdfx")).toBe(true);
    expect(robotsAllows(rules, "/tmp/anything")).toBe(false);
    expect(robotsAllows(parseRobots(""), "/anything")).toBe(true);
  });
});

describe("ADR-0029 polite fetcher", () => {
  it("spaces requests a second apart whatever the caller does, and names us", async () => {
    let clock = 1_000_000;
    const slept: number[] = [];
    const seen: { url: string; ua: string | undefined }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), ua: (init?.headers as Record<string, string>)["user-agent"] });
      return new Response("<p>hi</p>", { status: 200, headers: { "content-type": "text/html" } });
    }) as typeof fetch;
    const fetcher = politeFetcher({
      fetchImpl,
      now: () => clock,
      sleep: async (ms) => {
        slept.push(ms);
        clock += ms;
      },
    });
    const pages = await Promise.all([fetcher.get("https://a.org/"), fetcher.get("https://a.org/contact"), fetcher.get("https://b.org/")]);
    expect(pages.map((p) => p.text)).toEqual(["<p>hi</p>", "<p>hi</p>", "<p>hi</p>"]);
    expect(slept).toEqual([1000, 1000]);
    expect(seen.map((s) => s.url)).toEqual(["https://a.org/", "https://a.org/contact", "https://b.org/"]);
    expect(seen[0].ua).toBe(USER_AGENT);
    expect(USER_AGENT).toContain("hello@monsterpaws.org");
  });

  it("reads a non-text answer as an empty page, not an error", async () => {
    const fetchImpl = (async () => new Response("binary", { status: 200, headers: { "content-type": "image/png" } })) as typeof fetch;
    const page = await politeFetcher({ fetchImpl, sleep: async () => {} }).get("https://a.org/logo.png");
    expect(page).toMatchObject({ status: 200, text: "" });
  });
});

describe("ADR-0029 finding a shelter's address", () => {
  /** A scripted site: paths to pages; a missing path is a 404; a throwing path is a network error. */
  function site(pages: Record<string, string | Error>): PageFetcher & { requested: string[] } {
    const requested: string[] = [];
    return {
      requested,
      async get(url) {
        requested.push(url);
        const path = new URL(url).pathname + new URL(url).search;
        const page = pages[path];
        if (page instanceof Error) throw page;
        const found: FetchedPage = page === undefined ? { url, status: 404, text: "" } : { url, status: 200, text: page };
        return found;
      },
    };
  }

  it("reads home, the standard pages and the home page's own contact link, in that order, and records where each address was", async () => {
    const fetcher = site({
      "/robots.txt": "User-agent: *\nDisallow: /about-us\n",
      "/": `<a href="/get-in-touch">Get in touch</a> <p>info@quiethollow.org</p>`,
      "/contact": `<p>adopt@quiethollow.org and info@quiethollow.org</p>`,
      "/about-us": `<p>secret@quiethollow.org</p>`,
      "/get-in-touch": `<a href="mailto:director@quiethollow.org">the director</a>`,
    });
    const result = await findAddresses("quiethollow.org", fetcher);
    expect(result.candidates).toEqual([
      { email: "info@quiethollow.org", sourceUrl: "https://quiethollow.org/" },
      { email: "adopt@quiethollow.org", sourceUrl: "https://quiethollow.org/contact" },
      { email: "director@quiethollow.org", sourceUrl: "https://quiethollow.org/get-in-touch" },
    ]);
    expect(result.blockedByRobots).toEqual(["https://quiethollow.org/about-us"]);
    expect(fetcher.requested).not.toContain("https://quiethollow.org/about-us");
    expect(result.pagesRead).toEqual([
      "https://quiethollow.org/",
      "https://quiethollow.org/contact",
      "https://quiethollow.org/get-in-touch",
    ]);
    expect(result.contactFormOnly).toBe(false);
    expect(result.errors).toEqual([]);
  });

  it("reports a contact form with no address as such, and a page that fails as an error, and keeps going", async () => {
    const fetcher = site({
      "/": `<form action="/send"><input type="email"></form>`,
      "/contact": new Error("ECONNRESET"),
    });
    const result = await findAddresses("https://formsonly.org", fetcher);
    expect(result.candidates).toEqual([]);
    expect(result.contactFormOnly).toBe(true);
    expect(result.errors).toEqual(["https://formsonly.org/contact: ECONNRESET"]);
    expect(result.pagesRead).toEqual(["https://formsonly.org/"]);
  });

  it("drops a www. the host never had and reads the bare host — www.randolphhumane.rescuegroups.org (2026-10-30)", async () => {
    const requested: string[] = [];
    const fetcher: PageFetcher = {
      async get(url) {
        requested.push(url);
        const { hostname, pathname } = new URL(url);
        if (hostname.startsWith("www.")) throw new Error("fetch failed");
        return pathname === "/" ? { url, status: 200, text: "<p>rchs@example.org</p>" } : { url, status: 404, text: "" };
      },
    };
    const result = await findAddresses("http://WWW.RANDOLPHHUMANE.RESCUEGROUPS.ORG", fetcher);
    expect(result.candidates).toEqual([{ email: "rchs@example.org", sourceUrl: "http://randolphhumane.rescuegroups.org/" }]);
    expect(result.errors).toEqual([
      "robots.txt: fetch failed",
      "www.randolphhumane.rescuegroups.org unreachable — read randolphhumane.rescuegroups.org instead",
    ]);
    expect(requested.filter((u) => u.includes("//www.")).length).toBe(1);
  });

  it("refuses something that is not a website without a single request", async () => {
    const fetcher = site({});
    const result = await findAddresses("n/a", fetcher);
    expect(result.errors).toEqual(["'n/a' is not a website address"]);
    expect(fetcher.requested).toEqual([]);
  });
});

describe.skipIf(SKIP_DB_TESTS)("ADR-0029 shelter_contacts", () => {
  let db: Db;
  const SHELTER = "rescuegroups:org:77";
  const AT = new Date("2026-11-01T09:00:00Z");

  beforeAll(() => {
    db = testDb();
  });

  beforeEach(async () => {
    await truncateOutreach(db);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("keeps candidates, confirms one by a person, and hands the send only the confirmed address", async () => {
    expect(
      await recordAddressCandidates(
        db,
        SHELTER,
        [
          { email: "Info@QuietHollow.org", sourceUrl: "https://quiethollow.org/" },
          { email: "adopt@quiethollow.org", sourceUrl: "https://quiethollow.org/contact" },
        ],
        AT,
      ),
    ).toBe(2);
    // A second find keeps the first row's provenance.
    expect(await recordAddressCandidates(db, SHELTER, [{ email: "info@quiethollow.org", sourceUrl: "https://elsewhere" }], AT)).toBe(0);
    expect(await confirmedAddress(db, SHELTER)).toBeNull();

    await confirmAddress(db, SHELTER, "adopt@quiethollow.org", "Logan", new Date("2026-11-02T09:00:00Z"));
    expect(await confirmedAddress(db, SHELTER)).toBe("adopt@quiethollow.org");

    // A typed address is confirmed in one step and, being newer, wins.
    await confirmAddress(db, SHELTER, "Director@QuietHollow.org", "Logan", new Date("2026-11-03T09:00:00Z"));
    expect(await confirmedAddress(db, SHELTER)).toBe("director@quiethollow.org");

    const rows = await contactsOf(db, SHELTER);
    expect(rows.map((r) => [r.email, r.sourceUrl, r.confirmedBy])).toEqual([
      ["director@quiethollow.org", "typed by Logan", "Logan"],
      ["adopt@quiethollow.org", "https://quiethollow.org/contact", "Logan"],
      ["info@quiethollow.org", "https://quiethollow.org/", null],
    ]);
  });
});
