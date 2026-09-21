import type { APIRoute } from "astro";
import { fail, handle, ok, readJson } from "../../../../lib/server/http";
import { move } from "../../../../lib/server/tasks";
import { isPageId, isPlausibleToday, isSchedulableDate } from "../../../../lib/tasksLogic";

// Defer (the next day) and schedule (a picked day) both land here. Only today
// or later: an earlier day would carry the task straight back onto today.
export const POST: APIRoute = ({ params, request }) =>
  handle(async () => {
    if (!isPageId(params.id)) return fail("Invalid task id.");
    const body = await readJson(request);
    if (!isPlausibleToday(body.today, new Date())) return fail("Your device's date looks wrong.");
    if (!isSchedulableDate(body.date, body.today)) return fail("Pick today or a later day.");
    const task = await move(params.id, body.date);
    return task ? ok({ task }) : fail("Task not found.", 404);
  });
