/**
 * The hand-off to Every.org's checkout (ADR-0027 §3). The host comes from this
 * table and the return URLs from configuration, never from a request: a donate
 * link is how money leaves our page, so nothing a visitor sends may steer it.
 */
const DONATE_ORIGINS = {
  staging: "https://staging.every.org",
  production: "https://www.every.org",
} as const;

export type EveryorgEnv = keyof typeof DONATE_ORIGINS;

export interface DonateConfig {
  everyorgEnv: EveryorgEnv;
  webhookToken: string;
  siteOrigin: string;
}

/**
 * `null` hides every Sponsor button. An unset or misspelt environment must never
 * fall back to either host: a production page on staging takes no real money, and
 * a dev server on production does (ADR-0015 decision 6: no button, never a dead one).
 */
export function donateConfigFromEnv(env: Record<string, string | undefined> = process.env): DonateConfig | null {
  const everyorgEnv = env.EVERYORG_ENV;
  if (everyorgEnv !== "staging" && everyorgEnv !== "production") return null;
  const webhookToken = env.EVERYORG_WEBHOOK_TOKEN;
  if (!webhookToken) return null;
  return { everyorgEnv, webhookToken, siteOrigin: env.SITE_ORIGIN || "https://monsterpaws.org" };
}

/** Every.org's own floor, measured on staging 2026-11-02 (ADR-0002 as amended 2026-11-02): under it, its checkout refuses the gift. */
export const MIN_AMOUNT = 2;
export const MAX_AMOUNT = 99999;

/** Whole dollars, as the sponsor page offers them, or `null` for anything else. */
export function parseDonateAmount(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^\d{1,5}$/.test(raw)) return null;
  const amount = Number(raw);
  return amount >= MIN_AMOUNT && amount <= MAX_AMOUNT ? amount : null;
}

export function donateLink(
  config: DonateConfig,
  gift: { nonprofitSlug: string; intentId: string; amount: number; exitPath: string; donorEmail: string },
): string {
  const url = new URL(`${DONATE_ORIGINS[config.everyorgEnv]}/${encodeURIComponent(gift.nonprofitSlug)}`);
  url.searchParams.set("amount", String(gift.amount));
  url.searchParams.set("frequency", "ONCE");
  url.searchParams.set("min_value", String(MIN_AMOUNT));
  // Every other method is unknown. Only the card is proven on staging: bank and PayPal are
  // proven by production's real test gifts, before any donor sees this (ADR-0027 as amended 2026-11-02).
  url.searchParams.set("method", "card,bank,paypal");
  // So the donor types it once (Logan, 2026-11-02). It rides in a URL Every.org sees,
  // which never reaches our logs: this link goes straight to the browser.
  url.searchParams.set("email", gift.donorEmail);
  url.searchParams.set("partner_donation_id", gift.intentId);
  url.searchParams.set("webhook_token", config.webhookToken);
  // The return page reads the intent from the cookie, never from this URL: a
  // thank-you link passed along must not carry the id that can claim the gift.
  // Every.org ignores an http://localhost return address, and the donor lands on
  // another charity's page (measured on staging, 2026-11-02).
  url.searchParams.set("success_url", `${config.siteOrigin}/thanks`);
  url.searchParams.set("exit_url", `${config.siteOrigin}${gift.exitPath}`);
  url.hash = "donate";
  return url.toString();
}
