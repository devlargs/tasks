import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, parseTheme, THEME_SURFACE } from "../src/lib/themeChoice";

describe("parseTheme", () => {
  it("defaults to dark", () => {
    expect(DEFAULT_THEME).toBe("dark");
    expect(parseTheme(null)).toBe("dark");
    expect(parseTheme(undefined)).toBe("dark");
  });

  it("keeps a stored choice", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
  });

  it("reads anything else as the default", () => {
    expect(parseTheme("Light")).toBe("dark");
    expect(parseTheme("system")).toBe("dark");
    expect(parseTheme(1)).toBe("dark");
  });
});

describe("THEME_SURFACE", () => {
  it("matches each palette's surface", () => {
    expect(THEME_SURFACE).toEqual({ dark: "#181825", light: "#eff1f5" });
  });
});
