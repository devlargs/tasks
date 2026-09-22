# Tasks

A daily task list that carries unfinished work forward. It lives at **tasks.ralphlargo.com**, and
it's the Todo service inside Largs Hub.

Anyone can use it, with no account. The first time you open it, it asks where to keep your tasks:

- **Sync with Notion.** Paste an integration secret and a database link. Tasks are read from and
  written to that database, so every device you connect to it sees the same list. The database
  gets a title, a `Done` checkbox, a `Date` and an `Order` number (any missing ones are added for
  you).
- **Keep them on this device.** Tasks stay in the browser's local storage. Nothing leaves the
  device. You can connect Notion later from the settings menu, and the tasks already on the device
  are copied into the database.

The site has no database and no settings of its own. A Notion connection lives in an httpOnly
cookie on the device that made it; the server reads it on each request to talk to Notion on that
visitor's behalf and doesn't store it.

## What it does

The same behaviour as Largs Hub's Todo:

- Daily list with previous/next day navigation and a **Today** jump
- Add (newest first), check off with the letter-dissolve, rename inline, delete
- **Carry-over**: opening today moves every unfinished task from earlier days onto today
- **Move to tomorrow** and **Schedule** onto any later day from a month picker
- Drag to reorder with the grip. It uses pointer events, so it works with touch too
- Links in task text are clickable
- Done tasks filed under a collapsible **Done tasks** section, with a progress bar
- Month **calendar** with done/pending counts per day
- **Progress** view: tasks done and tasks carried over to a later day, per day, over the last
  7, 14 or 30 days, with a follow-through rate. Carry-overs are recorded from the first day a
  device runs this version (in a `Carried from` column in Notion, added for you); days before
  that show what got done only
- Catppuccin Mocha/Latte, following the device's light/dark setting

Web-specific:

- No accounts or passwords. Each device chooses Notion or local storage on first open.
- Changes appear on screen immediately and save in the background. With Notion, the pill shows
  Syncing/Synced. If a save fails, an error appears and the day is re-read.
- The list re-reads when you come back to the tab, and follows the date over midnight.
- Can be installed to the home screen (manifest + icons).

## Setup

```bash
npm install
npm run dev
```

There are no environment variables. Open the site and pick Notion or local storage.

## Deploy (Vercel)

1. Import `devlargs/tasks` in Vercel. The Astro framework preset is detected automatically.
2. Add the domain `tasks.ralphlargo.com` and point a `CNAME` for `tasks` at `cname.vercel-dns.com`.

## Commands

```bash
npm run dev        # dev server
npm run build      # production build (Vercel adapter)
npm run typecheck  # astro check
npm test           # Vitest
```

## Layout

- `src/lib/tasksLogic.ts`: pure day/order/carry-over logic, ported from Largs Hub's `electron/tasksLogic.ts`
- `src/lib/localBackend.ts`: the same task operations on the device's local storage
- `src/lib/server/`: the visitor's Notion connection (cookie), Notion client and task operations
  (server-only; the page's scripts never see the secret)
- `src/pages/api/`: JSON routes the page calls, plus `connect`, `disconnect` and `tasks/import`
- `src/components/setup/`: the first-open choice and the Notion connect form
- `src/components/todo/`: the React island, ported from Largs Hub's `src/components/todo/`
- `src/middleware.ts`: same-origin check for writes
