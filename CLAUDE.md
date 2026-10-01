# Tasks

Two apps in one repo, with the same features:

- **Web** (repo root): an Astro site with a React island. See `README.md`.
- **Mobile** (`mobile/`): an Expo / React Native app for iOS and Android. See `mobile/README.md`
  and, for Expo-specific rules, `mobile/AGENTS.md`.

## Keep mobile in step with web

**Whenever you change the web app, make the same change in the mobile app in the same piece of
work.** That covers features, behaviour, copy (labels, messages, empty states), Notion schema and
validation rules, storage keys, and visual tokens (colours, type, spacing). Don't finish a web
change until mobile has it too, and say so if something can't be mirrored (for example a
keyboard shortcut with no phone equivalent) instead of skipping it quietly.

The mobile app mirrors the web's paths, so the counterpart of a web file is usually the same path
under `mobile/`:

| Web                                             | Mobile                                     | How it relates                                                                                                                                                |
| ----------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/types.ts`, `src/lib/tasksLogic.ts`, `src/lib/themeChoice.ts` | same paths           | **Identical copies.** Copy the file over.                                                                                                                     |
| `src/components/todo/{calendar,dates,dissolve,elapsed,links,search,stats}.ts` | same paths | **Identical copies.** Copy the file over.                                                                                                                     |
| `src/lib/localBackend.ts`                       | same path                                  | Copy, except ids come from `expo-crypto` (Hermes has no `crypto.randomUUID`).                                                                                  |
| `src/lib/server/notion.ts`                      | `mobile/src/lib/notion.ts`                 | Port. The phone calls Notion directly (no CORS on native), so no `node:crypto`.                                                                                |
| `src/lib/server/tasks.ts`                       | `mobile/src/lib/notionTasks.ts`            | Port; only imports differ.                                                                                                                                    |
| `src/lib/server/connection.ts`                  | `mobile/src/lib/connection.ts`             | Same parsing; the secret lives in `expo-secure-store` instead of a cookie.                                                                                     |
| `src/pages/api/**`, `src/lib/api.ts`            | `mobile/src/lib/api.ts`                    | The route checks (dates, text, status, error wording) run in `notionBackend` on the device.                                                                    |
| Theme: `data-theme` on `<html>` (`Layout.astro`, `ThemeSwitch.tsx`) | `mobile/src/components/theme.ts` (`useTheme`), `ThemeSwitch.tsx` | Same stored key and default (dark). Mobile applies it with `Appearance.setColorScheme`, so `usePalette()` and native UI follow it. |
| `src/lib/tracking.ts`, browser `localStorage`   | `mobile/src/lib/tracking.ts`, `mobile/src/lib/storage.ts` | Same keys, over `expo-sqlite/kv-store`.                                                                                                        |
| `src/components/**/*.tsx` and their CSS         | same component names under `mobile/src/components/` | Rewritten in React Native. Styles live in each component's `StyleSheet`; tokens from `src/styles/global.css` are in `mobile/src/components/theme.ts`. |
| `react-icons/md` icons                          | `mobile/src/components/Icon.tsx`           | New icons need their Material path added there.                                                                                                                |
| `test/*.test.ts`                                | —                                          | Mobile has no test runner; the shared logic is covered by the web tests (see below).                                                                           |

A new pure module on the web (no DOM, no Astro) should go to mobile as an identical copy at the
same path, and be added to the list above and to the check below.

To check the identical copies haven't drifted (no output means they match):

```bash
for f in src/lib/types.ts src/lib/tasksLogic.ts src/lib/themeChoice.ts src/components/todo/{calendar,dates,dissolve,elapsed,links,search,stats}.ts; do diff -q "$f" "mobile/$f"; done
```

## Mobile releases

Pushing to `main` with changes under `mobile/` sends a new iOS build to TestFlight
(`.github/workflows/mobile-testflight.yml` → `npm run testflight` in `mobile/`). Every such push
uses an EAS build, so group mobile changes into one push where you can. The one-time setup is in
`mobile/README.md`.

## Before calling a change done

Web:

```bash
npm test
npm run typecheck
npm run build
```

Mobile (from `mobile/`):

```bash
npx tsc --noEmit
npx expo lint
```

The mobile app has the React Compiler on, and `expo lint` enforces its rules: don't read or write
`ref.current` during render, don't call `setState` synchronously in an effect, and use
`.get()` / `.set()` on Reanimated shared values rather than `.value`.
