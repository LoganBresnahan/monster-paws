/**
 * Source prose arrives HTML-encoded and is rendered as TEXT (ADR-0018).
 * Measured on the 2026-09-04 corpus: 32,298 of 45,139 RescueGroups
 * descriptions carry entities — 220,693 `&nbsp;` alone — and none carry a
 * single tag, so decoding is reading the source's encoding, not editing its
 * words (ADR-0015 decision 4 still holds).
 */

/**
 * The named entities the corpus actually contains, counted rather than
 * imagined, plus the handful any shelter keyboard produces. An unknown name is
 * left standing verbatim: a wrong guess would put a character in a shelter's
 * mouth, and a literal `&hearts;` is merely ugly.
 */
const NAMED: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  bull: "•",
  middot: "·",
  deg: "°",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  rarr: "→",
  larr: "←",
  copy: "©",
  reg: "®",
  trade: "™",
  times: "×",
  laquo: "«",
  raquo: "»",
  euro: "€",
  pound: "£",
  cent: "¢",
  hearts: "♥",
  zwj: "‍",
  zwnj: "‌",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  acirc: "â",
  aacute: "á",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
  ccedil: "ç",
  uuml: "ü",
  ouml: "ö",
  szlig: "ß",
};

const ENTITY = /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g;

/**
 * Never feed the result to `dangerouslySetInnerHTML`: this exists BECAUSE the
 * output is rendered as a text node, where a decoded `&lt;script&gt;` is four
 * harmless characters. Decode into markup and the same line becomes injection
 * of a shelter's text into our page.
 */
export function decodeEntities(text: string): string {
  return text.replace(ENTITY, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body.startsWith("#x")
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      // Surrogates and out-of-range code points would throw in `fromCodePoint`
      // and take a whole page down over one bad character in one listing.
      if (!Number.isFinite(code) || code < 0x20 || code > 0x10ffff) {
        return code === 0x0a ? "\n" : whole;
      }
      if (code >= 0xd800 && code <= 0xdfff) return whole;
      return String.fromCodePoint(code);
    }
    return NAMED[body] ?? whole;
  });
}

/**
 * Collapses the blank space a shelter's CMS left behind — trailing spaces and
 * non-breaking spaces per line, and any run of blank lines down to one
 * (ADR-0018 as amended). Run it AFTER `decodeEntities`, or a line holding only
 * `&nbsp;` is still five characters and survives as a blank line: one real
 * listing rendered ~4,000px tall, most of it nothing.
 *
 * Vertical space only. Never collapse runs of spaces inside a line and never
 * rewrap: an ASCII table or an indented list is the shelter's formatting, and
 * this is presentation of their words, not editing of them (ADR-0015
 * decision 4).
 */
export function tidyWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+$/gu, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
