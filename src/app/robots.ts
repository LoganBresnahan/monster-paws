import type { MetadataRoute } from "next";

/**
 * Crawlers that collect pages to train models. Descriptions are shelters'
 * own words shown under a display license (ADR-0015), which grants us no right
 * to offer them for training (ADR-0024). Never add a link-preview or
 * user-triggered fetcher here (facebookexternalhit, Twitterbot, Slackbot,
 * ChatGPT-User, Claude-User): shared links are how donors arrive (DIRECTION).
 */
const AI_TRAINING_CRAWLERS = [
  "GPTBot",
  "ClaudeBot",
  "CCBot",
  "Google-Extended",
  "Applebot-Extended",
  "Bytespider",
  "meta-externalagent",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: AI_TRAINING_CRAWLERS, disallow: "/" },
      {
        userAgent: "*",
        allow: "/",
        // Filtered browse views repeat the same animals under every species ×
        // state × cursor combination, each a per-request query (ADR-0024).
        // `/animals/random` answers each visit with a different animal: a crawler trap.
        disallow: ["/api/", "/animals?*species=", "/animals?*state=", "/animals/random"],
      },
    ],
  };
}
