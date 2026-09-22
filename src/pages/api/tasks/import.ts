import type { APIRoute } from "astro";
import { fail, failure, ok, readJson, withNotion } from "../../../lib/server/http";
import { importTasks } from "../../../lib/server/tasks";
import { restoreTask, MAX_IMPORT_BATCH, sanitizeTaskText } from "../../../lib/tasksLogic";

// Copies tasks kept on the device into Notion, as the device connects. The
// reply lists the ids that made it, even when a later one failed.
export const POST: APIRoute = ({ request, cookies }) =>
  withNotion(cookies, async (config) => {
    const body = await readJson(request);
    if (!Array.isArray(body.tasks) || body.tasks.length > MAX_IMPORT_BATCH) {
      return fail("Invalid tasks.");
    }
    const tasks = [];
    for (const raw of body.tasks as unknown[]) {
      // Checked the way stored tasks are: status (or the old done flag), the
      // logs, and a running clock only on a task that's In Progress
      const t = restoreTask({ ...(raw as object), editedAt: "" });
      const text = t && sanitizeTaskText(t.text);
      if (!t || !text) return fail("Invalid tasks.");
      tasks.push({
        id: t.id,
        text,
        status: t.status,
        date: t.date,
        order: t.order,
        carriedFrom: t.carriedFrom,
        startedOn: t.startedOn,
        timeLog: t.timeLog,
        runningSince: t.runningSince,
      });
    }
    const { imported, error } = await importTasks(config, tasks);
    if (!error) return ok({ imported });
    // Say which ones made it, alongside the usual error
    const res = failure(error);
    const data = (await res.json()) as { error: string };
    return Response.json({ ok: false, error: data.error, imported }, { status: res.status });
  });
