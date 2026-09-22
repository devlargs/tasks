import { describe, expect, it } from "vitest";
import {
  elapsedPrecise,
  elapsedWords,
  formatElapsed,
  isoDuration,
} from "../src/components/todo/elapsed";

const h = 3600;

describe("running time on a row", () => {
  it("reads to the minute", () => {
    expect(formatElapsed(0)).toBe("<1m");
    expect(formatElapsed(59)).toBe("<1m");
    expect(formatElapsed(12 * 60 + 40)).toBe("12m");
    expect(formatElapsed(2 * h + 5 * 60)).toBe("2h 05m");
    expect(formatElapsed(27 * h + 59 * 60)).toBe("1d 3h");
  });

  it("says the same in words for screen readers", () => {
    expect(elapsedWords(30)).toBe("less than a minute");
    expect(elapsedWords(60)).toBe("1 minute");
    expect(elapsedWords(2 * h + 5 * 60)).toBe("2 hours 5 minutes");
    expect(elapsedWords(h)).toBe("1 hour");
    expect(elapsedWords(27 * h)).toBe("1 day 3 hours");
  });

  it("keeps the exact figure for the tooltip and the <time> element", () => {
    expect(elapsedPrecise(2 * h + 5 * 60 + 13)).toBe("2h 05m 13s");
    expect(elapsedPrecise(26 * h + 7)).toBe("1d 2h 00m 07s");
    expect(isoDuration(2 * h + 5 * 60 + 13)).toBe("PT2H5M13S");
    expect(isoDuration(26 * h)).toBe("P1DT2H0M0S");
  });

  it("never reads negative", () => {
    expect(formatElapsed(-30)).toBe("<1m");
  });
});
