// Task operations behind the API routes — the web counterpart of the IPC
// handlers in Largs Hub's electron/tasks.ts, with Notion in place of the local
// store.

import {
  carryOverPending,
  nextOrder,
  reorderTasks,
  sortTasks,
  summarizeDays,
  tasksForDate,
  topOrder,
} from "../tasksLogic";
import type { TodoDaySummary, TodoTask } from "../types";
import {
  archiveTask,
  createTask,
  getTask,
  NotionError,
  queryTasks,
  updateTask,
  type TaskPatch,
} from "./notion";

export { NotionError };

const onDay = (date: string) => ({ property: "Date", date: { equals: date } });

export const listDay = async (date: string) => sortTasks(await queryTasks(onDay(date)));

// Writes one at a time: Notion rate-limits bursts, and the rows are few.
async function applyPatches(patches: { id: string; patch: TaskPatch }[]): Promise<TodoTask[]> {
  const updated: TodoTask[] = [];
  for (const { id, patch } of patches) updated.push(await updateTask(id, patch));
  return updated;
}

// Unfinished work is never left stranded on a day that has passed: reading
// today's list first moves every open task from an earlier day onto today —
// the same sweep Largs Hub runs (issue #107), so whichever client opens today
// first does it and the other finds nothing left to move.
export async function carryIntoToday(today: string): Promise<string[]> {
  const backlog = await queryTasks({
    and: [
      { property: "Done", checkbox: { equals: false } },
      { property: "Date", date: { before: today } },
    ],
  });
  if (backlog.length === 0) return [];
  const moves = carryOverPending(backlog, await listDay(today), today);
  await applyPatches(moves.map((t) => ({ id: t.id, patch: { date: t.date, order: t.order } })));
  return moves.map((t) => t.id);
}

export async function listTasks(date: string, today: string) {
  const carried = date === today ? await carryIntoToday(today) : [];
  return { tasks: await listDay(date), carried };
}

export async function calendar(
  from: string,
  to: string,
  today: string,
): Promise<Record<string, TodoDaySummary>> {
  // Swept first so an open task isn't counted as pending on a past day it is
  // about to leave
  await carryIntoToday(today);
  const tasks = await queryTasks({
    and: [
      { property: "Date", date: { on_or_after: from } },
      { property: "Date", date: { on_or_before: to } },
    ],
  });
  return summarizeDays(tasks, from, to);
}

export async function create(date: string, text: string): Promise<TodoTask> {
  // Newest first: a task you just typed is the one you're looking at, so it
  // lands above the day's existing list rather than under it.
  const order = topOrder(await listDay(date), date);
  return createTask({ text, done: false, date, order });
}

export async function update(id: string, patch: { text?: string; done?: boolean }) {
  return (await getTask(id)) ? updateTask(id, patch) : null;
}

// Move a task onto another day, appended after whatever is already there —
// the same landing spot the carry-over uses. Null when the task is gone.
export async function move(id: string, toDate: string): Promise<TodoTask | null> {
  const task = await getTask(id);
  if (!task) return null;
  if (task.date === toDate) return task;
  const order = nextOrder(await listDay(toDate), toDate);
  return updateTask(id, { date: toDate, order });
}

export async function remove(id: string): Promise<void> {
  if (await getTask(id)) await archiveTask(id);
}

export async function reorder(date: string, ids: string[]): Promise<TodoTask[]> {
  const day = await listDay(date);
  const { tasks, changed } = reorderTasks(day, date, ids);
  const written = new Map(
    (await applyPatches(changed.map((t) => ({ id: t.id, patch: { order: t.order } })))).map(
      (t) => [t.id, t],
    ),
  );
  return tasksForDate(
    tasks.map((t) => written.get(t.id) ?? t),
    date,
  );
}
