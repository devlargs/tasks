import type { APIRoute } from "astro";
import { fail, ok, withNotion } from "../../lib/server/http";
import { stats } from "../../lib/server/tasks";
import { isPlausibleToday, isRealDate, MAX_STATS_DAYS, shiftDateKey } from "../../lib/tasksLogic";

// Done and carried-over counts per day, for the statistics view.
export const GET: APIRoute = ({ url, cookies }) =>
  withNotion(cookies, async (config) => {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const today = url.searchParams.get("today");
    if (!isRealDate(from) || !isRealDate(to) || from > to) return fail("Invalid date range.");
    if (shiftDateKey(from, MAX_STATS_DAYS) < to) return fail("Date range too long.");
    if (!isPlausibleToday(today, new Date())) return fail("Your device's date looks wrong.");
    return ok({ days: await stats(config, from, to, today) });
  });
