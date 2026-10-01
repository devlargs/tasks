import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveTask,
  createTask,
  getTask,
  NotionError,
  verifyConnection,
} from "../src/lib/server/notion";

const DB = "0123456789abcdef0123456789abcdef";
const PAGE = "11111111222233334444555555555555";
let key = 0;
// A fresh secret per test, so the cached schema of one doesn't leak into another
const config = () => ({ apiKey: `ntn_test_${++key}`, databaseId: DB });

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const CROSS_CELL = {
  object: "error",
  code: "internal_server_error",
  message: "Cross-cell memcached access is not allowed",
};

const schema = {
  properties: {
    Name: { type: "title" },
    Done: { type: "checkbox" },
    Date: { type: "date" },
    Order: { type: "number" },
    "Carried from": { type: "rich_text" },
    Status: { type: "select" },
    "Started on": { type: "rich_text" },
    "Time log": { type: "rich_text" },
    "Running since": { type: "date" },
  },
};

// Answers each call with the next response queued for its method + path
function notion(routes: Record<string, (() => Response)[]>) {
  const calls: string[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const route = `${init.method} ${url.replace("https://api.notion.com/v1", "")}`;
    calls.push(route);
    const next = routes[route]?.shift();
    if (!next) throw new TypeError("fetch failed");
    return next();
  });
  vi.stubGlobal("fetch", fetch);
  return calls;
}

// Runs a request to the end, fast-forwarding through the waits between tries
async function settle<T>(promise: Promise<T>): Promise<T> {
  const result = promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  const outcome = await result;
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Notion requests", () => {
  it("try again when Notion's servers have a bad moment", async () => {
    const calls = notion({
      [`PATCH /pages/${PAGE}`]: [
        () => json(500, CROSS_CELL),
        () => json(503, { code: "service_unavailable", message: "Notion is unavailable" }),
        () => json(200, {}),
      ],
    });
    await settle(archiveTask(config(), PAGE));
    expect(calls).toHaveLength(3);
  });

  it("give up after three retries with a message written for people", async () => {
    const calls = notion({
      [`GET /databases/${DB}`]: Array.from(
        { length: 4 },
        () => () => json(500, CROSS_CELL, { "x-notion-request-id": "req-123" }),
      ),
    });
    const error = await settle(verifyConnection(config())).catch((e: unknown) => e);
    expect(calls).toHaveLength(4);
    expect(error).toBeInstanceOf(NotionError);
    const notionError = error as NotionError;
    expect(notionError.userMessage).toBe(
      "Notion had a problem on its side. Try again in a moment.",
    );
    // Notion's own words only go to the log, with its request id
    expect(notionError.message).toBe("Cross-cell memcached access is not allowed");
    expect(console.warn).toHaveBeenLastCalledWith(expect.stringContaining("req-123"));
  });

  it("never send a create twice: a failed write may still have saved", async () => {
    const calls = notion({
      [`GET /databases/${DB}`]: [() => json(200, schema)],
      "POST /pages": [() => json(504, { code: "gateway_timeout", message: "Gateway Timeout" })],
    });
    const error = await settle(
      createTask(config(), {
        text: "Write the report",
        status: "todo",
        date: "2026-10-01",
        order: 0,
      }),
    ).catch((e: unknown) => e);
    expect(calls.filter((c) => c === "POST /pages")).toHaveLength(1);
    expect((error as NotionError).status).toBe(504);
  });

  it("retry a create that was only rate limited, since nothing was saved", async () => {
    const page = {
      id: PAGE,
      last_edited_time: "2026-10-01T00:00:00.000Z",
      parent: { database_id: DB },
      properties: {
        Name: { type: "title", title: [{ plain_text: "Write the report" }] },
        Date: { type: "date", date: { start: "2026-10-01" } },
        Order: { type: "number", number: 0 },
      },
    };
    const calls = notion({
      [`GET /databases/${DB}`]: [() => json(200, schema)],
      "POST /pages": [
        () => json(429, { code: "rate_limited", message: "Slow down" }, { "Retry-After": "1" }),
        () => json(200, page),
      ],
    });
    const task = await settle(
      createTask(config(), {
        text: "Write the report",
        status: "todo",
        date: "2026-10-01",
        order: 0,
      }),
    );
    expect(task.text).toBe("Write the report");
    expect(calls.filter((c) => c === "POST /pages")).toHaveLength(2);
  });

  it("explain a rejected secret without Notion's wording", async () => {
    notion({
      [`GET /databases/${DB}`]: [
        () => json(401, { code: "unauthorized", message: "API token is invalid." }),
      ],
    });
    const error = (await settle(verifyConnection(config())).catch(
      (e: unknown) => e,
    )) as NotionError;
    expect(error.status).toBe(401);
    expect(error.userMessage).toMatch(/didn't accept this device's secret/);
  });

  it("read a missing page as gone, by its status rather than its wording", async () => {
    notion({
      [`GET /databases/${DB}`]: [() => json(200, schema)],
      [`GET /pages/${PAGE}`]: [
        () => json(404, { code: "object_not_found", message: "Something else entirely" }),
      ],
    });
    expect(await settle(getTask(config(), PAGE))).toBeNull();
  });

  it("say when Notion can't be reached at all", async () => {
    const calls = notion({});
    const error = (await settle(archiveTask(config(), PAGE)).catch(
      (e: unknown) => e,
    )) as NotionError;
    // A repeatable request is tried four times before giving up
    expect(calls).toHaveLength(4);
    expect(error.userMessage).toBe("Couldn't reach Notion. Check the connection and try again.");
  });
});
