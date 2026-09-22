// Pure logic for the task list: day keys, ordering, carry-over and validation.
// Ported from Largs Hub's electron/tasksLogic.ts so a day, an order and a
// carry-over mean exactly the same thing on the web as on the desktop — both
// write to the same Notion database. The desktop's sync queue and merge are
// gone: here Notion is read and written directly, so there's nothing to queue.
//
// Kept free of Notion/Astro imports so it can be unit-tested
// (test/tasksLogic.test.ts).

import type { TodoDayStats, TodoTask } from "./types";

export type Task = TodoTask;

// --- Dates -------------------------------------------------------------------

// Local-time YYYY-MM-DD. toISOString() would shift the day for anyone east or
// west of UTC, which is exactly the bug a daily task list can't afford.
export function dateKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isDateKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// Days added to (or subtracted from) a YYYY-MM-DD key, handling month and year
// boundaries via Date's own normalisation.
export function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return dateKey(new Date(y, m - 1, d + days));
}

// A real calendar day: the shape check alone lets "2026-02-30" through.
export function isRealDate(value: unknown): value is string {
  return isDateKey(value) && shiftDateKey(value, 0) === value;
}

// A day a task can be scheduled onto: a real calendar date, today or later.
// An earlier day would be pointless — carry-over moves open tasks straight
// back onto today.
export function isSchedulableDate(value: unknown, today: string): value is string {
  return isRealDate(value) && value >= today;
}

// The server runs in UTC and has no idea where the phone is, so "today" comes
// from the browser. It's still checked: every timezone on Earth is within a
// day of UTC, so anything further out is a bad clock or a bad caller.
export function isPlausibleToday(value: unknown, now: Date): value is string {
  if (!isRealDate(value)) return false;
  const utc = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(
    now.getUTCDate(),
  ).padStart(2, "0")}`;
  return value >= shiftDateKey(utc, -1) && value <= shiftDateKey(utc, 1);
}

// --- Ordering / bucketing ----------------------------------------------------

// Within a day: manual order first, then oldest-first for ties (two tasks can
// share an order when Notion lost the number).
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => a.order - b.order || a.editedAt.localeCompare(b.editedAt));
}

export function tasksForDate(tasks: Task[], date: string): Task[] {
  return sortTasks(tasks.filter((t) => t.date === date));
}

// The widest range the calendar may ask counts for: a month grid is six weeks.
export const MAX_CALENDAR_DAYS = 42;

// Done / pending counts per day for the calendar view, limited to days from
// `from` through `to` inclusive. Days with no tasks are left out.
export function summarizeDays(
  tasks: Task[],
  from: string,
  to: string,
): Record<string, { done: number; pending: number }> {
  const days: Record<string, { done: number; pending: number }> = {};
  for (const task of tasks) {
    if (task.date < from || task.date > to) continue;
    const day = (days[task.date] ||= { done: 0, pending: 0 });
    if (task.done) day.done++;
    else day.pending++;
  }
  return days;
}

export function nextOrder(tasks: Task[], date: string): number {
  const existing = tasks.filter((t) => t.date === date);
  return existing.length === 0 ? 0 : Math.max(...existing.map((t) => t.order)) + 1;
}

// The order that puts a task above everything else in its day. One below the
// current minimum rather than 0-with-a-shift: renumbering the whole day would
// cost a Notion update per row for a single add. Negative orders are fine —
// the list only ever sorts on them, and a drag normalises the day to 0..n-1.
export function topOrder(tasks: Task[], date: string): number {
  const existing = tasks.filter((t) => t.date === date);
  return existing.length === 0 ? 0 : Math.min(...existing.map((t) => t.order)) - 1;
}

// Applies a drag-reorder: ids not in `orderedIds` keep their relative position
// after the ones that are, so a stale list from the browser can't drop tasks.
export function reorderTasks(
  tasks: Task[],
  date: string,
  orderedIds: string[],
): { tasks: Task[]; changed: Task[] } {
  const inDay = tasksForDate(tasks, date);
  const byId = new Map(inDay.map((t) => [t.id, t]));
  const ordered: Task[] = [];
  for (const id of orderedIds) {
    const task = byId.get(id);
    if (task) {
      ordered.push(task);
      byId.delete(id);
    }
  }
  for (const task of inDay) if (byId.has(task.id)) ordered.push(task);

  const changed: Task[] = [];
  const result = ordered.map((task, index) => {
    if (task.order === index) return task;
    const updated = { ...task, order: index };
    changed.push(updated);
    return updated;
  });
  return { tasks: result, changed };
}

// --- Carry over --------------------------------------------------------------

// Moves every unfinished task from any earlier day onto `toDate`, appended
// after whatever is already there, oldest day first so the backlog keeps its
// order. Moving (rather than copying) keeps a past day's history honest — an
// undone task was never part of it — and means an open task is only ever in
// one place: the day you are actually working on (Largs Hub issue #107).
//
// `backlog` is whatever open tasks exist before `toDate`; `onDay` is what's
// already on it. Days compare as strings: YYYY-MM-DD sorts chronologically.
export function carryOverPending(backlog: Task[], onDay: Task[], toDate: string): Task[] {
  const pending = backlog
    .filter((t) => !t.done && t.date < toDate)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.order - b.order || a.editedAt.localeCompare(b.editedAt),
    );
  let order = nextOrder(onDay, toDate);
  return pending.map((task) => ({
    ...logCarry(task, task.date),
    date: toDate,
    order: order++,
  }));
}

// --- Statistics ----------------------------------------------------------------

// A task can bounce along for weeks; the log keeps its most recent days.
export const MAX_CARRY_LOG = 60;

// The widest range the statistics view asks for
export const MAX_STATS_DAYS = 92;

// Records that `task` was left unfinished on `fromDay` and carried off it.
// Kept sorted and unique, so logging the same day twice changes nothing.
export function logCarry(task: Task, fromDay: string): Task {
  const days = new Set(task.carriedFrom ?? []);
  days.add(fromDay);
  return { ...task, carriedFrom: [...days].sort().slice(-MAX_CARRY_LOG) };
}

// Whether moving an unfinished task off `from` onto `to` counts as carrying
// it over: it has to leave today or an earlier day. Re-planning a task from
// one future day to another isn't falling behind.
export function isCarry(task: Task, to: string, today: string): boolean {
  return !task.done && task.date <= today && to > task.date;
}

// Carry logs as they arrive from storage or Notion: real days only, sorted,
// unique, capped. Anything else reads as no log.
export function sanitizeCarryLog(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const days = [...new Set(raw.filter(isRealDate))].sort().slice(-MAX_CARRY_LOG);
  return days.length > 0 ? days : undefined;
}

// Per-day statistics for `from` through `to`. Done counts come from where the
// finished tasks sit; carried counts from every task's carry log. Carrying only
// ever moves a task forward, so every task carried off a day in the range now
// sits on or after `from` — `tasks` needs nothing earlier than that.
export function summarizeStats(
  tasks: Task[],
  from: string,
  to: string,
): Record<string, TodoDayStats> {
  const days: Record<string, TodoDayStats> = {};
  const day = (key: string) => (days[key] ||= { done: 0, carried: 0 });
  for (const task of tasks) {
    if (task.done && task.date >= from && task.date <= to) day(task.date).done++;
    for (const carriedDay of task.carriedFrom ?? []) {
      if (carriedDay >= from && carriedDay <= to) day(carriedDay).carried++;
    }
  }
  return days;
}

// --- Validation --------------------------------------------------------------

export const MAX_TASK_TEXT = 500;

// Tasks copied into Notion per request when a device connects. Small: each one
// is a Notion write, and a request has to finish well inside the server
// function's time limit.
export const MAX_IMPORT_BATCH = 10;

export function sanitizeTaskText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // Newlines would break the single-line row layout; collapse them
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text || text.length > MAX_TASK_TEXT) return null;
  return text;
}

// Accepts a raw ID (dashed or not) or a full Notion URL.
export function normalizeDatabaseId(raw: string): string | null {
  const input = raw.trim();
  const dashed = input.match(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i);
  if (dashed) return dashed[0];
  const plain = input.match(/[0-9a-f]{32}/i);
  return plain ? plain[0] : null;
}

// Notion page ids as they arrive in a URL path: dashed or bare hex.
export function isPageId(value: unknown): value is string {
  return typeof value === "string" && normalizeDatabaseId(value) === value;
}

// The database's own page on notion.so. Notion resolves the bare 32-character
// id and redirects to the full workspace URL, so no workspace slug is needed.
export function notionDatabaseUrl(databaseId: unknown): string | null {
  if (typeof databaseId !== "string") return null;
  const id = normalizeDatabaseId(databaseId);
  return id ? `https://www.notion.so/${id.replace(/-/g, "").toLowerCase()}` : null;
}
