import type { APIRoute } from "astro";
import { fail, handle, ok } from "../../lib/server/http";
import { calendar } from "../../lib/server/tasks";
import { isPlausibleToday, isRealDate, MAX_CALENDAR_DAYS, shiftDateKey } from "../../lib/tasksLogic";

// Per-day done/pending counts for the calendar view.
export const GET: APIRoute = ({ url }) =>
  handle(async () => {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const today = url.searchParams.get("today");
    if (!isRealDate(from) || !isRealDate(to) || from > to) return fail("Invalid date range.");
    // A month grid is at most six weeks; anything wider is a bad caller
    if (shiftDateKey(from, MAX_CALENDAR_DAYS) < to) return fail("Date range too long.");
    if (!isPlausibleToday(today, new Date())) return fail("Your device's date looks wrong.");
    return ok({ days: await calendar(from, to, today) });
  });
