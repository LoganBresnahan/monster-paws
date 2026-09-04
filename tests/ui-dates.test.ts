import { describe, expect, it } from "vitest";
import { agoInWords, formatDate } from "@/ui/dates";

const NOW = new Date("2026-09-04T12:00:00Z");

function daysBefore(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

describe("agoInWords (ADR-0015 copy)", () => {
  it("names whole units, singular and plural", () => {
    expect(agoInWords(daysBefore(0), NOW)).toBe("today");
    expect(agoInWords(daysBefore(1), NOW)).toBe("yesterday");
    expect(agoInWords(daysBefore(2), NOW)).toBe("2 days ago");
    expect(agoInWords(daysBefore(44), NOW)).toBe("44 days ago");
    expect(agoInWords(daysBefore(45), NOW)).toBe("1 month ago");
    expect(agoInWords(daysBefore(365), NOW)).toBe("12 months ago");
    expect(agoInWords(daysBefore(365 * 3), NOW)).toBe("3 years ago");
  });

  it("reads a future timestamp as today, never as a negative duration", () => {
    // A forward wall-clock step writes a `last_seen_at` ahead of real time
    // (ADR-0014 carry-in); "in -2 days" on a public page is the visible form.
    expect(agoInWords(daysBefore(-2), NOW)).toBe("today");
  });
});

describe("formatDate", () => {
  it("is UTC, so one ISR render reads the same in every timezone", () => {
    expect(formatDate(new Date("2026-01-01T00:30:00Z"))).toBe("January 1, 2026");
  });
});
