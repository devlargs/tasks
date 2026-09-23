# Contributing

Thanks for helping out. Bug reports, ideas and pull requests are all welcome.

## Reporting a bug or suggesting a feature

Open an issue. For a bug, include what you did, what you expected and what happened instead, plus
your browser and whether you use Notion or local storage. Please never paste a Notion integration
secret into an issue.

## Making a change

1. Fork the repository and create a branch from `main`.
2. Install and run it:

   ```bash
   npm install
   npm run dev
   ```

3. Make your change. Keep pure logic (dates, ordering, carry-over, matching) in plain TypeScript
   modules with unit tests in `test/`, the way `src/lib/tasksLogic.ts` and
   `src/components/todo/links.ts` are done.
4. Before opening a pull request, make sure these pass:

   ```bash
   npm test
   npm run typecheck
   npm run build
   ```

   Code is formatted with Prettier (`.prettierrc.json`).
5. Open a pull request that says what changed and why. Screenshots help for anything visible.

For larger changes, open an issue first so we can agree on the approach before you put the work
in.

## Things to keep in mind

- Both storage modes should keep working: Notion (`src/lib/server/`) and the device
  (`src/lib/localBackend.ts`) implement the same operations.
- The Notion secret must stay on the server. Nothing in the page's scripts should be able to read
  it.
- Respect `prefers-reduced-motion` for any new animation, and check the page on a narrow screen
  and in both light and dark themes.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
