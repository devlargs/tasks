import type { APIRoute } from "astro";
import { parseConfig, saveConnection } from "../../lib/server/connection";
import { fail, failure, ok, readJson } from "../../lib/server/http";
import { NotionError, verifyConnection } from "../../lib/server/notion";
import { notionDatabaseUrl } from "../../lib/tasksLogic";

// Connects this device to a Notion database: checks the token and database
// work together, then keeps them in this device's cookie. Nothing is stored on
// the server.
export const POST: APIRoute = async ({ request, cookies, url }) => {
  const body = await readJson(request);
  const config = parseConfig(body.apiKey, body.database);
  if (!config) return fail("Paste the integration's secret and the database's link or ID.");
  try {
    await verifyConnection(config);
  } catch (err) {
    // Notion's own wording for these two is accurate but doesn't say what to do
    if (err instanceof NotionError && err.status === 401) {
      return fail("Notion didn't accept that secret. Copy it again from the integration's page.");
    }
    if (err instanceof NotionError && (err.status === 404 || err.status === 400)) {
      return fail(
        "Notion can't find that database. Open it in Notion, choose ••• › Connections, and add your integration.",
      );
    }
    return failure(err);
  }
  saveConnection(cookies, config, url.protocol === "https:");
  return ok({ databaseUrl: notionDatabaseUrl(config.databaseId) });
};
