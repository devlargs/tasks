import { describe, expect, it } from "vitest";
import {
  createLocalBackend,
  LOCAL_TASKS_KEY,
  readLocalTasks,
  type KeyValueStore,
} from "../src/lib/localBackend";
import type { TodoTask } from "../src/lib/types";

const memoryStore = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
};

const setup = (today = "2026-09-23") => {
  const store = memoryStore();
  let n = 0;
  const backend = createLocalBackend({
    store,
    today: () => today,
    now: () => "2026-09-23T10:00:00.000Z",
    newId: () => `local-${++n}`,
  });
  return { store, backend };
};

const seed = (store: KeyValueStore, tasks: Partial<TodoTask>[]) =>
  store.setItem(
    LOCAL_TASKS_KEY,
    JSON.stringify(
      tasks.map((t, i) => ({
        id: `t${i}`,
        text: `task ${i}`,
        done: false,
        date: "2026-09-23",
        order: i,
        editedAt: "2026-09-20T00:00:00.000Z",
        ...t,
      })),
    ),
  );

describe("local backend", () => {
  it("adds new tasks at the top of the day", async () => {
    const { backend } = setup();
    await backend.create("2026-09-23", "first");
    await backend.create("2026-09-23", "second");
    const res = await backend.list("2026-09-23");
    expect(res.ok && res.tasks.map((t) => t.text)).toEqual(["second", "first"]);
  });

  it("refuses empty text and bad dates", async () => {
    const { backend } = setup();
    expect((await backend.create("2026-09-23", "   ")).ok).toBe(false);
    expect((await backend.create("2026-02-30", "x")).ok).toBe(false);
  });

  it("carries unfinished tasks from earlier days onto today, and reports them", async () => {
    const { store, backend } = setup();
    seed(store, [
      { id: "old-open", date: "2026-09-20" },
      { id: "old-done", date: "2026-09-20", done: true },
      { id: "today", date: "2026-09-23", order: 0 },
    ]);
    const res = await backend.list("2026-09-23");
    expect(res.ok && res.carried).toEqual(["old-open"]);
    expect(res.ok && res.tasks.map((t) => t.id)).toEqual(["today", "old-open"]);
    // Finished work stays on the day it was done
    const past = await backend.list("2026-09-20");
    expect(past.ok && past.tasks.map((t) => t.id)).toEqual(["old-done"]);
  });

  it("doesn't carry anything when looking at another day", async () => {
    const { store, backend } = setup();
    seed(store, [{ id: "old-open", date: "2026-09-20" }]);
    const res = await backend.list("2026-09-20");
    expect(res.ok && res.carried).toEqual([]);
    expect(res.ok && res.tasks.map((t) => t.id)).toEqual(["old-open"]);
  });

  it("renames and checks off", async () => {
    const { store, backend } = setup();
    seed(store, [{ id: "a" }]);
    await backend.update("a", { text: "renamed", done: true });
    expect(readLocalTasks(store)[0]).toMatchObject({ text: "renamed", done: true });
    expect((await backend.update("missing", { done: true })).ok).toBe(false);
  });

  it("moves a task to the end of a later day, but never into the past", async () => {
    const { store, backend } = setup();
    seed(store, [{ id: "a" }, { id: "b", date: "2026-09-24", order: 5 }]);
    const res = await backend.move("a", "2026-09-24");
    expect(res.ok && res.task).toMatchObject({ date: "2026-09-24", order: 6 });
    expect((await backend.move("a", "2026-09-22")).ok).toBe(false);
  });

  it("deletes, and treats deleting a missing task as done", async () => {
    const { store, backend } = setup();
    seed(store, [{ id: "a" }, { id: "b" }]);
    await backend.remove("a");
    expect(readLocalTasks(store).map((t) => t.id)).toEqual(["b"]);
    expect((await backend.remove("a")).ok).toBe(true);
  });

  it("reorders a day", async () => {
    const { store, backend } = setup();
    seed(store, [{ id: "a" }, { id: "b" }, { id: "c" }]);
    const res = await backend.reorder("2026-09-23", ["c", "a", "b"]);
    expect(res.ok && res.tasks.map((t) => t.id)).toEqual(["c", "a", "b"]);
  });

  it("counts done and pending per day for the calendar", async () => {
    const { store, backend } = setup();
    seed(store, [
      { id: "a", date: "2026-09-21", done: true },
      { id: "b", date: "2026-09-23" },
      { id: "c", date: "2026-10-30" },
    ]);
    const res = await backend.calendar("2026-09-01", "2026-09-30");
    expect(res.ok && res.days).toEqual({
      "2026-09-21": { done: 1, pending: 0 },
      "2026-09-23": { done: 0, pending: 1 },
    });
  });

  it("clears storage when the last task goes", async () => {
    const { store, backend } = setup();
    seed(store, [{ id: "a" }]);
    await backend.remove("a");
    expect(store.data.has(LOCAL_TASKS_KEY)).toBe(false);
  });

  it("reads corrupt or foreign storage as empty and skips malformed rows", () => {
    const store = memoryStore();
    store.setItem(LOCAL_TASKS_KEY, "not json");
    expect(readLocalTasks(store)).toEqual([]);
    store.setItem(LOCAL_TASKS_KEY, JSON.stringify([{ id: "x" }, null, 5]));
    expect(readLocalTasks(store)).toEqual([]);
  });

  it("reports a write that storage refuses instead of throwing", async () => {
    const store = memoryStore();
    store.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    const backend = createLocalBackend({ store, today: () => "2026-09-23" });
    const res = await backend.create("2026-09-23", "x");
    expect(res.ok).toBe(false);
  });
});
