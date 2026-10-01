import { useId, useRef, useState, type KeyboardEvent } from "react";
import { parseTheme, THEME_KEY, THEME_SURFACE, THEMES, type Theme } from "../../lib/themeChoice";

// Dark or Light, at the top of the settings menu. The page re-themes the
// moment one is picked and the menu stays open, so the change is its own
// confirmation. Remembered on this device; Layout.astro applies it before the
// first paint on the next visit.

const LABEL: Record<Theme, string> = { dark: "Dark", light: "Light" };

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  // Every colour swaps in the same frame (see global.css)
  root.setAttribute("data-theme-switching", "");
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_SURFACE[theme]);
  requestAnimationFrame(() =>
    requestAnimationFrame(() => root.removeAttribute("data-theme-switching")),
  );
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Blocked storage: the choice holds until the page is reloaded
  }
}

export default function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>(() =>
    parseTheme(document.documentElement.dataset.theme),
  );
  const labelId = useId();
  const options = useRef(new Map<Theme, HTMLButtonElement>());

  const choose = (next: Theme) => {
    if (next === theme) return;
    applyTheme(next);
    setTheme(next);
  };

  // A radio group: the arrows move the choice and the focus together
  const onKeyDown = (e: KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const next = THEMES[(THEMES.indexOf(theme) + step + THEMES.length) % THEMES.length];
    choose(next);
    options.current.get(next)?.focus();
  };

  return (
    <div className="todo-theme">
      <span id={labelId}>Theme</span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="todo-theme-switch"
        onKeyDown={onKeyDown}
      >
        {THEMES.map((option) => (
          <button
            key={option}
            ref={(el) => {
              if (el) options.current.set(option, el);
              else options.current.delete(option);
            }}
            type="button"
            role="radio"
            aria-checked={theme === option}
            tabIndex={theme === option ? 0 : -1}
            onClick={() => choose(option)}
            className="todo-theme-option"
          >
            {LABEL[option]}
          </button>
        ))}
      </div>
    </div>
  );
}
