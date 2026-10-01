// The list's side of its storage. On the web this is a thin client for the
// API routes; on the phone there's no server in between, so the checks those
// routes make and the Notion calls behind them (notionTasks.ts) run right here.
// Every call still resolves (never throws) to the { ok, error } shape, so a
// dropped connection reads like any other failure.

import { deviceTimeZone, nowIso, todayKey } from "../components/todo/dates";
import { clearConnection, parseConfig, readConnection, saveConnection } from "./connection";
import type { NotionConfig } from "./connection";
import { NotionError, verifyConnection } from "./notion";
import * as notion from "./notionTasks";
import {
  deviceClock,
  isRealDate,
  isSchedulableDate,
  isTaskStatus,
  MAX_CALENDAR_DAYS,
  MAX_STATS_DAYS,
  notionDatabaseUrl,
  sanitizeTaskText,
  shiftDateKey,
  type DeviceClock,
} from "./tasksLogic";
import type {
  CalendarResult,
  ConnectResult,
  ImportResult,
  ListResult,
  StatsResult,
  TaskResult,
  TasksResult,
  TaskUpdate,
  TodoTask,
} from "./types";

// Where the list reads and writes: the device's Notion database
// (notionBackend), or the device itself (localBackend.ts). The list doesn't
// know which one it has.
export interface TaskBackend {
  list(date: string): Promise<ListResult>;
  calendar(from: string, to: string): Promise<CalendarResult>;
  stats(from: string, to: string): Promise<StatsResult>;
  create(date: string, text: string): Promise<TaskResult>;
  update(id: string, patch: TaskUpdate): Promise<TaskResult>;
  move(id: string, date: string): Promise<TaskResult>;
  remove(id: string): Promise<{ ok: boolean; error?: string }>;
  reorder(date: string, ids: string[]): Promise<TasksResult>;
}

type Failure = { ok: false; error: string };

const fail = (error: string): Failure => ({ ok: false, error });

// Notion's own messages are safe to show (they name the problem, not the
// token); anything else is logged and kept vague.
function failure(err: unknown): Failure {
  if (err instanceof NotionError) return fail(err.message);
  console.error(err);
  return fail("Something went wrong.");
}

// The task calls only work once this device has connected a Notion database,
// and run against that connection.
async function withNotion<T>(run: (config: NotionConfig) => Promise<T>): Promise<T | Failure> {
  const config = readConnection();
  if (!config) return fail("Not connected to Notion — restart the app.");
  try {
    return await run(config);
  } catch (err) {
    return failure(err);
  }
}

// The device's day and clock. deviceClock still checks them, so the time a
// status change banks is worked out exactly as the web server does it.
const clock = (): DeviceClock => deviceClock(nowIso(), deviceTimeZone(), new Date());

export const notionBackend: TaskBackend = {
  list: (date) =>
    withNotion(async (config): Promise<ListResult> => {
      if (!isRealDate(date)) return fail("Invalid date.");
      return { ok: true, ...(await notion.listTasks(config, date, todayKey(), clock())) };
    }),

  calendar: (from, to) =>
    withNotion(async (config): Promise<CalendarResult> => {
      if (!isRealDate(from) || !isRealDate(to) || from > to) return fail("Invalid date range.");
      // A month grid is at most six weeks; anything wider is a bad caller
      if (shiftDateKey(from, MAX_CALENDAR_DAYS) < to) return fail("Date range too long.");
      return { ok: true, days: await notion.calendar(config, from, to, todayKey(), clock()) };
    }),

  stats: (from, to) =>
    withNotion(async (config): Promise<StatsResult> => {
      if (!isRealDate(from) || !isRealDate(to) || from > to) return fail("Invalid date range.");
      if (shiftDateKey(from, MAX_STATS_DAYS) < to) return fail("Date range too long.");
      return { ok: true, days: await notion.stats(config, from, to, todayKey(), clock()) };
    }),

  create: (date, rawText) =>
    withNotion(async (config): Promise<TaskResult> => {
      if (!isRealDate(date)) return fail("Invalid date.");
      const text = sanitizeTaskText(rawText);
      if (!text) return fail("Task text is required.");
      return { ok: true, task: await notion.create(config, date, text) };
    }),

  update: (id, change) =>
    withNotion(async (config): Promise<TaskResult> => {
      const patch: TaskUpdate = {};
      if (change.text !== undefined) {
        const text = sanitizeTaskText(change.text);
        if (!text) return fail("Task text is required.");
        patch.text = text;
      }
      if (change.status !== undefined) {
        if (!isTaskStatus(change.status)) return fail("Invalid status.");
        patch.status = change.status;
      }
      const task = await notion.update(config, id, patch, clock());
      return task ? { ok: true, task } : fail("Task not found.");
    }),

  // Defer (the next day) and schedule (a picked day) both land here. Only today
  // or later: an earlier day would carry the task straight back onto today.
  move: (id, date) =>
    withNotion(async (config): Promise<TaskResult> => {
      const today = todayKey();
      if (!isSchedulableDate(date, today)) return fail("Pick today or a later day.");
      const task = await notion.move(config, id, date, today, clock());
      return task ? { ok: true, task } : fail("Task not found.");
    }),

  remove: (id) =>
    withNotion(async (config) => {
      await notion.remove(config, id);
      return { ok: true };
    }),

  reorder: (date, ids) =>
    withNotion(async (config): Promise<TasksResult> => {
      if (!isRealDate(date)) return fail("Invalid date.");
      return { ok: true, tasks: await notion.reorder(config, date, ids) };
    }),
};

// Connecting this device to a Notion database, and back out again.
export const connection = {
  // Checks the token and database work together, then keeps them in the
  // device's secure storage.
  async connect(apiKey: string, database: string): Promise<ConnectResult> {
    const config = parseConfig(apiKey, database);
    if (!config) return fail("Paste the integration's secret and the database's link or ID.");
    try {
      await verifyConnection(config);
    } catch (err) {
      // Notion's own wording for these two is accurate but doesn't say what to do
      if (err instanceof NotionError && err.status === 401) {
        return fail("Notion didn't accept that secret. Copy it again from the integration's page.");
      }
      if (err instanceof NotionError && (err.status === 404 || err.status === 400)) {
        return fail(
          "Notion can't find that database. Open it in Notion, choose ••• › Connections, and add your integration.",
        );
      }
      return failure(err);
    }
    try {
      await saveConnection(config);
    } catch {
      return fail("Couldn't save the connection on this device.");
    }
    return { ok: true, databaseUrl: notionDatabaseUrl(config.databaseId) };
  },

  // Forgets this device's Notion connection. The database itself is untouched.
  async disconnect(): Promise<{ ok: boolean; error?: string }> {
    try {
      await clearConnection();
      return { ok: true };
    } catch {
      return fail("Couldn't forget the connection on this device.");
    }
  },

  // Copies tasks kept on the device into Notion, as the device connects. The
  // reply lists the ids that made it, even when a later one failed.
  importTasks: (tasks: TodoTask[]): Promise<ImportResult> =>
    withNotion(async (config): Promise<ImportResult> => {
      const { imported, error } = await notion.importTasks(
        config,
        tasks.map((t) => ({
          id: t.id,
          text: t.text,
          status: t.status,
          date: t.date,
          order: t.order,
          carriedFrom: t.carriedFrom,
          startedOn: t.startedOn,
          timeLog: t.timeLog,
          runningSince: t.runningSince,
        })),
      );
      if (!error) return { ok: true, imported };
      // Say which ones made it, alongside the usual error
      return { ...failure(error), imported };
    }),
};
