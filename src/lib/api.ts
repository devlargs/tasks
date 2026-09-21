// The island's side of the API routes — the web stand-in for Largs Hub's
// window.electronAPI.todo bridge. Every call resolves (never throws) to the
// { ok, error } shape, so a dropped connection reads like any other failure.

import { todayKey } from "../components/todo/dates";
import type { CalendarResult, ListResult, TaskResult, TasksResult } from "./types";

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

export const api = {
  list: (date: string) =>
    call<ListResult>("GET", `/api/tasks?${q({ date, today: todayKey() })}`),
  calendar: (from: string, to: string) =>
    call<CalendarResult>("GET", `/api/calendar?${q({ from, to, today: todayKey() })}`),
  create: (date: string, text: string) => call<TaskResult>("POST", "/api/tasks", { date, text }),
  update: (id: string, patch: { text?: string; done?: boolean }) =>
    call<TaskResult>("PATCH", `/api/tasks/${encodeURIComponent(id)}`, patch),
  move: (id: string, date: string) =>
    call<TaskResult>("POST", `/api/tasks/${encodeURIComponent(id)}/move`, {
      date,
      today: todayKey(),
    }),
  remove: (id: string) =>
    call<{ ok: boolean; error?: string }>("DELETE", `/api/tasks/${encodeURIComponent(id)}`),
  reorder: (date: string, ids: string[]) =>
    call<TasksResult>("POST", "/api/tasks/reorder", { date, ids }),
};
