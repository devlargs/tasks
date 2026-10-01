// The Notion side: one database, read and written directly. The core schema is
// the one Largs Hub's old desktop Todo created — a title, a Done checkbox, a
// Date and an Order number — so a database from those days keeps working. The
// columns added since (the carry log, Status and the time columns) are created
// the first time a device uses the database.
//
// The web app runs this on its server (src/lib/server/notion.ts there), since
// the Notion API blocks browser CORS. A phone has no CORS, so the app calls
// Notion itself with the connection kept on the device (connection.ts).

import type { NotionConfig } from "./connection";
import { formatTimeLog, restoreTask } from "./tasksLogic";
import type { TaskStatus, TodoTask } from "./types";

const NOTION_API = "https://api.notion.com/v1";
// Same version Largs Hub pins, so both clients see the same API
const NOTION_VERSION = "2022-06-28";
// Notion caps rich_text content at 2000 chars
const RICH_TEXT_LIMIT = 2000;
// The carry log's column: the days a task was carried off, space-separated.
// Named so it can't collide with a column someone already has.
const CARRIED_PROP = "Carried from";
// Where a task stands. A select rather than Notion's own status type, which
// the API can't create. The Done checkbox is still written alongside it, so
// views and filters built on Done keep working.
const STATUS_PROP = "Status";
// Days the task was picked up, space-separated like the carry log
const STARTED_PROP = "Started on";
// Seconds worked per day: "2026-09-22:3600 2026-09-23:1200"
const TIME_LOG_PROP = "Time log";
// When the open run began; empty while the task isn't running
const RUNNING_PROP = "Running since";
const STATUS_NAMES: Record<TaskStatus, string> = {
  todo: "Todo",
  inProgress: "In Progress",
  done: "Done",
};
// How many times a request is sent again when Notion says the trouble is
// passing. Notion allows ~3 requests a second, and a reorder can burst past
// that; its servers also have short bad patches of their own.
const MAX_RETRIES = 3;
// The statuses Notion documents as temporary: a save conflict, a rate limit,
// and its own server trouble (developers.notion.com/reference/status-codes)
const TRANSIENT_STATUSES = new Set([409, 429, 500, 502, 503, 504, 529]);

// What a person is told when Notion fails. Notion's own messages are written
// for developers, and its server errors can be internal noise ("Cross-cell
// memcached access is not allowed"), so the API's words are only logged.
function describeFailure(status: number): string {
  if (status === 401) {
    return "Notion didn't accept this device's secret. Disconnect and connect Notion again from the settings menu.";
  }
  if (status === 403 || status === 404) {
    return "Notion can't find the database any more. Open it in Notion, choose ••• › Connections, and check your integration is still there.";
  }
  if (status === 429) return "Notion is busy right now. Try again in a minute.";
  if (status === 400) {
    return "Notion turned that change down. Check the database's Done, Date, Order and Status columns haven't changed type.";
  }
  return "Notion had a problem on its side. Try again in a moment.";
}

export class NotionError extends Error {
  // What the app shows. The message itself is for the logs: Notion's own
  // wording when the error came from the API.
  readonly userMessage: string;

  constructor(
    message: string,
    // Notion's HTTP status, when the error came from the API
    readonly status?: number,
    // Notion's error code and request id, for the logs
    readonly code?: string,
    readonly requestId?: string,
  ) {
    super(message);
    // An error the app raised itself is already written for people
    this.userMessage = status === undefined ? message : describeFailure(status);
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
  select?: { name: string } | null;
  status?: { name: string } | null;
}

interface NotionPage {
  id: string;
  archived?: boolean;
  in_trash?: boolean;
  last_edited_time: string;
  parent?: { database_id?: string };
  properties: Record<string, NotionPropertyValue>;
}

interface NotionStatusSchema {
  options: { id: string; name: string }[];
  groups: { name: string; option_ids: string[] }[];
}

interface NotionDatabase {
  properties: Record<string, { type: string; status?: NotionStatusSchema }>;
}

interface NotionQueryPage {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const sameId = (a: string | undefined, b: string) =>
  !!a && a.replace(/-/g, "").toLowerCase() === b.replace(/-/g, "").toLowerCase();

// Whether a request can be sent twice without changing the outcome: reads,
// queries, and updates that set the same values again. Creating a page can't —
// Notion says a failed write may still have saved, so a retry could add the
// task twice.
const isRepeatable = (method: string, path: string) =>
  method === "GET" || method === "PATCH" || path.endsWith("/query");

// 0.5s, 1s, 2s, give or take, unless Notion says how long to wait
function retryDelay(res: Response | null, attempt: number): number {
  const retryAfter = Number(res?.headers.get("Retry-After"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter, 10) * 1000;
  return 500 * 2 ** attempt * (0.8 + Math.random() * 0.4);
}

async function notionRequest<T>(
  config: NotionConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const repeatable = isRepeatable(method, path);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${NOTION_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Notion-Version": NOTION_VERSION,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).catch(() => null);

    // A dropped connection or a server error may have come after the change
    // landed, so only a repeatable request goes again. A rate limit means
    // nothing was done, so anything does.
    const retry =
      res === null
        ? repeatable
        : res.status === 429 || (repeatable && TRANSIENT_STATUSES.has(res.status));
    if (retry && attempt < MAX_RETRIES) {
      await wait(retryDelay(res, attempt));
      continue;
    }

    if (res === null) {
      throw new NotionError("Couldn't reach Notion. Check the connection and try again.");
    }
    const data = (await res.json().catch(() => null)) as {
      message?: string;
      code?: string;
    } | null;
    if (!res.ok) {
      const error = new NotionError(
        typeof data?.message === "string" ? data.message : `Notion API error (HTTP ${res.status})`,
        res.status,
        typeof data?.code === "string" ? data.code : undefined,
        res.headers.get("x-notion-request-id") ?? undefined,
      );
      console.warn(
        `Notion ${method} ${path.split("?")[0]} failed: ${error.status} ${error.code ?? ""} ${error.message}` +
          (error.requestId ? ` (request ${error.requestId})` : ""),
      );
      throw error;
    }
    return data as T;
  }
}

// --- Schema ------------------------------------------------------------------

// How this database holds a task's status: in the select this app creates, or
// in a native Notion status property someone added themselves.
interface StatusCodec {
  read(value: NotionPropertyValue | undefined): TaskStatus | null;
  write(status: TaskStatus): unknown;
}

interface Schema {
  // The title property's name, whatever the database calls it
  title: string;
  status: StatusCodec;
}

const byName = (name: string | undefined) =>
  (Object.keys(STATUS_NAMES) as TaskStatus[]).find(
    (s) => STATUS_NAMES[s].toLowerCase() === name?.trim().toLowerCase(),
  ) ?? null;

const selectCodec: StatusCodec = {
  // An option this app doesn't know reads as nothing, and the checkbox decides
  read: (value) => byName(value?.select?.name),
  // Writing an option the select lacks makes Notion add it
  write: (status) => ({ select: { name: STATUS_NAMES[status] } }),
};

// A native status property can't be converted or given options through the
// API, but its three groups (To-do, In progress, Complete) are fixed, so each
// option maps onto a state by the group it's in.
function nativeStatusCodec(schema: NotionStatusSchema | undefined): StatusCodec {
  const groupStatus = (group: string): TaskStatus | null => {
    const name = group.toLowerCase().replace(/[^a-z]/g, "");
    return name === "todo"
      ? "todo"
      : name === "inprogress"
        ? "inProgress"
        : name === "complete"
          ? "done"
          : null;
  };
  const byOption = new Map<string, TaskStatus>();
  const firstOption = new Map<TaskStatus, string>();
  for (const group of schema?.groups ?? []) {
    const status = groupStatus(group.name);
    if (!status) continue;
    for (const id of group.option_ids) {
      const option = schema?.options.find((o) => o.id === id);
      if (!option) continue;
      byOption.set(option.name, status);
      if (!firstOption.has(status)) firstOption.set(status, option.name);
    }
  }
  return {
    read: (value) => {
      const name = value?.status?.name;
      return (name !== undefined && byOption.get(name)) || byName(name);
    },
    write: (status) => {
      // Our own name if the property has it, else the first option in the group
      const own = schema?.options.find((o) => byName(o.name) === status)?.name;
      return { status: { name: own ?? firstOption.get(status) ?? STATUS_NAMES[status] } };
    },
  };
}

// Looked up once per connection while the app runs, and on a fresh database
// the properties a task needs are added. A database Largs Hub already
// connected has the core ones. The token is already in this process, so
// unlike the web server's cache it isn't hashed.
const schemas = new Map<string, Promise<Schema>>();

const connectionKey = (config: NotionConfig) => `${config.apiKey}|${config.databaseId}`;

function schemaFor(config: NotionConfig): Promise<Schema> {
  const key = connectionKey(config);
  const cached = schemas.get(key);
  if (cached) return cached;
  const lookup = (async (): Promise<Schema> => {
    const id = config.databaseId;
    const db = await notionRequest<NotionDatabase>(config, "GET", `/databases/${id}`);
    const props = db.properties;
    const title = Object.entries(props).find(([, p]) => p.type === "title")?.[0];
    if (!title) throw new NotionError("This database has no title property.");
    const statusType = props[STATUS_PROP]?.type;
    if (statusType && statusType !== "select" && statusType !== "status") {
      throw new NotionError(
        `This database already has a “${STATUS_PROP}” property that isn't a select. Rename it in Notion and the app will add its own.`,
      );
    }

    const missing: Record<string, unknown> = {};
    if (props["Done"]?.type !== "checkbox") missing["Done"] = { checkbox: {} };
    if (props["Date"]?.type !== "date") missing["Date"] = { date: {} };
    if (props["Order"]?.type !== "number") missing["Order"] = { number: {} };
    if (!props[CARRIED_PROP]) missing[CARRIED_PROP] = { rich_text: {} };
    if (!statusType) {
      missing[STATUS_PROP] = {
        select: {
          options: [
            { name: STATUS_NAMES.todo, color: "gray" },
            { name: STATUS_NAMES.inProgress, color: "blue" },
            { name: STATUS_NAMES.done, color: "green" },
          ],
        },
      };
    }
    if (!props[STARTED_PROP]) missing[STARTED_PROP] = { rich_text: {} };
    if (!props[TIME_LOG_PROP]) missing[TIME_LOG_PROP] = { rich_text: {} };
    if (!props[RUNNING_PROP]) missing[RUNNING_PROP] = { date: {} };
    if (Object.keys(missing).length > 0) {
      await notionRequest(config, "PATCH", `/databases/${id}`, { properties: missing });
    }
    return {
      title,
      status: statusType === "status" ? nativeStatusCodec(props[STATUS_PROP].status) : selectCodec,
    };
  })().catch((err) => {
    // Don't cache a failure — the next request should try again
    schemas.delete(key);
    throw err;
  });
  schemas.set(key, lookup);
  return lookup;
}

// Checks a connection before it's saved: the token works, the database is
// shared with it, and it has (or now has) the properties a task needs.
export async function verifyConnection(config: NotionConfig): Promise<void> {
  await schemaFor(config);
}

// --- Pages <-> tasks ---------------------------------------------------------

const plainText = (rich: NotionRichText[] | undefined) =>
  (rich || []).map((t) => t.plain_text).join("");

const dayList = (value: NotionPropertyValue | undefined) =>
  plainText(value?.rich_text).split(/[\s,]+/);

// A page as a task. Status comes from the Status column when it holds one of
// the three states, otherwise from the Done checkbox — so rows from before
// Status existed, or written by something that only knows Done, read cleanly.
// The logs and the running time are checked on the way in (restoreTask), and
// anything unreadable reads as not recorded, never as an error.
function pageToTask(schema: Schema, page: NotionPage): TodoTask | null {
  const p = page.properties;
  const titleValue = p[schema.title];
  const text = plainText(titleValue?.title ?? titleValue?.rich_text).trim();
  const done = p["Done"]?.checkbox === true;
  return restoreTask({
    id: page.id,
    text: text || "Untitled task",
    status: schema.status.read(p[STATUS_PROP]) ?? (done ? "done" : "todo"),
    date: p["Date"]?.date?.start?.slice(0, 10), // not one of ours / no day: null
    order: p["Order"]?.number ?? 0,
    editedAt: page.last_edited_time,
    carriedFrom: dayList(p[CARRIED_PROP]),
    startedOn: dayList(p[STARTED_PROP]),
    timeLog: plainText(p[TIME_LOG_PROP]?.rich_text),
    runningSince: p[RUNNING_PROP]?.date?.start,
  });
}

export interface TaskPatch {
  text?: string;
  status?: TaskStatus;
  date?: string;
  order?: number;
  carriedFrom?: string[];
  startedOn?: string[];
  timeLog?: Record<string, number>;
  // Null stops the clock
  runningSince?: string | null;
}

export type NewTask = Required<Pick<TaskPatch, "text" | "status" | "date" | "order">> &
  Omit<TaskPatch, "text" | "status" | "date" | "order">;

// A task's status and time as a patch, for writes that carry them along
export const timeFields = (task: TodoTask): TaskPatch => ({
  startedOn: task.startedOn ?? [],
  timeLog: task.timeLog ?? {},
  runningSince: task.runningSince ?? null,
});

// Empty text is written as no text at all
const richText = (content: string) =>
  content ? [{ type: "text", text: { content: content.slice(0, RICH_TEXT_LIMIT) } }] : [];

function buildProperties(schema: Schema, patch: TaskPatch) {
  const properties: Record<string, unknown> = {};
  if (patch.text !== undefined) {
    properties[schema.title] = { title: richText(patch.text) };
  }
  if (patch.status !== undefined) {
    properties[STATUS_PROP] = schema.status.write(patch.status);
    // Always in the same write, so the checkbox can't disagree with Status
    properties["Done"] = { checkbox: patch.status === "done" };
  }
  if (patch.date !== undefined) properties["Date"] = { date: { start: patch.date } };
  if (patch.order !== undefined) properties["Order"] = { number: patch.order };
  if (patch.carriedFrom !== undefined) {
    properties[CARRIED_PROP] = { rich_text: richText(patch.carriedFrom.join(" ")) };
  }
  if (patch.startedOn !== undefined) {
    properties[STARTED_PROP] = { rich_text: richText(patch.startedOn.join(" ")) };
  }
  if (patch.timeLog !== undefined) {
    properties[TIME_LOG_PROP] = { rich_text: richText(formatTimeLog(patch.timeLog)) };
  }
  if (patch.runningSince !== undefined) {
    properties[RUNNING_PROP] = { date: patch.runningSince ? { start: patch.runningSince } : null };
  }
  return properties;
}

// --- Operations --------------------------------------------------------------

export async function queryTasks(config: NotionConfig, filter: unknown): Promise<TodoTask[]> {
  const schema = await schemaFor(config);
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
      const task = pageToTask(schema, page);
      if (task) tasks.push(task);
    }
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return tasks;
}

// A single task, or null when it's gone. Refuses pages from any other
// database the integration can see — the id comes from the URL.
export async function getTask(config: NotionConfig, pageId: string): Promise<TodoTask | null> {
  const schema = await schemaFor(config);
  const page = await notionRequest<NotionPage>(config, "GET", `/pages/${pageId}`).catch((err) => {
    if (err instanceof NotionError && err.status === 404) return null;
    throw err;
  });
  if (!page || page.archived || page.in_trash) return null;
  if (!sameId(page.parent?.database_id, config.databaseId)) return null;
  return pageToTask(schema, page);
}

export async function createTask(config: NotionConfig, task: NewTask): Promise<TodoTask> {
  const schema = await schemaFor(config);
  const page = await notionRequest<NotionPage>(config, "POST", "/pages", {
    parent: { database_id: config.databaseId },
    properties: buildProperties(schema, task),
  });
  const created = pageToTask(schema, page);
  if (!created) throw new NotionError("Notion returned a page without a date.");
  return created;
}

export async function updateTask(
  config: NotionConfig,
  pageId: string,
  patch: TaskPatch,
): Promise<TodoTask> {
  const schema = await schemaFor(config);
  const page = await notionRequest<NotionPage>(config, "PATCH", `/pages/${pageId}`, {
    properties: buildProperties(schema, patch),
  });
  const updated = pageToTask(schema, page);
  if (!updated) throw new NotionError("Notion returned a page without a date.");
  return updated;
}

export async function archiveTask(config: NotionConfig, pageId: string): Promise<void> {
  await notionRequest(config, "PATCH", `/pages/${pageId}`, { archived: true });
}
