import type { APIRoute } from "astro";
import { fail, ok, readJson, withNotion } from "../../../lib/server/http";
import { reorder } from "../../../lib/server/tasks";
import { isRealDate } from "../../../lib/tasksLogic";

export const POST: APIRoute = ({ request, cookies }) =>
  withNotion(cookies, async (config) => {
    const body = await readJson(request);
    if (!isRealDate(body.date)) return fail("Invalid date.");
    const ids = body.ids;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
      return fail("Invalid task order.");
    }
    return ok({ tasks: await reorder(config, body.date, ids as string[]) });
  });
