// Payload types shared by the API routes and the React island. Pure
// declarations only — this file is bundled into both the server and the client.

// Where a task is in its day: waiting, being worked on, or finished
export type TaskStatus = "todo" | "inProgress" | "done";

export interface TodoTask {
  // The Notion page id for a connected device; a generated "local-…" id for
  // tasks kept on the device.
  id: string;
  text: string;
  // The source of truth for where the task stands
  status: TaskStatus;
  // Always status === "done". Kept so the carry-over, the calendar and anything
  // that only knows finished-or-not (Notion's Done checkbox) read one flag.
  done: boolean;
  // The day this task belongs to, YYYY-MM-DD in the user's local time
  date: string;
  // Manual position within the day (ascending)
  order: number;
  // When it last changed (Notion's last_edited_time for the page)
  editedAt: string;
  // Days this task was left unfinished on and carried off, oldest first. Only
  // recorded from when statistics were added; absent means none recorded.
  carriedFrom?: string[];
  // Days it was picked up (moved into In Progress), oldest first, like
  // carriedFrom. Only recorded from when In Progress was added.
  startedOn?: string[];
  // Whole seconds spent In Progress, per local day. The open run isn't in here
  // until it's banked; see runningSince.
  timeLog?: Record<string, number>;
  // When the open run began, ISO with the device's UTC offset. Only present
  // while the task is In Progress.
  runningSince?: string;
}

// The parts of a task the list changes directly. Time is never sent: the
// backend works it out from the status change and the clock.
export interface TaskUpdate {
  text?: string;
  status?: TaskStatus;
}

// One day's statistics: what got done on it, what was picked up on it, and
// what was left unfinished and carried off it onto a later day
export interface TodoDayStats {
  done: number;
  carried: number;
  started: number;
}

// One day's tally for the calendar view
export interface TodoDaySummary {
  done: number;
  inProgress: number;
  pending: number;
}

export interface ApiError {
  ok: false;
  error: string;
}

export type ApiResult<T> = ({ ok: true } & T) | ApiError;

export type ListResult = ApiResult<{
  tasks: TodoTask[];
  // Ids of tasks just moved onto today from an earlier day, so the UI can
  // show them arriving rather than having them appear out of nowhere.
  carried: string[];
}>;

export type TaskResult = ApiResult<{ task: TodoTask }>;

export type TasksResult = ApiResult<{ tasks: TodoTask[] }>;

export type ConnectResult = ApiResult<{
  // The database's page on notion.so, for the settings menu
  databaseUrl: string | null;
}>;

// Ids of the device's tasks that are now in Notion. Present on failure too:
// a batch can fail part-way through.
export type ImportResult =
  { ok: true; imported: string[] } | { ok: false; error: string; imported?: string[] };

export type StatsResult = ApiResult<{
  // Keyed YYYY-MM-DD; days with nothing done, started or carried are absent
  days: Record<string, TodoDayStats>;
}>;

export type CalendarResult = ApiResult<{
  // Keyed YYYY-MM-DD; days with no tasks are absent
  days: Record<string, TodoDaySummary>;
}>;
