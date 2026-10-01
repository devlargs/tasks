// Small helpers shared by the API routes: JSON replies and one error path.

import type { AstroCookies } from "astro";
import { deviceClock, type DeviceClock } from "../tasksLogic";
import { readConnection, type NotionConfig } from "./connection";
import { NotionError } from "./notion";

export const ok = <T extends object>(body: T) => Response.json({ ok: true, ...body });

export const fail = (error: string, status = 400) =>
  Response.json({ ok: false, error }, { status });

// Turns anything a handler throws into the { ok: false } shape the island
// expects. A Notion failure is described in plain words (NotionError logs
// Notion's own); anything else is logged and kept vague.
export function failure(err: unknown): Response {
  if (err instanceof NotionError) return fail(err.userMessage, 502);
  console.error(err);
  return fail("Something went wrong.", 500);
}

export async function handle(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (err) {
    return failure(err);
  }
}

// The task routes: they only work for a device that has connected a Notion
// database, and run against that device's connection.
export function withNotion(
  cookies: AstroCookies,
  run: (config: NotionConfig) => Promise<Response>,
): Promise<Response> {
  const config = readConnection(cookies);
  if (!config) {
    return Promise.resolve(fail("Not connected to Notion — reload the page.", 401));
  }
  return handle(() => run(config));
}

// The device's clock from a request's `now` and `tz`, checked against the
// server's own (see deviceClock). Never fails: a bad clock is replaced.
export const clockFrom = (now: unknown, tz: unknown): DeviceClock =>
  deviceClock(now, tz, new Date());

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}
