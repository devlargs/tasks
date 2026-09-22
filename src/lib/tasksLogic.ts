// Pure logic for the task list: day keys, ordering, carry-over and validation.
// Ported from Largs Hub's electron/tasksLogic.ts so a day, an order and a
// carry-over mean exactly the same thing on the web as on the desktop — both
// write to the same Notion database. The desktop's sync queue and merge are
// gone: here Notion is read and written directly, so there's nothing to queue.
//
// Kept free of Notion/Astro imports so it can be unit-tested
// (test/tasksLogic.test.ts).

import type { TaskStatus, TodoDayStats, TodoDaySummary, TodoTask } from "./types";

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

// Done / in progress / pending counts per day for the calendar view, limited
// to days from `from` through `to` inclusive. Days with no tasks are left out.
export function summarizeDays(
  tasks: Task[],
  from: string,
  to: string,
): Record<string, TodoDaySummary> {
  const days: Record<string, TodoDaySummary> = {};
  for (const task of tasks) {
    if (task.date < from || task.date > to) continue;
    const day = (days[task.date] ||= { done: 0, inProgress: 0, pending: 0 });
    if (task.status === "done") day.done++;
    else if (task.status === "inProgress") day.inProgress++;
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
//
// A task In Progress stays In Progress. Given the clock, its open run is
// banked on the way, so the time from the days it's leaving is filed under
// those days rather than all landing on whichever day it's finally stopped.
export function carryOverPending(
  backlog: Task[],
  onDay: Task[],
  toDate: string,
  clock?: DeviceClock,
): Task[] {
  const pending = backlog
    .filter((t) => !t.done && t.date < toDate)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.order - b.order || a.editedAt.localeCompare(b.editedAt),
    );
  let order = nextOrder(onDay, toDate);
  return pending.map((task) => ({
    ...logCarry(clock ? bankRun(task, clock.now, clock.zone) : task, task.date),
    date: toDate,
    order: order++,
  }));
}

// --- Statistics ----------------------------------------------------------------

// A task can bounce along for weeks; the log keeps its most recent days.
export const MAX_CARRY_LOG = 60;

// The widest range the statistics view asks for
export const MAX_STATS_DAYS = 92;

// A day log with one more day in it: sorted, unique and capped, so logging the
// same day twice changes nothing
function addDay(days: string[] | undefined, day: string): string[] {
  return [...new Set([...(days ?? []), day])].sort().slice(-MAX_CARRY_LOG);
}

// Records that `task` was left unfinished on `fromDay` and carried off it.
export function logCarry(task: Task, fromDay: string): Task {
  return { ...task, carriedFrom: addDay(task.carriedFrom, fromDay) };
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
// finished tasks sit; carried and started counts from every task's carry and
// pickup logs. Carrying only ever moves a task forward, and a task is picked
// up on its own day or before it was carried, so every task carried off or
// started on a day in the range now sits on or after `from` — `tasks` needs
// nothing earlier than that.
export function summarizeStats(
  tasks: Task[],
  from: string,
  to: string,
): Record<string, TodoDayStats> {
  const days: Record<string, TodoDayStats> = {};
  const day = (key: string) => (days[key] ||= { done: 0, carried: 0, started: 0 });
  const inRange = (key: string) => key >= from && key <= to;
  for (const task of tasks) {
    if (task.status === "done" && inRange(task.date)) day(task.date).done++;
    for (const carriedDay of task.carriedFrom ?? []) {
      if (inRange(carriedDay)) day(carriedDay).carried++;
    }
    for (const startedDay of task.startedOn ?? []) {
      if (inRange(startedDay)) day(startedDay).started++;
    }
  }
  return days;
}

// --- Status ------------------------------------------------------------------

export const TASK_STATUSES: readonly TaskStatus[] = ["todo", "inProgress", "done"];

export function isTaskStatus(value: unknown): value is TaskStatus {
  return TASK_STATUSES.includes(value as TaskStatus);
}

// Moves a task to `status`, keeping the done flag in step and the clock right:
// entering In Progress opens a run, leaving it closes one and banks the time.
// It also finds the task its place: picked up, it joins the end of In
// Progress; put back, it goes to the top of Todo. `day` is the rest of its
// day, for those positions. Finishing it leaves its order alone — done tasks
// sort on their own.
export function changeStatus(
  task: Task,
  status: TaskStatus,
  day: Task[],
  now: string,
  zone?: ZoneOffset,
): Task {
  if (task.status === status) return task;
  const others = day.filter((t) => t.id !== task.id && t.date === task.date);
  const order =
    status === "inProgress"
      ? nextOrder(others, task.date)
      : status === "todo"
        ? topOrder(others, task.date)
        : task.order;
  const timed = status === "inProgress" ? startRun(task, now, zone) : stopRun(task, now, zone);
  return { ...timed, status, done: status === "done", order };
}

// --- Time tracking -------------------------------------------------------------
//
// A task accrues time only while it's In Progress. The open run is a start
// time (runningSince); closing it splits the seconds across the local days it
// covered and adds them to the per-day log. Nothing ticks in the background —
// there's no server process to run at midnight — so a run that crosses a day
// boundary is split whenever it's next touched: stopped, or swept along by the
// carry-over (bankRun).
//
// Every helper here takes the time as an argument rather than reading a clock,
// so the tests can drive them, and takes the device's calendar as a ZoneOffset:
// the server runs in UTC and has no idea where midnight falls for the user.

// The device's UTC offset at an instant, in minutes east. A fixed offset can't
// see a daylight-saving change; a named time zone (namedZone) can.
export type ZoneOffset = (ms: number) => number;

// The device's clock as a request carries it: the moment, and its calendar
export interface DeviceClock {
  now: string;
  zone: ZoneOffset;
}

// A day's worth of seconds can't exceed 25 hours (the long day of a DST change)
const MAX_DAY_SECONDS = 25 * 3600;
// Like the carry log, the time log keeps its most recent days
export const MAX_TIME_LOG = MAX_CARRY_LOG;
// How far the device's clock may be from the server's before the server stops
// trusting it. Beyond this a run's length would be as wrong as the clock.
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;
// Real offsets run from UTC-12 to UTC+14
const MAX_OFFSET_MINUTES = 14 * 60;

const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

// An ISO instant with its offset (Z counts as +00:00), or null for anything
// else — a bare local time would be read in whatever zone the reader is in.
export function parseInstant(value: unknown): { ms: number; offset: number } | null {
  if (typeof value !== "string") return null;
  const match = ISO_INSTANT.exec(value);
  if (!match) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const offset = match[1]
    ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
    : 0;
  if (Math.abs(offset) > MAX_OFFSET_MINUTES) return null;
  return { ms, offset };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

// An instant as ISO with the given offset, to the second:
// 2026-09-23T14:05:00+08:00. Readable in Notion as the device's own time.
export function formatInstant(ms: number, offset: number): string {
  const wall = new Date(Math.floor(ms / 1000) * 1000 + offset * 60_000);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return (
    `${wall.getUTCFullYear()}-${pad2(wall.getUTCMonth() + 1)}-${pad2(wall.getUTCDate())}` +
    `T${pad2(wall.getUTCHours())}:${pad2(wall.getUTCMinutes())}:${pad2(wall.getUTCSeconds())}` +
    `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
  );
}

export const fixedZone =
  (offset: number): ZoneOffset =>
  () =>
    offset;

// A named time zone's offset at any instant, from the runtime's own time zone
// data. Null for a name it doesn't know.
export function namedZone(timeZone: unknown): ZoneOffset | null {
  if (typeof timeZone !== "string" || timeZone.length === 0 || timeZone.length > 64) return null;
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
  } catch {
    return null;
  }
  return (ms) => {
    const part: Record<string, number> = {};
    for (const p of format.formatToParts(ms)) part[p.type] = Number(p.value);
    const wall = Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second);
    return Math.round((wall - Math.floor(ms / 1000) * 1000) / 60_000);
  };
}

// The local calendar day an instant falls on
export function dayAt(ms: number, zone: ZoneOffset): string {
  const wall = new Date(ms + zone(ms) * 60_000);
  return `${wall.getUTCFullYear()}-${pad2(wall.getUTCMonth() + 1)}-${pad2(wall.getUTCDate())}`;
}

// The instant a local day begins. The offset at midnight isn't known until
// midnight is, so it's found by refining a guess; where a zone skips midnight
// (a DST change at 00:00), the day begins at its first real instant.
export function midnightAt(day: string, zone: ZoneOffset): number {
  const [y, m, d] = day.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d);
  const first = wall - zone(wall) * 60_000;
  const second = wall - zone(first) * 60_000;
  const candidates = [first, second].filter((ms) => dayAt(ms, zone) === day);
  return candidates.length > 0 ? Math.min(...candidates) : second;
}

const toSeconds = (ms: number) => Math.floor(ms / 1000);

// Seconds per local day between two instants. A run from 22:00 to 01:00 gives
// two hours to the first day and one to the next; a DST day is as long as it
// really was. Whole seconds, counted so the days always add up to the run.
// `zone` defaults to the end's own offset.
export function splitRunAcrossDays(
  fromIso: string,
  toIso: string,
  zone?: ZoneOffset,
): Record<string, number> {
  const from = parseInstant(fromIso);
  const to = parseInstant(toIso);
  if (!from || !to || to.ms <= from.ms) return {};
  const zoneAt = zone ?? fixedZone(to.offset);
  const days: Record<string, number> = {};
  let cursor = from.ms;
  while (cursor < to.ms) {
    const day = dayAt(cursor, zoneAt);
    const end = Math.min(to.ms, Math.max(cursor + 1, midnightAt(shiftDateKey(day, 1), zoneAt)));
    const seconds = toSeconds(end) - toSeconds(cursor);
    if (seconds > 0) days[day] = (days[day] ?? 0) + seconds;
    cursor = end;
  }
  return days;
}

// Two time logs added together, capped to the most recent days
function mergeTimeLog(
  log: Record<string, number> | undefined,
  add: Record<string, number>,
): Record<string, number> | undefined {
  const merged = { ...log };
  for (const [day, seconds] of Object.entries(add)) merged[day] = (merged[day] ?? 0) + seconds;
  return sanitizeTimeLog(merged);
}

// Opens a run at `now` and logs the day as a pickup. A task that's already
// running keeps its run.
export function startRun(task: Task, now: string, zone?: ZoneOffset): Task {
  if (task.runningSince) return task;
  const at = parseInstant(now);
  if (!at) return task;
  const day = dayAt(at.ms, zone ?? fixedZone(at.offset));
  return { ...task, runningSince: now, startedOn: addDay(task.startedOn, day) };
}

// Closes the open run at `now`, banking its seconds day by day. A task that
// isn't running is returned as it is.
export function stopRun(task: Task, now: string, zone?: ZoneOffset): Task {
  if (task.runningSince === undefined) return task;
  const { runningSince, timeLog, ...rest } = task;
  const log = mergeTimeLog(timeLog, splitRunAcrossDays(runningSince, now, zone));
  return log ? { ...rest, timeLog: log } : rest;
}

// Banks the finished days of an open run and re-opens it at the start of
// `now`'s day, so yesterday's share is filed under yesterday while the task
// carries on running. A run that began today is left alone.
export function bankRun(task: Task, now: string, zone?: ZoneOffset): Task {
  const start = parseInstant(task.runningSince);
  const at = parseInstant(now);
  if (!start || !at) return task;
  const zoneAt = zone ?? fixedZone(at.offset);
  const midnight = midnightAt(dayAt(at.ms, zoneAt), zoneAt);
  if (start.ms >= midnight) return task;
  const reopened = formatInstant(midnight, zoneAt(midnight));
  return { ...stopRun(task, reopened, zoneAt), runningSince: reopened };
}

// Banks everything an open run has so far and keeps it running from `now`.
// A hand move uses it, so the Time log is current the moment the task leaves.
export function bankElapsed(task: Task, now: string, zone?: ZoneOffset): Task {
  if (!parseInstant(task.runningSince) || !parseInstant(now)) return task;
  return { ...stopRun(task, now, zone), runningSince: now };
}

// Everything worked on the task: the banked days plus the open run, if any.
export function totalSeconds(task: Task, now: string): number {
  let seconds = 0;
  for (const value of Object.values(task.timeLog ?? {})) seconds += value;
  const start = parseInstant(task.runningSince);
  const at = parseInstant(now);
  if (start && at) seconds += Math.max(0, toSeconds(at.ms) - toSeconds(start.ms));
  return seconds;
}

// A time log as it arrives from Notion (text: "2026-09-22:3600 2026-09-23:120")
// or from storage (an object). Real days, whole seconds no longer than a day
// can be, most recent days kept. Anything else reads as no log.
export function sanitizeTimeLog(raw: unknown): Record<string, number> | undefined {
  let entries: [string, unknown][];
  if (typeof raw === "string") {
    entries = raw
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((entry): [string, unknown] => {
        const [day, seconds] = entry.split(":");
        return [day, /^\d+$/.test(seconds ?? "") ? Number(seconds) : NaN];
      });
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    entries = Object.entries(raw);
  } else {
    return undefined;
  }
  const valid = entries.filter(
    (entry): entry is [string, number] =>
      isRealDate(entry[0]) &&
      Number.isInteger(entry[1]) &&
      (entry[1] as number) > 0 &&
      (entry[1] as number) <= MAX_DAY_SECONDS,
  );
  if (valid.length === 0) return undefined;
  return Object.fromEntries(valid.sort((a, b) => a[0].localeCompare(b[0])).slice(-MAX_TIME_LOG));
}

// The log as Notion's text column holds it, oldest day first
export function formatTimeLog(log: Record<string, number> | undefined): string {
  return Object.entries(log ?? {})
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, seconds]) => `${day}:${seconds}`)
    .join(" ");
}

// The clock a request says the device has. Its offset gives the day
// boundaries; a named zone that agrees with it gives them across a DST change
// as well. A clock too far from the server's is replaced by the server's time
// (in the same zone), and anything unreadable by the server's time in UTC —
// quietly, since the request itself is fine.
export function deviceClock(now: unknown, timeZone: unknown, serverNow: Date): DeviceClock {
  const at = parseInstant(now);
  if (!at) return { now: formatInstant(serverNow.getTime(), 0), zone: fixedZone(0) };
  const named = namedZone(timeZone);
  const zone = named && named(at.ms) === at.offset ? named : fixedZone(at.offset);
  const trusted = Math.abs(at.ms - serverNow.getTime()) <= MAX_CLOCK_SKEW_MS;
  const ms = trusted ? at.ms : serverNow.getTime();
  return { now: formatInstant(ms, zone(ms)), zone };
}

// A task as it comes back from storage, which may be from before a field
// existed: a task with no status is done or todo by its done flag, and every
// log is re-checked. A run is only kept on a task that's In Progress, so a
// stale copy can't show a clock that isn't running. Null when it isn't a task.
export function restoreTask(value: unknown): Task | null {
  const t = value as Partial<Record<keyof Task, unknown>> | null;
  if (
    !t ||
    typeof t !== "object" ||
    typeof t.id !== "string" ||
    typeof t.text !== "string" ||
    !isRealDate(t.date) ||
    typeof t.order !== "number" ||
    !Number.isFinite(t.order) ||
    typeof t.editedAt !== "string"
  ) {
    return null;
  }
  const status: TaskStatus = isTaskStatus(t.status) ? t.status : t.done === true ? "done" : "todo";
  const task: Task = {
    id: t.id,
    text: t.text,
    status,
    done: status === "done",
    date: t.date,
    order: t.order,
    editedAt: t.editedAt,
  };
  const carriedFrom = sanitizeCarryLog(t.carriedFrom);
  if (carriedFrom) task.carriedFrom = carriedFrom;
  const startedOn = sanitizeCarryLog(t.startedOn);
  if (startedOn) task.startedOn = startedOn;
  const timeLog = sanitizeTimeLog(t.timeLog);
  if (timeLog) task.timeLog = timeLog;
  if (status === "inProgress" && parseInstant(t.runningSince)) {
    task.runningSince = t.runningSince as string;
  }
  return task;
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
