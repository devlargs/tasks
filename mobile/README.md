# Tasks — mobile

The iOS and Android version of [Tasks](../README.md): a daily task list that carries unfinished
work forward. It does everything the web app does, built with [Expo](https://expo.dev) and React
Native.

The first time it opens, it asks where to keep your tasks:

- **Sync with Notion.** Paste a Notion integration secret and a database link, as on the web. The
  phone talks to the Notion API directly; the secret is kept in the platform's secure storage
  (Keychain on iOS, Keystore on Android) and never goes anywhere but Notion. The web app and the
  phone can share one database.
- **Keep them on this device.** Tasks stay in the app's local storage (`expo-sqlite`'s key-value
  store). You can connect Notion later from the settings menu; the tasks already on the phone are
  copied into the database.

## Features

The same as the web app: a list per day with Todo → In Progress → Done, time tracking, carry-over,
move to tomorrow, schedule onto a later day, search, drag to reorder (with the grip), In Progress /
Todo / Done sections that open and close from their headings, clickable links, confirmation before finishing or deleting a task, the month calendar, the Progress view,
and the dark/light theme switch in the settings menu (Catppuccin Mocha by default, Latte when you
pick Light).

Differences that come from being on a phone:

- No keyboard shortcuts (`/` for search, Escape to close).
- The Progress chart has no hover: tap a day to see its numbers, tap it again to open it.
- The list refreshes when the app comes back to the foreground.
- Notion mode doesn't work in the Expo web build: the Notion API blocks browsers (CORS), which is
  why the web app goes through its own server. Use the main web app in a browser.

## Running it

```bash
npm install
npx expo start
```

Then open it in Expo Go, an iOS simulator (`i`) or an Android emulator (`a`). Every native module
it uses (`expo-sqlite`, `expo-secure-store`, `expo-crypto`, `react-native-svg`) is included in
Expo Go.

## Checks

```bash
npx tsc --noEmit
npx expo lint
```

## Layout

- `src/app/`: Expo Router routes (one screen)
- `src/lib/`: task logic, the local and Notion backends, the Notion client, device storage. Several
  files are identical copies of the web's; see `../CLAUDE.md` for which.
- `src/components/setup/`: the first-run choice and the Notion connection form
- `src/components/todo/`: the list, its rows, the schedule picker, calendar and Progress view
- `src/components/theme.ts`: the palette and scales from the web's `global.css`
