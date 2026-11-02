import type { Sponsorable } from "@/core/donate/intent";

/**
 * Logan's real-money gifts on production, the one exception to "no permission, no
 * button": no animal, so no painting (ADR-0027 as amended 2026-11-02). Its rows are
 * found by this id and deleted after, and `/test-gift` goes with them. The nonprofit
 * was read from Every.org's API on 2026-11-02: `hasAdmin` and `donationsEnabled` true.
 */
export const TEST_GIFT: Pick<Sponsorable, "source" | "externalId" | "nonprofit"> = {
  source: "manual",
  externalId: "test-gift",
  nonprofit: { slug: "rainbow-bridge-hospice-rescue", ein: "88-1794651" },
};
