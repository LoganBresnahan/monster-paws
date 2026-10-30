/**
 * Where to write to a shelter, read from its own website (ADR-0029 §2):
 * its home, contact and about pages, `robots.txt` respected, one request a
 * second, an honest user agent. Every address this finds is a CANDIDATE
 * until a person confirms it — never RescueGroups' `email` field, which this
 * module cannot see and must never be handed.
 */

export const USER_AGENT_TOKEN = "MonsterPawsBot";
export const USER_AGENT = `${USER_AGENT_TOKEN}/1.0 (+https://monsterpaws.org; hello@monsterpaws.org) shelter contact lookup`;

/** Things that look like `name@host.tld` and are not mail: `icon@2x.png`, `react@18.3.1`, a source map. */
const NOT_A_MAIL_TLD = new Set([
  "png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "ico", "css", "js", "mjs", "json", "map", "woff", "woff2", "ttf",
  "otf", "eot", "html", "htm", "php", "xml", "txt", "pdf", "mp4", "webm", "mp3",
]);

const ADDRESS = /([A-Za-z0-9](?:[A-Za-z0-9._%+-]*[A-Za-z0-9])?)@([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.([A-Za-z]{2,}))/g;

function decodeEntities(html: string): string {
  return html
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");
}

/** `info [at] shelter [dot] org`, `info (at) shelter dot org` — the forms a shelter writes to dodge scrapers, which is exactly who we are not. */
function deobfuscate(text: string): string {
  return text
    .replace(/\s*[[({]\s*at\s*[\])}]\s*/gi, "@")
    .replace(/\s*[[({]\s*dot\s*[\])}]\s*/gi, ".")
    .replace(/\b([A-Za-z0-9._%+-]+)\s+at\s+([A-Za-z0-9-]+(?:\s+dot\s+[A-Za-z0-9-]+)+)\b/gi, (_, local: string, host: string) =>
      `${local}@${host.replace(/\s+dot\s+/gi, ".")}`,
    );
}

/**
 * Every address a page shows or links, lowercased, each once. Pure, so the
 * fixtures that pin it are HTML strings, never a fetch.
 */
export function extractAddresses(html: string): string[] {
  const found = new Set<string>();
  const decoded = decodeEntities(html);

  for (const match of decoded.matchAll(/href\s*=\s*["']?\s*mailto:([^"'?>\s]+)/gi)) {
    const address = decodeURIComponent(match[1]).toLowerCase();
    if (isAddress(address)) found.add(address);
  }

  const text = deobfuscate(decoded.replace(/<[^>]+>/g, " "));
  for (const match of text.matchAll(ADDRESS)) {
    const address = match[0].toLowerCase();
    if (isAddress(address)) found.add(address);
  }
  return [...found].sort();
}

export function isAddress(candidate: string): boolean {
  const match = new RegExp(`^${ADDRESS.source}$`).exec(candidate);
  if (!match) return false;
  const tld = match[3].toLowerCase();
  if (NOT_A_MAIL_TLD.has(tld)) return false;
  // `react@18.3.1` and friends: a host of digits and dots is a version, not a domain.
  if (/^[\d.]+$/.test(match[2].slice(0, -tld.length - 1))) return false;
  return candidate.length <= 254;
}

export interface RobotsRules {
  allow: string[];
  disallow: string[];
}

/**
 * The group for our token, else `*`, else nothing disallowed. Only `Allow`
 * and `Disallow` are read; a crawl delay is moot at one request a second.
 */
export function parseRobots(text: string, token = USER_AGENT_TOKEN): RobotsRules {
  const groups: { agents: string[]; rules: RobotsRules }[] = [];
  let current: { agents: string[]; rules: RobotsRules } | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: { allow: [], disallow: [] } };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (current && (field === "allow" || field === "disallow")) {
      if (value) current.rules[field].push(value);
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const ours = groups.find((g) => g.agents.some((a) => a !== "*" && token.toLowerCase().includes(a)));
  const any = groups.find((g) => g.agents.includes("*"));
  return (ours ?? any)?.rules ?? { allow: [], disallow: [] };
}

function ruleMatches(rule: string, path: string): boolean {
  const pattern = rule
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  const anchored = pattern.endsWith("\\$") ? `^${pattern.slice(0, -2)}$` : `^${pattern}`;
  return new RegExp(anchored).test(path);
}

/** The longest matching rule wins, and an allow wins a tie — the convention every major crawler follows. */
export function robotsAllows(rules: RobotsRules, path: string): boolean {
  const longest = (list: string[]) =>
    list.filter((rule) => ruleMatches(rule, path)).reduce((best, rule) => Math.max(best, rule.length), -1);
  const allow = longest(rules.allow);
  const disallow = longest(rules.disallow);
  return allow >= disallow;
}

export interface FetchedPage {
  url: string;
  status: number;
  text: string;
}

export interface PageFetcher {
  get(url: string): Promise<FetchedPage>;
}

export interface PoliteFetcherOptions {
  fetchImpl?: typeof fetch;
  /** injected so the test does not wait a second per request */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  minIntervalMs?: number;
  timeoutMs?: number;
  userAgent?: string;
}

/**
 * One request a second, whatever the caller does in parallel, with a timeout
 * and our name in the user agent. Redirects are followed; a non-text answer
 * is an empty page, never an error.
 */
export function politeFetcher(options: PoliteFetcherOptions = {}): PageFetcher {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const minInterval = options.minIntervalMs ?? 1000;
  const timeout = options.timeoutMs ?? 10_000;
  let last = -Infinity;
  let queue: Promise<unknown> = Promise.resolve();

  return {
    get(url) {
      const turn = queue.then(async () => {
        const wait = last + minInterval - now();
        if (wait > 0) await sleep(wait);
        last = now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
          const response = await fetchImpl(url, {
            headers: { "user-agent": options.userAgent ?? USER_AGENT, accept: "text/html,text/plain;q=0.9,*/*;q=0.1" },
            signal: controller.signal,
            redirect: "follow",
          });
          const type = response.headers.get("content-type") ?? "";
          const text = /text\/|xml|json/.test(type) ? await response.text() : "";
          return { url: response.url || url, status: response.status, text };
        } finally {
          clearTimeout(timer);
        }
      });
      queue = turn.catch(() => undefined);
      return turn;
    },
  };
}

/** Where a shelter's address usually is; the home page's own "contact" and "about" links are read as well. */
export const CONTACT_PATHS = ["/", "/contact", "/contact-us", "/contact.html", "/about", "/about-us"] as const;

export interface AddressCandidate {
  email: string;
  /** the page it was read from */
  sourceUrl: string;
}

export interface AddressSearch {
  candidates: AddressCandidate[];
  /** a contact form was seen and no address — Logan writes through the form, or skips */
  contactFormOnly: boolean;
  pagesRead: string[];
  blockedByRobots: string[];
  errors: string[];
}

export function siteOrigin(website: string): URL | null {
  const raw = website.trim();
  if (!raw) return null;
  // A scheme other than http(s) — `mailto:`, `tel:` — is not a site, and a
  // host with no dot or with credentials in front of it is not a shelter's.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.username || url.password || !url.hostname.includes(".")) return null;
    return new URL(url.origin);
  } catch {
    return null;
  }
}

/** Links on a page that call themselves contact or about, on the same site, at most a handful. */
export function contactLinks(html: string, origin: URL, limit = 5): string[] {
  const out: string[] = [];
  for (const match of decodeEntities(html).matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const [, href, inner] = match;
    const label = `${href} ${inner.replace(/<[^>]+>/g, " ")}`.toLowerCase();
    if (!/contact|about|reach us|get in touch/.test(label)) continue;
    let url: URL;
    try {
      url = new URL(href, origin);
    } catch {
      continue;
    }
    if (url.origin !== origin.origin) continue;
    const path = url.pathname + url.search;
    if (!out.includes(path)) out.push(path);
    if (out.length >= limit) break;
  }
  return out;
}

export async function findAddresses(website: string, fetcher: PageFetcher): Promise<AddressSearch> {
  const result: AddressSearch = { candidates: [], contactFormOnly: false, pagesRead: [], blockedByRobots: [], errors: [] };
  let origin = siteOrigin(website);
  if (!origin) {
    result.errors.push(`'${website}' is not a website address`);
    return result;
  }

  let rules: RobotsRules = { allow: [], disallow: [] };
  try {
    const robots = await fetcher.get(new URL("/robots.txt", origin).toString());
    if (robots.status === 200) rules = parseRobots(robots.text);
  } catch (error) {
    result.errors.push(`robots.txt: ${(error as Error).message}`);
    // Listings carry a `www.` some hosts never had: www.randolphhumane.rescuegroups.org
    // does not resolve, randolphhumane.rescuegroups.org does (found 2026-10-30).
    if (origin.hostname.startsWith("www.")) {
      const bare = new URL(origin.toString());
      bare.hostname = origin.hostname.slice(4);
      try {
        const robots = await fetcher.get(new URL("/robots.txt", bare).toString());
        if (robots.status === 200) rules = parseRobots(robots.text);
        result.errors.push(`${origin.hostname} unreachable — read ${bare.hostname} instead`);
        origin = bare;
      } catch {
        // Neither answers: the loop below records each page's failure against the listed host.
      }
    }
  }

  const seen = new Set<string>();
  const found = new Set<string>();
  let sawForm = false;
  const paths: string[] = [...CONTACT_PATHS];

  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    if (seen.has(path)) continue;
    seen.add(path);
    const url = new URL(path, origin).toString();
    if (!robotsAllows(rules, path)) {
      result.blockedByRobots.push(url);
      continue;
    }
    let page: FetchedPage;
    try {
      page = await fetcher.get(url);
    } catch (error) {
      result.errors.push(`${url}: ${(error as Error).message}`);
      continue;
    }
    if (page.status !== 200 || !page.text) continue;
    result.pagesRead.push(page.url);
    if (/<form\b/i.test(page.text)) sawForm = true;
    for (const email of extractAddresses(page.text)) {
      if (found.has(email)) continue;
      found.add(email);
      result.candidates.push({ email, sourceUrl: page.url });
    }
    if (path === "/") for (const link of contactLinks(page.text, origin)) if (!seen.has(link)) paths.push(link);
  }

  result.contactFormOnly = result.candidates.length === 0 && sawForm;
  return result;
}
