// Tasks kept on the device, for people who don't connect Notion. The same
// operations notionTasks.ts runs against Notion — carry over, newest-first
// adds, moves to the end of a day, drag reorders — on the same pure rules from
// tasksLogic.ts, over a JSON list in the device's key-value store (storage.ts).
//
// The web app's src/lib/localBackend.ts, changed only where React Native
// differs: ids come from expo-crypto, since Hermes has no crypto.randomUUID.

import { randomUUID } from "expo-crypto";
import type { TaskBackend } from "./api";
import {
  bankElapsed,
  carryOverPending,
  changeStatus,
  formatInstant,
  isCarry,
  isTaskStatus,
  logCarry,
  MAX_STATS_DAYS,
  restoreTask,
  shiftDateKey,
  summarizeStats,
  isRealDate,
  isSchedulableDate,
  nextOrder,
  reorderTasks,
  sanitizeTaskText,
  summarizeDays,
  tasksForDate,
  topOrder,
  type DeviceClock,
  type ZoneOffset,
} from "./tasksLogic";
import type { TodoTask } from "./types";

export const LOCAL_TASKS_KEY = "tasks:local:v1";
export const LOCAL_ID_PREFIX = "local-";

// The slice of the Storage API this needs, so tests can hand in a Map. On the
// phone it's expo-sqlite's synchronous key-value store (storage.ts).
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// A list saved before In Progress existed has no status on its tasks; they're
// read as done or todo by their done flag, with no time recorded, so nobody
// loses their list to the upgrade. It's written back in the new shape on the
// next change.
export function readLocalTasks(store: KeyValueStore): TodoTask[] {
  try {
    const data = JSON.parse(store.getItem(LOCAL_TASKS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(data)) return [];
    return data.map(restoreTask).filter((t): t is TodoTask => t !== null);
  } catch {
    return [];
  }
}

export function writeLocalTasks(store: KeyValueStore, tasks: TodoTask[]): void {
  if (tasks.length === 0) store.removeItem(LOCAL_TASKS_KEY);
  else store.setItem(LOCAL_TASKS_KEY, JSON.stringify(tasks));
}

interface LocalBackendOptions {
  store: KeyValueStore;
  // The device's today, YYYY-MM-DD
  today: () => string;
  now?: () => string;
  // The device's calendar, for splitting time across days. The phone's own
  // time zone unless a test says otherwise.
  zone?: ZoneOffset;
  newId?: () => string;
}

export function createLocalBackend({
  store,
  today,
  now = () => new Date().toISOString(),
  zone = (ms) => -new Date(ms).getTimezoneOffset(),
  newId = () => `${LOCAL_ID_PREFIX}${randomUUID()}`,
}: LocalBackendOptions): TaskBackend {
  const read = () => readLocalTasks(store);
  // The same moment as `now`, written the way the Notion routes receive it
  const clock = (): DeviceClock => {
    const ms = Date.parse(now());
    return { now: formatInstant(ms, zone(ms)), zone };
  };
  // A write that can't land (storage full or blocked) is reported, not thrown
  const save = (tasks: TodoTask[]): string | null => {
    try {
      writeLocalTasks(store, tasks);
      return null;
    } catch {
      return "Couldn't save on this device — its storage is full or blocked.";
    }
  };

  // Unfinished work from earlier days moves onto today, as it does in Notion
  const carryIntoToday = (tasks: TodoTask[], day: string) => {
    const moves = carryOverPending(tasks, tasksForDate(tasks, day), day, clock());
    if (moves.length === 0) return { tasks, carried: [] as string[] };
    const stamp = now();
    const moved = new Map(moves.map((t) => [t.id, { ...t, editedAt: stamp }]));
    return { tasks: tasks.map((t) => moved.get(t.id) ?? t), carried: [...moved.keys()] };
  };

  const findTask = (tasks: TodoTask[], id: string) => tasks.find((t) => t.id === id);

  return {
    async list(date) {
      if (!isRealDate(date)) return { ok: false, error: "Invalid date." };
      let tasks = read();
      let carried: string[] = [];
      if (date === today()) {
        ({ tasks, carried } = carryIntoToday(tasks, date));
        if (carried.length > 0) {
          const error = save(tasks);
          if (error) return { ok: false, error };
        }
      }
      return { ok: true, tasks: tasksForDate(tasks, date), carried };
    },

    async calendar(from, to) {
      if (!isRealDate(from) || !isRealDate(to) || from > to) {
        return { ok: false, error: "Invalid date range." };
      }
      // Swept first so an open task isn't counted on a past day it's leaving
      const { tasks, carried } = carryIntoToday(read(), today());
      if (carried.length > 0) save(tasks);
      return { ok: true, days: summarizeDays(tasks, from, to) };
    },

    async stats(from, to) {
      if (!isRealDate(from) || !isRealDate(to) || from > to) {
        return { ok: false, error: "Invalid date range." };
      }
      if (shiftDateKey(from, MAX_STATS_DAYS) < to) {
        return { ok: false, error: "Date range too long." };
      }
      const { tasks, carried } = carryIntoToday(read(), today());
      if (carried.length > 0) save(tasks);
      return { ok: true, days: summarizeStats(tasks, from, to) };
    },

    async create(date, rawText) {
      const text = sanitizeTaskText(rawText);
      if (!isRealDate(date)) return { ok: false, error: "Invalid date." };
      if (!text) return { ok: false, error: "Task text is required." };
      const tasks = read();
      const task: TodoTask = {
        id: newId(),
        text,
        status: "todo",
        done: false,
        date,
        // Newest first, like Notion
        order: topOrder(tasks, date),
        editedAt: now(),
      };
      const error = save([...tasks, task]);
      return error ? { ok: false, error } : { ok: true, task };
    },

    async update(id, patch) {
      const tasks = read();
      const task = findTask(tasks, id);
      if (!task) return { ok: false, error: "Task not found." };
      let next = { ...task, editedAt: now() };
      if (patch.text !== undefined) {
        const text = sanitizeTaskText(patch.text);
        if (!text) return { ok: false, error: "Task text is required." };
        next.text = text;
      }
      if (patch.status !== undefined) {
        if (!isTaskStatus(patch.status)) return { ok: false, error: "Invalid status." };
        const { now: at, zone: calendar } = clock();
        next = changeStatus(next, patch.status, tasks, at, calendar);
      }
      const error = save(tasks.map((t) => (t.id === id ? next : t)));
      return error ? { ok: false, error } : { ok: true, task: next };
    },

    async move(id, date) {
      if (!isSchedulableDate(date, today())) {
        return { ok: false, error: "Pick today or a later day." };
      }
      const tasks = read();
      const task = findTask(tasks, id);
      if (!task) return { ok: false, error: "Task not found." };
      if (task.date === date) return { ok: true, task };
      // Onto the end of that day, where the carry-over would put it. Leaving
      // today (or an earlier day) unfinished counts as carrying it over. A
      // running task keeps running, with its time so far banked.
      const logged = isCarry(task, date, today()) ? logCarry(task, task.date) : task;
      const { now: at, zone: calendar } = clock();
      const banked = bankElapsed(logged, at, calendar);
      const moved = { ...banked, date, order: nextOrder(tasks, date), editedAt: now() };
      const error = save(tasks.map((t) => (t.id === id ? moved : t)));
      return error ? { ok: false, error } : { ok: true, task: moved };
    },

    async remove(id) {
      const tasks = read();
      if (!findTask(tasks, id)) return { ok: true };
      const error = save(tasks.filter((t) => t.id !== id));
      return error ? { ok: false, error } : { ok: true };
    },

    async reorder(date, ids) {
      if (!isRealDate(date)) return { ok: false, error: "Invalid date." };
      const tasks = read();
      const { changed } = reorderTasks(tasks, date, ids);
      if (changed.length === 0) return { ok: true, tasks: tasksForDate(tasks, date) };
      const stamp = now();
      const updates = new Map(changed.map((t) => [t.id, { ...t, editedAt: stamp }]));
      const next = tasks.map((t) => updates.get(t.id) ?? t);
      const error = save(next);
      return error ? { ok: false, error } : { ok: true, tasks: tasksForDate(next, date) };
    },
  };
}
