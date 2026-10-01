// The light/dark choice, which each device makes for itself in the settings
// menu. Dark (Catppuccin Mocha) until someone picks light (Latte) — the
// device's own light/dark setting isn't consulted. Pure, so the web and the
// mobile app read a stored value the same way (test/themeChoice.test.ts).

export type Theme = "dark" | "light";

export const THEMES: readonly Theme[] = ["dark", "light"];

export const THEME_KEY = "tasks:theme";

export const DEFAULT_THEME: Theme = "dark";

// Anything stored that isn't one of the two reads as the default
export function parseTheme(value: unknown): Theme {
  return value === "light" ? "light" : DEFAULT_THEME;
}

// The surface each theme paints behind everything: the browser's theme-color,
// the phone's root view. The same values as --surface in each palette.
export const THEME_SURFACE: Record<Theme, string> = {
  dark: "#181825",
  light: "#eff1f5",
};
