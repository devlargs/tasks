# Tasks

A daily task list that carries unfinished work forward to the next day.

There are no accounts. The first time you open it, it asks where to keep your tasks:

- **Sync with Notion.** Paste a Notion integration secret and a database link. Tasks are read
  from and written to that database, so every device connected to it sees the same list.
- **Keep them on this device.** Tasks stay in the browser's local storage and nothing leaves the
  device. You can connect Notion later from the settings menu; the tasks already on the device are
  copied into the database.

The app has no database or user settings of its own. A Notion connection is kept in an httpOnly
cookie on the device that made it. The server reads that cookie on each request to talk to Notion
for that visitor, and doesn't store it.

## Features

- A list per day, with previous/next day navigation and a **Today** button
- Add tasks (newest first), rename them inline and delete them. Deleting asks you to confirm first
- **Todo → In Progress → Done.** Ticking a Todo task starts it and moves it into the **In
  Progress** section at the top of the day. Ticking an In Progress task finishes it, after a
  confirmation prompt; its back button returns it to Todo. Unticking a done task puts it back in
  progress
- **Time tracking:** each In Progress task shows how long it has been worked on (`12m`, `2h 05m`,
  `1d 3h`). Time counts only while a task is In Progress, is split across the days it ran, and
  keeps running if a task is left In Progress overnight
- **Carry-over:** opening today moves every unfinished task from earlier days onto today. An In
  Progress task stays In Progress, and the time it ran on earlier days stays recorded under those
  days
- **Move to tomorrow**, or **Schedule** onto any later day from a month picker
- **Search** the day's tasks from the search button or by pressing `/`. Matching ignores case and
  accents, and a task must contain every word of the search
- Drag to reorder within a section, with a mouse or by touch
- Links in task text are clickable
- **In Progress**, **Todo** and **Done tasks** each open and close from their heading, which keeps
  its count while closed. Done starts closed. A task that's started, put back or added opens its
  section, and a search shows every section open. The progress bar shows done tasks in full colour
  and in-progress ones in a lighter tint
- A month **calendar** with the done, in-progress and pending counts for each day
- A **Progress** view: tasks started, done and carried over, per day, for the last 7, 14 or 30
  days, with totals and a follow-through rate
- Dark and light themes (Catppuccin Mocha and Latte), dark by default, switched from the settings
  menu and remembered on each device
- Changes show on screen immediately and save in the background. With Notion, a pill shows
  Syncing/Synced; if a save fails, an error appears and the day is re-read
- The list refreshes when you return to the tab, and moves to the new day at midnight
- Can be installed to a phone's home screen

Carry-overs, pickups and time are recorded from the first day a device runs a version of the app
that records them. For earlier days, the Progress view shows what got done and a dash for the
rest.

## Using Notion

1. Create an integration at
   [notion.so/profile/integrations](https://www.notion.so/profile/integrations) and copy its
   **Internal Integration Secret**.
2. Open the database you want to use, choose **•••** › **Connections**, and add the integration.
3. Copy the database's link (**Share** › **Copy link**) and paste it into the app along with the
   secret.

Any database works. The first time a device uses it, any missing properties are added:

| Property        | Type     | Purpose                                                          |
| --------------- | -------- | ---------------------------------------------------------------- |
| (title)         | Title    | The task text                                                    |
| `Done`          | Checkbox | Kept in step with the status, for views and filters              |
| `Date`          | Date     | The day the task is on                                           |
| `Order`         | Number   | Its position in the day                                          |
| `Status`        | Select   | `Todo`, `In Progress` or `Done`                                  |
| `Carried from`  | Text     | The days it was carried over from                                |
| `Started on`    | Text     | The days it was picked up                                        |
| `Time log`      | Text     | Seconds worked per day, e.g. `2026-09-22:3600 2026-09-23:1200`   |
| `Running since` | Date     | When the current In Progress run started                         |

If the database already has a Notion **Status** property named `Status`, the app uses its
To-do / In progress / Complete groups instead of adding a select.

Deleting a task moves its page to the trash in Notion.

## Running it locally

Requires Node.js and npm.

```bash
npm install
npm run dev
```

No environment variables are needed. Open the site and choose Notion or local storage.

## Commands

```bash
npm run dev        # development server
npm run build      # production build
npm run preview    # serve the production build
npm run typecheck  # astro check
npm test           # unit tests (Vitest)
```

## Deploying

The project is an [Astro](https://astro.build) site with server routes, built with the Vercel
adapter.

1. Import the repository into [Vercel](https://vercel.com). The Astro preset is detected
   automatically.
2. Set `site` in `astro.config.mjs` to the URL you'll serve it from.
3. Optionally add a custom domain in the Vercel project settings.

To host it somewhere else, swap `@astrojs/vercel` for another
[Astro adapter](https://docs.astro.build/en/guides/on-demand-rendering/).

Notion secrets pass through the server you deploy (in a cookie, on each request), so only
connect Notion to a deployment you trust.

## Project layout

- `src/lib/tasksLogic.ts`: pure logic for days, ordering, carry-over, status changes and time
  tracking
- `src/lib/localBackend.ts`: the same task operations on the device's local storage
- `src/lib/server/`: the Notion connection cookie, the Notion client and task operations. Runs
  on the server only; the page's scripts never see the secret
- `src/pages/api/`: the JSON routes the page calls, including `connect`, `disconnect` and
  `tasks/import`
- `src/components/setup/`: the first-run choice and the Notion connection form
- `src/components/todo/`: the task list UI (a React island)
- `src/middleware.ts`: same-origin check for write requests
- `test/`: unit tests
- `mobile/`: the iOS and Android app (Expo), with the same features. See
  [mobile/README.md](mobile/README.md)

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). You're free to use, modify and redistribute it, including in your own projects.
