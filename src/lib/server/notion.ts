// The Notion side: one database, read and written directly. The schema is the
// one Largs Hub's Todo creates (electron/tasks.ts) — a title, a Done checkbox,
// a Date and an Order number — so the desktop app and this site share tasks.
//
// Server-only: the Notion API blocks browser CORS, so the page can't call it
// itself. Every call carries the visitor's own connection (connection.ts) —
// the server has no token or database of its own.

import { createHash } from "node:crypto";
import { isDateKey } from "../tasksLogic";
import type { TodoTask } from "../types";
import type { NotionConfig } from "./connection";

const NOTION_API = "https://api.notion.com/v1";
// Same version Largs Hub pins, so both clients see the same API
const NOTION_VERSION = "2022-06-28";
// Notion caps rich_text content at 2000 chars
const RICH_TEXT_LIMIT = 2000;
// Notion allows ~3 requests a second; a reorder can burst past that
const MAX_RATE_LIMIT_RETRIES = 3;

export class NotionError extends Error {
  // Notion's HTTP status, when the error came from the API
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

interface NotionRichText {
  plain_text: string;
}

interface NotionPropertyValue {
  type: string;
  title?: NotionRichText[];
  rich_text?: NotionRichText[];
  checkbox?: boolean;
  date?: { start: string } | null;
  number?: number | null;
}

interface NotionPage {
  id: string;
  archived?: boolean;
  in_trash?: boolean;
  last_edited_time: string;
  parent?: { database_id?: string };
  properties: Record<string, NotionPropertyValue>;
}

interface NotionDatabase {
  properties: Record<string, { type: string }>;
}

interface NotionQueryPage {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const sameId = (a: string | undefined, b: string) =>
  !!a && a.replace(/-/g, "").toLowerCase() === b.replace(/-/g, "").toLowerCase();

async function notionRequest<T>(
  config: NotionConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${NOTION_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Notion-Version": NOTION_VERSION,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).catch(() => {
      throw new NotionError("Could not reach the Notion API.");
    });

    if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const retryAfter = Number(res.headers.get("Retry-After"));
      await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000);
      continue;
    }

    const data = (await res.json().catch(() => null)) as { message?: string } | null;
    if (!res.ok) {
      throw new NotionError(
        data && typeof data.message === "string"
          ? data.message
          : `Notion API error (HTTP ${res.status})`,
        res.status,
      );
    }
    return data as T;
  }
}

// --- Schema ------------------------------------------------------------------

// Looked up once per connection per server instance: the title property's
// name (whatever the database calls it) and, if the database is fresh, the
// three properties a task needs. A database Largs Hub already connected has
// them all. Keyed by a hash, so tokens aren't kept around as map keys.
const titleProps = new Map<string, Promise<string>>();

const connectionKey = (config: NotionConfig) =>
  createHash("sha256").update(`${config.apiKey}|${config.databaseId}`).digest("hex");

function titleProp(config: NotionConfig): Promise<string> {
  const key = connectionKey(config);
  const cached = titleProps.get(key);
  if (cached) return cached;
  const lookup = (async () => {
    const id = config.databaseId;
    const db = await notionRequest<NotionDatabase>(config, "GET", `/databases/${id}`);
    const title = Object.entries(db.properties).find(([, p]) => p.type === "title")?.[0];
    if (!title) throw new NotionError("This database has no title property.");

    const missing: Record<string, unknown> = {};
    if (db.properties["Done"]?.type !== "checkbox") missing["Done"] = { checkbox: {} };
    if (db.properties["Date"]?.type !== "date") missing["Date"] = { date: {} };
    if (db.properties["Order"]?.type !== "number") missing["Order"] = { number: {} };
    if (Object.keys(missing).length > 0) {
      await notionRequest(config, "PATCH", `/databases/${id}`, { properties: missing });
    }
    return title;
  })().catch((err) => {
    // Don't cache a failure — the next request should try again
    titleProps.delete(key);
    throw err;
  });
  titleProps.set(key, lookup);
  return lookup;
}

// Checks a connection before it's saved: the token works, the database is
// shared with it, and it has (or now has) the properties a task needs.
export async function verifyConnection(config: NotionConfig): Promise<void> {
  await titleProp(config);
}

// --- Pages <-> tasks ---------------------------------------------------------

const plainText = (rich: NotionRichText[] | undefined) =>
  (rich || []).map((t) => t.plain_text).join("");

function pageToTask(title: string, page: NotionPage): TodoTask | null {
  const titleValue = page.properties[title];
  const text = plainText(titleValue?.title ?? titleValue?.rich_text).trim();
  const date = page.properties["Date"]?.date?.start?.slice(0, 10);
  if (!isDateKey(date)) return null; // not one of ours / no day to file it under
  return {
    id: page.id,
    text: text || "Untitled task",
    done: page.properties["Done"]?.checkbox === true,
    date,
    order: page.properties["Order"]?.number ?? 0,
    editedAt: page.last_edited_time,
  };
}

export interface TaskPatch {
  text?: string;
  done?: boolean;
  date?: string;
  order?: number;
}

function buildProperties(title: string, patch: TaskPatch) {
  const properties: Record<string, unknown> = {};
  if (patch.text !== undefined) {
    properties[title] = {
      title: [{ type: "text", text: { content: patch.text.slice(0, RICH_TEXT_LIMIT) } }],
    };
  }
  if (patch.done !== undefined) properties["Done"] = { checkbox: patch.done };
  if (patch.date !== undefined) properties["Date"] = { date: { start: patch.date } };
  if (patch.order !== undefined) properties["Order"] = { number: patch.order };
  return properties;
}

// --- Operations --------------------------------------------------------------

export async function queryTasks(config: NotionConfig, filter: unknown): Promise<TodoTask[]> {
  const title = await titleProp(config);
  const tasks: TodoTask[] = [];
  let cursor: string | null = null;
  do {
    const body: Record<string, unknown> = { page_size: 100, filter };
    if (cursor) body.start_cursor = cursor;
    const res: NotionQueryPage = await notionRequest<NotionQueryPage>(
      config,
      "POST",
      `/databases/${config.databaseId}/query`,
      body,
    );
    for (const page of res.results) {
      const task = pageToTask(title, page);
      if (task) tasks.push(task);
    }
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return tasks;
}

// A single task, or null when it's gone. Refuses pages from any other
// database the integration can see — the id comes from the URL.
export async function getTask(config: NotionConfig, pageId: string): Promise<TodoTask | null> {
  const title = await titleProp(config);
  const page = await notionRequest<NotionPage>(config, "GET", `/pages/${pageId}`).catch((err) => {
    if (err instanceof NotionError && /could not find/i.test(err.message)) return null;
    throw err;
  });
  if (!page || page.archived || page.in_trash) return null;
  if (!sameId(page.parent?.database_id, config.databaseId)) return null;
  return pageToTask(title, page);
}

export async function createTask(
  config: NotionConfig,
  task: Required<TaskPatch>,
): Promise<TodoTask> {
  const title = await titleProp(config);
  const page = await notionRequest<NotionPage>(config, "POST", "/pages", {
    parent: { database_id: config.databaseId },
    properties: buildProperties(title, task),
  });
  const created = pageToTask(title, page);
  if (!created) throw new NotionError("Notion returned a page without a date.");
  return created;
}

export async function updateTask(
  config: NotionConfig,
  pageId: string,
  patch: TaskPatch,
): Promise<TodoTask> {
  const title = await titleProp(config);
  const page = await notionRequest<NotionPage>(config, "PATCH", `/pages/${pageId}`, {
    properties: buildProperties(title, patch),
  });
  const updated = pageToTask(title, page);
  if (!updated) throw new NotionError("Notion returned a page without a date.");
  return updated;
}

export async function archiveTask(config: NotionConfig, pageId: string): Promise<void> {
  await notionRequest(config, "PATCH", `/pages/${pageId}`, { archived: true });
}
