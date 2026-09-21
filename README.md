# Tasks

Largs Hub's Todo list on the web, so you can add tasks from your phone. It lives at
**tasks.ralphlargo.com**.

The site has no database of its own. It reads and writes the **same Notion database** Largs Hub's
Todo is connected to, using the same schema: a title, a `Done` checkbox, a `Date` and an `Order`
number. A task added here shows up in the desktop app the next time that day is refreshed
(on open, after 30 s, or with the Refresh button), and the other way round.

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
- Catppuccin Mocha/Latte, following the device's light/dark setting

Web-specific:

- Password sign-in. One password and a signed 90-day cookie, with no accounts.
- Changes appear on screen immediately and save to Notion in the background. The pill shows
  Syncing/Synced. If a save fails, an error appears and the day is re-read from Notion.
- The list re-reads when you come back to the tab, and follows the date over midnight.
- Can be installed to the home screen (manifest + icons).

## Setup

```bash
npm install
cp .env.example .env   # fill it in, see below
npm run dev
```

| Variable             | What                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `NOTION_API_KEY`     | The integration token Largs Hub uses                                                                                       |
| `NOTION_DATABASE_ID` | The task database's ID or URL. In Largs Hub, open Todo › ⚙ › **View database in Notion** and copy that URL.               |
| `APP_PASSWORD`       | The password you sign in with (8+ characters)                                                                              |
| `SESSION_SECRET`     | 32+ random characters: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`                          |

## Deploy (Vercel)

1. Import `devlargs/tasks` in Vercel. The Astro framework preset is detected automatically.
2. Add the four environment variables above.
3. Add the domain `tasks.ralphlargo.com` and point a `CNAME` for `tasks` at `cname.vercel-dns.com`.

## Commands

```bash
npm run dev        # dev server
npm run build      # production build (Vercel adapter)
npm run typecheck  # astro check
npm test           # Vitest
```

## Layout

- `src/lib/tasksLogic.ts`: pure day/order/carry-over logic, ported from Largs Hub's `electron/tasksLogic.ts`
- `src/lib/server/`: Notion client, task operations and auth (server-only; the token never reaches the browser)
- `src/pages/api/`: JSON routes the page calls
- `src/components/todo/`: the React island, ported from Largs Hub's `src/components/todo/`
- `src/middleware.ts`: sign-in gate and same-origin check for writes
