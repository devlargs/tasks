import { describe, expect, it } from "vitest";
import {
  CHAR_MS,
  MAX_STAGGER_MS,
  STAGGER_MS,
  buildDissolveWords,
  charDelayMs,
  dissolveDurationMs,
} from "../src/components/todo/dissolve";
import type { TaskSegment } from "../src/components/todo/links";

const text = (value: string): TaskSegment => ({ type: "text", value });
const link = (value: string): TaskSegment => ({ type: "link", value, href: value });

// The rendered text has to survive the split character-for-character —
// dropping or duplicating a space would visibly re-flow the label.
const rejoin = (words: ReturnType<typeof buildDissolveWords>) =>
  words.map((word) => word.map((c) => c.char).join("")).join("");

describe("charDelayMs", () => {
  it("gives a single character no delay", () => {
    expect(charDelayMs(0, 1)).toBe(0);
    expect(charDelayMs(0, 0)).toBe(0);
  });

  it("staggers a short label at the full per-character gap", () => {
    // 5 chars: the sweep is 4 gaps, under the cap, so the last lands on it
    expect(charDelayMs(0, 5)).toBe(0);
    expect(charDelayMs(4, 5)).toBe(STAGGER_MS * 4);
  });

  it("compresses a long label into the capped sweep", () => {
    expect(charDelayMs(199, 200)).toBe(MAX_STAGGER_MS);
    expect(charDelayMs(99, 200)).toBeLessThan(MAX_STAGGER_MS);
  });

  it("never runs a later character before an earlier one", () => {
    const delays = Array.from({ length: 40 }, (_, i) => charDelayMs(i, 40));
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
    }
  });
});

describe("dissolveDurationMs", () => {
  it("is nothing for an empty label", () => {
    expect(dissolveDurationMs(0)).toBe(0);
  });

  it("is one character's fade for a one-character label", () => {
    expect(dissolveDurationMs(1)).toBe(CHAR_MS);
  });

  it("is bounded however long the task is", () => {
    expect(dissolveDurationMs(5000)).toBe(MAX_STAGGER_MS + CHAR_MS);
  });
});

describe("buildDissolveWords", () => {
  it("groups characters into words", () => {
    const words = buildDissolveWords([text("buy milk")]);
    expect(words.map((w) => w.map((c) => c.char).join(""))).toEqual(["buy ", "milk"]);
  });

  it("keeps the trailing space with the word before it", () => {
    const words = buildDissolveWords([text("a  b")]);
    expect(words.map((w) => w.map((c) => c.char).join(""))).toEqual(["a  ", "b"]);
  });

  it("preserves the text exactly", () => {
    for (const value of ["buy milk", "a  b", "one", " leading", "trailing ", ""]) {
      expect(rejoin(buildDissolveWords([text(value)]))).toBe(value);
    }
  });

  it("marks characters that came from a link run", () => {
    const words = buildDissolveWords([text("see "), link("https://x.com")]);
    const flat = words.flat();
    expect(
      flat
        .filter((c) => c.isLink)
        .map((c) => c.char)
        .join(""),
    ).toBe("https://x.com");
    expect(
      flat
        .filter((c) => !c.isLink)
        .map((c) => c.char)
        .join(""),
    ).toBe("see ");
  });

  it("splits a word that spans two segments into one box", () => {
    // "www.x.com," is a link plus its trailing comma — no space between them,
    // so they must not become two wrapping boxes.
    const words = buildDissolveWords([link("www.x.com"), text(",")]);
    expect(words).toHaveLength(1);
    expect(rejoin(words)).toBe("www.x.com,");
  });

  it("treats an emoji as one character", () => {
    const words = buildDissolveWords([text("🎉 party")]);
    expect(words[0][0].char).toBe("🎉");
    expect(rejoin(words)).toBe("🎉 party");
  });

  it("returns nothing for an empty label", () => {
    expect(buildDissolveWords([])).toEqual([]);
  });

  it("delays run in reading order across words", () => {
    const flat = buildDissolveWords([text("buy milk today")]).flat();
    for (let i = 1; i < flat.length; i++) {
      expect(flat[i].delayMs).toBeGreaterThanOrEqual(flat[i - 1].delayMs);
    }
    expect(flat[0].delayMs).toBe(0);
  });
});
