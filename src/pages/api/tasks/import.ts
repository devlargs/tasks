import type { APIRoute } from "astro";
import { fail, failure, ok, readJson, withNotion } from "../../../lib/server/http";
import { importTasks } from "../../../lib/server/tasks";
import {
  isRealDate,
  MAX_IMPORT_BATCH,
  sanitizeCarryLog,
  sanitizeTaskText,
} from "../../../lib/tasksLogic";

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
      const t = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const text = sanitizeTaskText(t.text);
      if (
        typeof t.id !== "string" ||
        !text ||
        !isRealDate(t.date) ||
        typeof t.order !== "number" ||
        !Number.isFinite(t.order)
      ) {
        return fail("Invalid tasks.");
      }
      tasks.push({
        id: t.id,
        text,
        done: t.done === true,
        date: t.date,
        order: t.order,
        carriedFrom: sanitizeCarryLog(t.carriedFrom),
      });
    }
    const { imported, error } = await importTasks(config, tasks);
    if (!error) return ok({ imported });
    // Say which ones made it, alongside the usual error
    const res = failure(error);
    const data = (await res.json()) as { error: string };
    return Response.json({ ok: false, error: data.error, imported }, { status: res.status });
  });
