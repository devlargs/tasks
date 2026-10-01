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

## On your iPhone: TestFlight

```bash
npm run testflight
```

Builds the app on EAS, signs it for Apple distribution and uploads it to TestFlight. The build
goes out to the people in your TestFlight testing group. It isn't released on the App Store and
doesn't go through App Review. Each run gets the next build number automatically.

### Once, before the first run

1. You need a paid Apple Developer account, and the TestFlight app on the iPhone.
2. Check `ios.bundleIdentifier` in `app.json` (`com.ralphlargo.tasks`). It's permanent once the
   app exists on App Store Connect.
3. Run `npm run testflight` from your own machine, not CI. The first run asks questions: sign in
   to Apple, let EAS create the distribution certificate and provisioning profile, and when it
   submits, let it create the app on App Store Connect and an App Store Connect API key. EAS
   keeps all of these for later runs.
4. Copy the app's App Store Connect id (the submit step prints it; it's also under App Store
   Connect › App Information › Apple ID) into `eas.json` as `submit.testflight.ios.ascAppId`.
   That's what lets later runs, including CI, submit without asking anything.
5. In App Store Connect › TestFlight, add yourself to an internal testing group, then open the
   build from the TestFlight app on the phone.

### From GitHub

`.github/workflows/mobile-testflight.yml` runs `npm run testflight` on every push to `main` that
changes something in `mobile/`, and can also be started by hand from the Actions tab. It needs an
`EXPO_TOKEN` repository secret: create a token at expo.dev › Settings › Access tokens, then

```bash
gh secret set EXPO_TOKEN
```

The job only starts the build (`--no-wait`). Building and uploading happen on EAS, and the
commit message becomes the build's "What to Test" note. Until step 4 above is done, the job stops
before building rather than using up a build that can't be submitted. Every run uses one iOS build
from your EAS plan.

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
- `scripts/build-icons.mjs`: the app icon — the Todo, In Progress and Done checkboxes on Mocha —
  drawn once and rendered to every size `app.json` uses (`npm run icons`, needs Google Chrome).
  The SVG sources land in `assets/icon/`, the iOS Icon Composer bundle in `assets/tasks.icon/`
