/** Listing notes, never part of a name, in any case. */
const NOTE = /\b(adopt(ed|ion)?( me)?|courtesy|foster(ed|s)?|pending|sponsored|bonded|urgent|needed|please|fee|waived|located|rescue only|male|female)\b/i;

const MAX_WORDS = 4;

/**
 * What to call an animal in a mail a person reads: a listing's name is as published and can carry
 * notes, kennel codes and pleas, such as "Sparrow (Courtesy Post) Foster or Adopt Me!" or "A310627".
 * Null when no name survives: the caller then says "the animal", because a subject line must never
 * read "Your paintings of URGENT FOSTER HOMES NEEDED". For the mail's words only: the keepsake's own
 * `name` fact stays as published (ADR-0022 §2–3).
 */
export function spokenAnimalName(published: string): string | null {
  let name = published
    .replace(/^\s*courtesy (post|listing)\s*:\s*/i, "")
    .replace(/\([^)]*\)?|\[[^\]]*\]?/g, " ")
    .replace(/\*[^*]*\*/g, " ")
    .replace(/[*"]/g, " ");

  // Whatever follows a separator is a note: "Mikey - Bonded with Gilligan", "Hal, a loving shadow".
  name = name.split(/\s[-–—~|:/]|[-–—~|:/]\s|[~#,@:|]/)[0];
  name = name.replace(/-(pending|in a|adopt|special|foster).*$/i, "");
  // A note can follow a name with no separator at all: "Sparrow Foster or Adopt Me!", "Liv Sponsored Adoption Fee".
  const note = NOTE.exec(name);
  if (note) name = name.slice(0, note.index);
  name = name
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[\s!.'/-]+$/, "")
    .trim();

  if (!/\p{L}{2}/u.test(name)) return null;
  if (/^[A-Z]{0,2}\d+$/.test(name.replace(/\s/g, "")) || /\d{3,}/.test(name)) return null;
  if (name.split(" ").length > MAX_WORDS) return null;

  const shouted = name === name.toUpperCase();
  return shouted ? name.toLowerCase().replace(/(^|[\s&'-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase()) : name;
}
