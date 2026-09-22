// Payload types shared by the API routes and the React island. Pure
// declarations only — this file is bundled into both the server and the client.

export interface TodoTask {
  // The Notion page id for a connected device; a generated "local-…" id for
  // tasks kept on the device.
  id: string;
  text: string;
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
}

// One day's statistics: what got done on it, and what was left unfinished and
// carried off it onto a later day
export interface TodoDayStats {
  done: number;
  carried: number;
}

// One day's tally for the calendar view
export interface TodoDaySummary {
  done: number;
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
  // Keyed YYYY-MM-DD; days with nothing done or carried are absent
  days: Record<string, TodoDayStats>;
}>;

export type CalendarResult = ApiResult<{
  // Keyed YYYY-MM-DD; days with no tasks are absent
  days: Record<string, TodoDaySummary>;
}>;
