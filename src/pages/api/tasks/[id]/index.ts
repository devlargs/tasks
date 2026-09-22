import type { APIRoute } from "astro";
import { fail, ok, readJson, withNotion } from "../../../../lib/server/http";
import { remove, update } from "../../../../lib/server/tasks";
import { isPageId, sanitizeTaskText } from "../../../../lib/tasksLogic";

// Rename and/or check off a task.
export const PATCH: APIRoute = ({ params, request, cookies }) =>
  withNotion(cookies, async (config) => {
    if (!isPageId(params.id)) return fail("Invalid task id.");
    const body = await readJson(request);
    const patch: { text?: string; done?: boolean } = {};
    if (body.text !== undefined) {
      const text = sanitizeTaskText(body.text);
      if (!text) return fail("Task text is required.");
      patch.text = text;
    }
    if (body.done !== undefined) patch.done = body.done === true;
    const task = await update(config, params.id, patch);
    return task ? ok({ task }) : fail("Task not found.", 404);
  });

export const DELETE: APIRoute = ({ params, cookies }) =>
  withNotion(cookies, async (config) => {
    if (!isPageId(params.id)) return fail("Invalid task id.");
    await remove(config, params.id);
    return ok({});
  });
