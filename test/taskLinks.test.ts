import { describe, expect, it } from "vitest";
import { hasLink, parseTaskSegments, toHref } from "../src/components/todo/links";

const values = (text: string) => parseTaskSegments(text).map((s) => s.value);
const links = (text: string) =>
  parseTaskSegments(text)
    .filter((s) => s.type === "link")
    .map((s) => s.value);

describe("parseTaskSegments", () => {
  it("returns plain text untouched when there is no link", () => {
    expect(parseTaskSegments("buy milk")).toEqual([{ type: "text", value: "buy milk" }]);
  });

  it("splits a link out of the surrounding text", () => {
    expect(parseTaskSegments("read https://example.com today")).toEqual([
      { type: "text", value: "read " },
      { type: "link", value: "https://example.com", href: "https://example.com" },
      { type: "text", value: " today" },
    ]);
  });

  it("finds several links in one task", () => {
    expect(links("compare https://a.com and http://b.org/x")).toEqual([
      "https://a.com",
      "http://b.org/x",
    ]);
  });

  it("gives a bare www host a scheme", () => {
    expect(parseTaskSegments("check www.example.com")[1]).toEqual({
      type: "link",
      value: "www.example.com",
      href: "https://www.example.com",
    });
  });

  it("always round-trips the original text", () => {
    for (const text of [
      "buy milk",
      "read https://example.com today",
      "https://example.com",
      "see (https://example.com) now",
      "compare https://a.com and http://b.org/x",
    ]) {
      expect(values(text).join("")).toBe(text);
    }
  });

  describe("trailing punctuation", () => {
    it("leaves sentence punctuation out of the link", () => {
      expect(links("ship it: https://example.com.")).toEqual(["https://example.com"]);
      expect(links("done? https://example.com!")).toEqual(["https://example.com"]);
      expect(links("read https://example.com, then rest")).toEqual(["https://example.com"]);
    });

    it("drops a closing bracket that only wraps the link", () => {
      expect(links("see (https://example.com) now")).toEqual(["https://example.com"]);
      expect(links("see [https://example.com]")).toEqual(["https://example.com"]);
    });

    it("keeps a closing bracket that belongs to the URL", () => {
      expect(links("read https://en.wikipedia.org/wiki/Todo_(technique)")).toEqual([
        "https://en.wikipedia.org/wiki/Todo_(technique)",
      ]);
    });

    it("keeps a trailing slash", () => {
      expect(links("open https://example.com/")).toEqual(["https://example.com/"]);
    });
  });

  describe("non-links", () => {
    it("ignores a bare domain with no scheme or www", () => {
      expect(hasLink("renew hosting on largs.dev")).toBe(false);
    });

    it("ignores a scheme with no host", () => {
      expect(hasLink("https://")).toBe(false);
      expect(hasLink("www.")).toBe(false);
    });

    it("ignores a hostless fragment", () => {
      expect(hasLink("http://localhost")).toBe(false);
    });
  });
});

describe("toHref", () => {
  it("passes through an explicit scheme and adds https to a bare host", () => {
    expect(toHref("http://example.com")).toBe("http://example.com");
    expect(toHref("HTTPS://example.com")).toBe("HTTPS://example.com");
    expect(toHref("www.example.com")).toBe("https://www.example.com");
  });
});
