import { describe, expect, it } from "vitest";
import { INTENT_COOKIE_OPTIONS, intentIdsOf, mintIntentId, withIntent } from "@/core/donate/intent";
import { donateConfigFromEnv, donateLink, parseDonateAmount, type DonateConfig } from "@/core/donate/link";

const config: DonateConfig = { everyorgEnv: "staging", webhookToken: "tok123", siteOrigin: "https://monsterpaws.org" };
const gift = {
  nonprofitSlug: "happy-tails",
  intentId: "abcDEF123_-abcDEF123_-",
  amount: 25,
  exitPath: "/animals/7",
  donorEmail: "pat+dogs@example.org",
};

describe("the donate link (ADR-0027 §3)", () => {
  it("is offered only when the environment names a real Every.org and a token", () => {
    expect(donateConfigFromEnv({})).toBeNull();
    expect(donateConfigFromEnv({ EVERYORG_WEBHOOK_TOKEN: "t" })).toBeNull();
    expect(donateConfigFromEnv({ EVERYORG_ENV: "staging" })).toBeNull();
    expect(donateConfigFromEnv({ EVERYORG_ENV: "evil.example", EVERYORG_WEBHOOK_TOKEN: "t" })).toBeNull();
    expect(donateConfigFromEnv({ EVERYORG_ENV: "production", EVERYORG_WEBHOOK_TOKEN: "t" })).toEqual({
      everyorgEnv: "production",
      webhookToken: "t",
      siteOrigin: "https://monsterpaws.org",
    });
  });

  it("treats an empty SITE_ORIGIN as unset: a relative return address sends a donor nowhere", () => {
    expect(donateConfigFromEnv({ EVERYORG_ENV: "production", EVERYORG_WEBHOOK_TOKEN: "t", SITE_ORIGIN: "" })?.siteOrigin).toBe("https://monsterpaws.org");
  });

  it("leaves for exactly the configured Every.org host", () => {
    expect(new URL(donateLink(config, gift)).origin).toBe("https://staging.every.org");
    expect(new URL(donateLink({ ...config, everyorgEnv: "production" }, gift)).origin).toBe("https://www.every.org");
  });

  it("can't be steered off the host by a strange slug", () => {
    const url = new URL(donateLink(config, { ...gift, nonprofitSlug: "//evil.example/x" }));
    expect(url.origin).toBe("https://staging.every.org");
    expect(url.pathname.split("/").length).toBe(2);
  });

  it("carries our id and token, and lands on Every.org's donate step", () => {
    const url = new URL(donateLink(config, gift));
    expect(url.pathname).toBe("/happy-tails");
    expect(url.hash).toBe("#donate");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      amount: "25",
      frequency: "ONCE",
      min_value: "2",
      method: "card,paypal",
      email: "pat+dogs@example.org",
      partner_donation_id: gift.intentId,
      webhook_token: "tok123",
      success_url: "https://monsterpaws.org/thanks",
      exit_url: "https://monsterpaws.org/animals/7",
    });
  });

  it("never puts the intent id in the URL a donor comes back on", () => {
    const url = new URL(donateLink(config, gift));
    expect(url.searchParams.get("success_url")).not.toContain(gift.intentId);
  });
});

describe("the amount a donate link may carry", () => {
  it("takes whole dollars from Every.org's $2 minimum", () => {
    expect(parseDonateAmount("2")).toBe(2);
    expect(parseDonateAmount("25")).toBe(25);
    expect(parseDonateAmount("99999")).toBe(99999);
  });

  it("refuses everything else", () => {
    for (const bad of ["0", "1", "-5", "1.50", "1e3", "100000", "", " 5", "5 ", null, 5, undefined]) {
      expect(parseDonateAmount(bad), String(bad)).toBeNull();
    }
  });
});

describe("the intent id and the cookie that holds it (ADR-0027 §3, §5)", () => {
  it("mints 128 bits in the shape the cookie accepts, never twice", () => {
    const ids = new Set(Array.from({ length: 200 }, mintIntentId));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(Buffer.from(id, "base64url")).toHaveLength(16);
      expect(intentIdsOf(id)).toEqual([id]);
    }
  });

  it("keeps the newest first, each id once, and at most twenty", () => {
    const [a, b] = [mintIntentId(), mintIntentId()];
    expect(intentIdsOf(withIntent(withIntent(undefined, a), b))).toEqual([b, a]);
    expect(intentIdsOf(withIntent(withIntent(withIntent(undefined, a), b), a))).toEqual([a, b]);

    let cookie: string | undefined;
    const all = Array.from({ length: 25 }, mintIntentId);
    for (const id of all) cookie = withIntent(cookie, id);
    expect(intentIdsOf(cookie)).toEqual(all.slice(5).reverse());
  });

  it("lasts 30 days, since the page it opens shows the donor's address (ADR-0027 as amended 2026-11-02)", () => {
    expect(INTENT_COOKIE_OPTIONS.maxAge).toBe(30 * 24 * 60 * 60);
    expect(INTENT_COOKIE_OPTIONS).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax" });
  });

  it("ignores anything in the cookie that isn't an id", () => {
    const id = mintIntentId();
    expect(intentIdsOf(undefined)).toEqual([]);
    expect(intentIdsOf(`junk.${id}.'; drop table.`)).toEqual([id]);
  });
});
