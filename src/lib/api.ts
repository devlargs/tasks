// The island's side of the API routes. Every call resolves (never throws) to
// the { ok, error } shape, so a dropped connection reads like any other
// failure.

import { todayKey } from "../components/todo/dates";
import type {
  CalendarResult,
  ConnectResult,
  ImportResult,
  ListResult,
  StatsResult,
  TaskResult,
  TasksResult,
  TodoTask,
} from "./types";

// Where the list reads and writes: the device's Notion database through the
// API routes (notionBackend), or the browser itself (localBackend.ts). The
// list doesn't know which one it has.
export interface TaskBackend {
  list(date: string): Promise<ListResult>;
  calendar(from: string, to: string): Promise<CalendarResult>;
  stats(from: string, to: string): Promise<StatsResult>;
  create(date: string, text: string): Promise<TaskResult>;
  update(id: string, patch: { text?: string; done?: boolean }): Promise<TaskResult>;
  move(id: string, date: string): Promise<TaskResult>;
  remove(id: string): Promise<{ ok: boolean; error?: string }>;
  reorder(date: string, ids: string[]): Promise<TasksResult>;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    const res = await fetch(path, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => null)) as T | null;
    return data ?? ({ ok: false, error: `Server error (HTTP ${res.status})` } as T);
  } catch {
    return { ok: false, error: "You're offline — couldn't reach the server." } as T;
  }
}

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

export const notionBackend: TaskBackend = {
  list: (date) => call<ListResult>("GET", `/api/tasks?${q({ date, today: todayKey() })}`),
  calendar: (from, to) =>
    call<CalendarResult>("GET", `/api/calendar?${q({ from, to, today: todayKey() })}`),
  stats: (from, to) => call<StatsResult>("GET", `/api/stats?${q({ from, to, today: todayKey() })}`),
  create: (date, text) => call<TaskResult>("POST", "/api/tasks", { date, text }),
  update: (id, patch) => call<TaskResult>("PATCH", `/api/tasks/${encodeURIComponent(id)}`, patch),
  move: (id, date) =>
    call<TaskResult>("POST", `/api/tasks/${encodeURIComponent(id)}/move`, {
      date,
      today: todayKey(),
    }),
  remove: (id) =>
    call<{ ok: boolean; error?: string }>("DELETE", `/api/tasks/${encodeURIComponent(id)}`),
  reorder: (date, ids) => call<TasksResult>("POST", "/api/tasks/reorder", { date, ids }),
};

// Connecting this device to a Notion database, and back out again.
export const connection = {
  connect: (apiKey: string, database: string) =>
    call<ConnectResult>("POST", "/api/connect", { apiKey, database }),
  disconnect: () => call<{ ok: boolean; error?: string }>("POST", "/api/disconnect"),
  importTasks: (tasks: TodoTask[]) =>
    call<ImportResult>("POST", "/api/tasks/import", {
      tasks: tasks.map(({ id, text, done, date, order, carriedFrom }) => ({
        id,
        text,
        done,
        date,
        order,
        carriedFrom,
      })),
    }),
};
