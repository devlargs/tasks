// The web app's tokens (src/styles/global.css there), for React Native. The
// same Catppuccin palette — Mocha by default, Latte once someone picks Light in
// the settings menu — and the same type, space and motion scales, in device
// pixels.
//
// CSS mixes colours with color-mix(); here `mix` does the same sum in sRGB, so
// every tint below is written exactly as the stylesheet writes it.

import { Appearance, Platform, useColorScheme } from "react-native";
import { deviceStore } from "../lib/storage";
import { parseTheme, THEME_KEY, type Theme } from "../lib/themeChoice";

const mocha = {
  sidebar: "#1e1e2e",
  sidebarHover: "#313244",
  sidebarActive: "#45475a",
  surface: "#181825",
  accent: "#89b4fa",
  panel: "#11111b",
  border: "#313244",
  textPrimary: "#cdd6f4",
  textSecondary: "#a6adc8",
  textMuted: "#6c7086",
  contextBg: "#1e1e2e",
  contextHover: "#313244",
  success: "#a6e3a1",
  danger: "#f38ba8",
  warning: "#f9e2af",
  // Statistics chart series, validated as a pair against surface (CVD
  // separation, lightness band, 3:1 contrast)
  chartDone: "#5f8fee",
  chartCarried: "#d47a45",
};

export type Palette = typeof mocha;

const latte: Palette = {
  sidebar: "#e6e9ef",
  sidebarHover: "#ccd0da",
  sidebarActive: "#bcc0cc",
  surface: "#eff1f5",
  accent: "#1e66f5",
  panel: "#dce0e8",
  border: "#ccd0da",
  textPrimary: "#4c4f69",
  textSecondary: "#5c5f77",
  textMuted: "#8c8fa1",
  contextBg: "#e6e9ef",
  contextHover: "#ccd0da",
  success: "#40a02b",
  danger: "#d20f39",
  warning: "#df8e1d",
  chartDone: "#1e66f5",
  chartCarried: "#d9530b",
};

// The theme is applied as the app's own colour scheme, so the keyboard, the
// system sheets and useColorScheme() all follow the choice rather than the
// device's setting. Dark unless Light was picked.
export function applyStoredTheme(): void {
  Appearance.setColorScheme(parseTheme(deviceStore.getItem(THEME_KEY)));
}

export function useTheme(): [Theme, (next: Theme) => void] {
  const theme: Theme = useColorScheme() === "light" ? "light" : "dark";
  const choose = (next: Theme) => {
    if (next === theme) return;
    Appearance.setColorScheme(next);
    try {
      deviceStore.setItem(THEME_KEY, next);
    } catch {
      // Not remembered: the choice holds until the app restarts
    }
  };
  return [theme, choose];
}

export function usePalette(): Palette {
  return useColorScheme() === "light" ? latte : mocha;
}

export const isDark = (palette: Palette) => palette === mocha;

const channels = (hex: string) => {
  const h = hex.replace("#", "");
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(a);
};

const hex2 = (n: number) =>
  Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, "0");

// color-mix(in srgb, a p%, b): `b` defaults to transparent. Premultiplied, as
// CSS mixes, so a colour mixed with transparent keeps its hue.
export function mix(a: string, percent: number, b = "transparent"): string {
  const p = percent / 100;
  const [ar, ag, ab, aa] = channels(a);
  const [br, bg, bb, ba] = b === "transparent" ? [0, 0, 0, 0] : channels(b);
  const alpha = aa * p + ba * (1 - p);
  if (alpha === 0) return "#00000000";
  const ch = (x: number, y: number) => (x * aa * p + y * ba * (1 - p)) / alpha;
  return `#${hex2(ch(ar, br))}${hex2(ch(ag, bg))}${hex2(ch(ab, bb))}${hex2(alpha * 255)}`;
}

// --- Scales (same as the web, at a 16px rem) -------------------------------

// Type: major third (1.25), anchored on a 13px UI base
export const text = {
  "3xs": 10,
  "2xs": 11,
  xs: 12,
  sm: 13,
  md: 14,
  lg: 17,
  xl: 21,
  "2xl": 26,
  displayS: 34,
  display: 52,
} as const;

export const space = {
  "3xs": 2,
  "2xs": 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 40,
  "2xl": 64,
} as const;

export const duration = { micro: 120, short: 220, long: 420 } as const;

// Mono is the outlier face and carries exactly one role: numbers.
export const figure = {
  fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  fontVariant: ["tabular-nums" as const],
};
