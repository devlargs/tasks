// Small helpers shared by the API routes: JSON replies and one error path.

import { NotionError } from "./notion";

export const ok = <T extends object>(body: T) => Response.json({ ok: true, ...body });

export const fail = (error: string, status = 400) => Response.json({ ok: false, error }, { status });

// Runs a handler and turns anything it throws into the { ok: false } shape the
// island expects. Notion's own messages are safe to show (they name the
// problem, not the token); anything else is logged and kept vague.
export async function handle(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof NotionError) return fail(err.message, 502);
    console.error(err);
    return fail("Something went wrong.", 500);
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}
