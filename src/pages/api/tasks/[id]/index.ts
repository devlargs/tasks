import type { APIRoute } from "astro";
import { clockFrom, fail, ok, readJson, withNotion } from "../../../../lib/server/http";
import { remove, update } from "../../../../lib/server/tasks";
import { isPageId, isTaskStatus, sanitizeTaskText } from "../../../../lib/tasksLogic";
import type { TaskUpdate } from "../../../../lib/types";

// Rename a task and/or move it between Todo, In Progress and Done. The body
// carries the device's clock (`now`, `tz`) for the time a status change banks.
export const PATCH: APIRoute = ({ params, request, cookies }) =>
  withNotion(cookies, async (config) => {
    if (!isPageId(params.id)) return fail("Invalid task id.");
    const body = await readJson(request);
    const patch: TaskUpdate = {};
    if (body.text !== undefined) {
      const text = sanitizeTaskText(body.text);
      if (!text) return fail("Task text is required.");
      patch.text = text;
    }
    if (body.status !== undefined) {
      if (!isTaskStatus(body.status)) return fail("Invalid status.");
      patch.status = body.status;
    }
    const task = await update(config, params.id, patch, clockFrom(body.now, body.tz));
    return task ? ok({ task }) : fail("Task not found.", 404);
  });

export const DELETE: APIRoute = ({ params, cookies }) =>
  withNotion(cookies, async (config) => {
    if (!isPageId(params.id)) return fail("Invalid task id.");
    await remove(config, params.id);
    return ok({});
  });
