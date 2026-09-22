// Task operations behind the API routes, against the visitor's own Notion
// database. src/lib/localBackend.ts runs the same operations on the device for
// visitors who keep their tasks locally.

import {
  carryOverPending,
  isCarry,
  logCarry,
  summarizeStats,
  nextOrder,
  reorderTasks,
  sortTasks,
  summarizeDays,
  tasksForDate,
  topOrder,
} from "../tasksLogic";
import type { TodoDaySummary, TodoTask } from "../types";
import type { NotionConfig } from "./connection";
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

export const listDay = async (config: NotionConfig, date: string) =>
  sortTasks(await queryTasks(config, onDay(date)));

// Writes one at a time: Notion rate-limits bursts, and the rows are few.
async function applyPatches(
  config: NotionConfig,
  patches: { id: string; patch: TaskPatch }[],
): Promise<TodoTask[]> {
  const updated: TodoTask[] = [];
  for (const { id, patch } of patches) updated.push(await updateTask(config, id, patch));
  return updated;
}

// Unfinished work is never left stranded on a day that has passed: reading
// today's list first moves every open task from an earlier day onto today —
// the same sweep Largs Hub runs (issue #107), so whichever client opens today
// first does it and the other finds nothing left to move.
export async function carryIntoToday(config: NotionConfig, today: string): Promise<string[]> {
  const backlog = await queryTasks(config, {
    and: [
      { property: "Done", checkbox: { equals: false } },
      { property: "Date", date: { before: today } },
    ],
  });
  if (backlog.length === 0) return [];
  const moves = carryOverPending(backlog, await listDay(config, today), today);
  await applyPatches(
    config,
    moves.map((t) => ({
      id: t.id,
      patch: { date: t.date, order: t.order, carriedFrom: t.carriedFrom },
    })),
  );
  return moves.map((t) => t.id);
}

export async function listTasks(config: NotionConfig, date: string, today: string) {
  const carried = date === today ? await carryIntoToday(config, today) : [];
  return { tasks: await listDay(config, date), carried };
}

export async function calendar(
  config: NotionConfig,
  from: string,
  to: string,
  today: string,
): Promise<Record<string, TodoDaySummary>> {
  // Swept first so an open task isn't counted as pending on a past day it is
  // about to leave
  await carryIntoToday(config, today);
  const tasks = await queryTasks(config, {
    and: [
      { property: "Date", date: { on_or_after: from } },
      { property: "Date", date: { on_or_before: to } },
    ],
  });
  return summarizeDays(tasks, from, to);
}

export async function create(config: NotionConfig, date: string, text: string) {
  // Newest first: a task you just typed is the one you're looking at, so it
  // lands above the day's existing list rather than under it.
  const order = topOrder(await listDay(config, date), date);
  return createTask(config, { text, done: false, date, order });
}

export async function update(
  config: NotionConfig,
  id: string,
  patch: { text?: string; done?: boolean },
) {
  return (await getTask(config, id)) ? updateTask(config, id, patch) : null;
}

// Move a task onto another day, appended after whatever is already there —
// the same landing spot the carry-over uses. Null when the task is gone.
export async function move(
  config: NotionConfig,
  id: string,
  toDate: string,
  today: string,
): Promise<TodoTask | null> {
  const task = await getTask(config, id);
  if (!task) return null;
  if (task.date === toDate) return task;
  const order = nextOrder(await listDay(config, toDate), toDate);
  // Leaving today (or an earlier day) unfinished counts as carrying it over
  const carriedFrom = isCarry(task, toDate, today)
    ? logCarry(task, task.date).carriedFrom
    : undefined;
  return updateTask(config, id, { date: toDate, order, carriedFrom });
}

// Done and carried-over counts per day, for the statistics view. Every task
// carried off a day in the range now sits on or after `from`, so one query
// from there on finds them all.
export async function stats(config: NotionConfig, from: string, to: string, today: string) {
  await carryIntoToday(config, today);
  const tasks = await queryTasks(config, { property: "Date", date: { on_or_after: from } });
  return summarizeStats(tasks, from, to);
}

export async function remove(config: NotionConfig, id: string): Promise<void> {
  if (await getTask(config, id)) await archiveTask(config, id);
}

// Copies tasks kept on a device into Notion when it connects, keeping each
// one's day, place and done state. One at a time, and it reports which ones
// made it even when a later one fails, so the device only drops the tasks
// that are really in Notion and a retry doesn't create duplicates.
export async function importTasks(
  config: NotionConfig,
  tasks: {
    id: string;
    text: string;
    done: boolean;
    date: string;
    order: number;
    carriedFrom?: string[];
  }[],
): Promise<{ imported: string[]; error?: unknown }> {
  const imported: string[] = [];
  for (const { id, ...task } of tasks) {
    try {
      await createTask(config, task);
    } catch (error) {
      return { imported, error };
    }
    imported.push(id);
  }
  return { imported };
}

export async function reorder(config: NotionConfig, date: string, ids: string[]) {
  const day = await listDay(config, date);
  const { tasks, changed } = reorderTasks(day, date, ids);
  const written = new Map(
    (
      await applyPatches(
        config,
        changed.map((t) => ({ id: t.id, patch: { order: t.order } })),
      )
    ).map((t) => [t.id, t]),
  );
  return tasksForDate(
    tasks.map((t) => written.get(t.id) ?? t),
    date,
  );
}
