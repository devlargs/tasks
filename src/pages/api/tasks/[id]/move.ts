import type { APIRoute } from "astro";
import { clockFrom, fail, ok, readJson, withNotion } from "../../../../lib/server/http";
import { move } from "../../../../lib/server/tasks";
import { isPageId, isPlausibleToday, isSchedulableDate } from "../../../../lib/tasksLogic";

// Defer (the next day) and schedule (a picked day) both land here. Only today
// or later: an earlier day would carry the task straight back onto today.
export const POST: APIRoute = ({ params, request, cookies }) =>
  withNotion(cookies, async (config) => {
    if (!isPageId(params.id)) return fail("Invalid task id.");
    const body = await readJson(request);
    if (!isPlausibleToday(body.today, new Date())) return fail("Your device's date looks wrong.");
    if (!isSchedulableDate(body.date, body.today)) return fail("Pick today or a later day.");
    const task = await move(config, params.id, body.date, body.today, clockFrom(body.now, body.tz));
    return task ? ok({ task }) : fail("Task not found.", 404);
  });
