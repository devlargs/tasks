import { describe, expect, it } from "vitest";
import { matchesSearch, searchTerms } from "../src/components/todo/search";

const matches = (text: string, query: string) => matchesSearch(text, searchTerms(query));

describe("searchTerms", () => {
  it("is empty for a blank query", () => {
    expect(searchTerms("")).toEqual([]);
    expect(searchTerms("   ")).toEqual([]);
  });

  it("splits on any run of whitespace", () => {
    expect(searchTerms("  send   the\tinvoice ")).toEqual(["send", "the", "invoice"]);
  });
});

describe("matchesSearch", () => {
  it("matches everything when there is no query", () => {
    expect(matches("buy milk", "")).toBe(true);
  });

  it("ignores case", () => {
    expect(matches("Call the Bank", "bank")).toBe(true);
    expect(matches("call the bank", "BANK")).toBe(true);
  });

  it("ignores accents", () => {
    expect(matches("Book the Café", "cafe")).toBe(true);
    expect(matches("Book the cafe", "café")).toBe(true);
  });

  it("matches part of a word", () => {
    expect(matches("renew hosting", "host")).toBe(true);
  });

  it("needs every word, in any order", () => {
    expect(matches("Send the invoice from Notion", "notion invoice")).toBe(true);
    expect(matches("Send the invoice", "notion invoice")).toBe(false);
  });

  it("searches the text of a link too", () => {
    expect(matches("read https://example.com/guide", "example")).toBe(true);
  });
});
