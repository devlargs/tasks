import type { APIRoute } from "astro";
import { fail, handle, ok, readJson } from "../../../../lib/server/http";
import { remove, update } from "../../../../lib/server/tasks";
import { isPageId, sanitizeTaskText } from "../../../../lib/tasksLogic";

// Rename and/or check off a task.
export const PATCH: APIRoute = ({ params, request }) =>
  handle(async () => {
    if (!isPageId(params.id)) return fail("Invalid task id.");
    const body = await readJson(request);
    const patch: { text?: string; done?: boolean } = {};
    if (body.text !== undefined) {
      const text = sanitizeTaskText(body.text);
      if (!text) return fail("Task text is required.");
      patch.text = text;
    }
    if (body.done !== undefined) patch.done = body.done === true;
    const task = await update(params.id, patch);
    return task ? ok({ task }) : fail("Task not found.", 404);
  });

export const DELETE: APIRoute = ({ params }) =>
  handle(async () => {
    if (!isPageId(params.id)) return fail("Invalid task id.");
    await remove(params.id);
    return ok({});
  });
