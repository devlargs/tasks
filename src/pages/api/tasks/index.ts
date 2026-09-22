import type { APIRoute } from "astro";
import { clockFrom, fail, ok, readJson, withNotion } from "../../../lib/server/http";
import { create, listTasks } from "../../../lib/server/tasks";
import { isPlausibleToday, isRealDate, sanitizeTaskText } from "../../../lib/tasksLogic";

// One day's tasks. Reading today also carries the backlog forward.
export const GET: APIRoute = ({ url, cookies }) =>
  withNotion(cookies, async (config) => {
    const date = url.searchParams.get("date");
    const today = url.searchParams.get("today");
    if (!isRealDate(date)) return fail("Invalid date.");
    if (!isPlausibleToday(today, new Date())) return fail("Your device's date looks wrong.");
    const clock = clockFrom(url.searchParams.get("now"), url.searchParams.get("tz"));
    return ok(await listTasks(config, date, today, clock));
  });

export const POST: APIRoute = ({ request, cookies }) =>
  withNotion(cookies, async (config) => {
    const body = await readJson(request);
    if (!isRealDate(body.date)) return fail("Invalid date.");
    const text = sanitizeTaskText(body.text);
    if (!text) return fail("Task text is required.");
    return ok({ task: await create(config, body.date, text) });
  });
