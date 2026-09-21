// Payload types shared by the API routes and the React island. Pure
// declarations only — this file is bundled into both the server and the client.

export interface TodoTask {
  // The Notion page id. Unlike Largs Hub, the web app keeps no local store:
  // the page is the task, so its id is the only one there is.
  id: string;
  text: string;
  done: boolean;
  // The day this task belongs to, YYYY-MM-DD in the user's local time
  date: string;
  // Manual position within the day (ascending)
  order: number;
  // Notion's last_edited_time for the page
  editedAt: string;
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

export type CalendarResult = ApiResult<{
  // Keyed YYYY-MM-DD; days with no tasks are absent
  days: Record<string, TodoDaySummary>;
}>;
