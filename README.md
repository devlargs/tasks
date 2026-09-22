# Tasks

A daily task list that carries unfinished work forward. It lives at **tasks.ralphlargo.com**, and
it's the Todo service inside Largs Hub.

Anyone can use it, with no account. The first time you open it, it asks where to keep your tasks:

- **Sync with Notion.** Paste an integration secret and a database link. Tasks are read from and
  written to that database, so every device you connect to it sees the same list. The database
  gets a title, a `Done` checkbox, a `Date` and an `Order` number, plus `Carried from`, `Status`,
  `Started on`, `Time log` and `Running since` (any missing ones are added for you, the first time
  a device uses the database). `Status` is a select with `Todo`, `In Progress` and `Done`; if the
  database already has Notion's own status property called `Status`, its To-do / In progress /
  Complete groups are used instead. The `Done` checkbox is still written with every status change,
  so views and filters built on it keep working. `Time log` is plain text you can read in Notion:
  seconds worked per day, like `2026-09-22:3600 2026-09-23:1200`.
- **Keep them on this device.** Tasks stay in the browser's local storage. Nothing leaves the
  device. You can connect Notion later from the settings menu, and the tasks already on the device
  are copied into the database.

The site has no database and no settings of its own. A Notion connection lives in an httpOnly
cookie on the device that made it; the server reads it on each request to talk to Notion on that
visitor's behalf and doesn't store it.

## What it does

- Daily list with previous/next day navigation and a **Today** jump
- Add (newest first), rename inline, delete
- **Todo → In Progress → Done**. Ticking a Todo task starts it: it moves up into the **In
  Progress** section at the top of the day. On an In Progress row, the tick finishes it (with the
  letter-dissolve) and the back button returns it to Todo. Un-ticking a done task puts it back in
  progress
- **Time on In Progress rows**: each shows how long it has been worked on (`12m`, `2h 05m`,
  `1d 3h`), counted only while it's In Progress. The time is split across the days it ran and
  saved when the task changes state; a task left In Progress overnight keeps running
- **Carry-over**: opening today moves every unfinished task from earlier days onto today. An In
  Progress task stays In Progress, with its time on the days it left filed under those days
- **Move to tomorrow** and **Schedule** onto any later day from a month picker, on Todo and In
  Progress rows
- Drag to reorder with the grip, within a section. It uses pointer events, so it works with touch
  too
- Links in task text are clickable
- Done tasks filed under a collapsible **Done tasks** section. The progress bar under the head
  shows done in full colour and in progress in a tint
- Month **calendar** with done, in progress and pending counts per day
- **Progress** view: tasks started, done and carried over to a later day, per day, over the last
  7, 14 or 30 days, with totals and a follow-through rate. Time isn't charted yet; it's recorded
  in Notion's `Time log` for later
- Carry-overs, pickups and time are only recorded from the first day a device runs a version that
  records them. Earlier days show what got done, and a dash rather than a zero for the rest
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

- `src/lib/tasksLogic.ts`: pure day/order/carry-over, status and time-tracking logic, first ported
  from Largs Hub's old desktop Todo
- `src/lib/localBackend.ts`: the same task operations on the device's local storage
- `src/lib/server/`: the visitor's Notion connection (cookie), Notion client and task operations
  (server-only; the page's scripts never see the secret)
- `src/pages/api/`: JSON routes the page calls, plus `connect`, `disconnect` and `tasks/import`
- `src/components/setup/`: the first-open choice and the Notion connect form
- `src/components/todo/`: the React island, first ported from Largs Hub's old desktop Todo
- `src/middleware.ts`: same-origin check for writes
