import { afterEach, describe, expect, it, vi } from "vitest";
import { connection } from "../src/lib/api";
import {
  createLocalBackend,
  LOCAL_TASKS_KEY,
  readLocalTasks,
  type KeyValueStore,
} from "../src/lib/localBackend";
import { fixedZone, restoreTask } from "../src/lib/tasksLogic";
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

// The device is in Singapore (+08:00): 10:00 UTC is 18:00 there. `at` moves
// its clock along.
const setup = (today = "2026-09-23") => {
  const store = memoryStore();
  let n = 0;
  let clock = "2026-09-23T10:00:00.000Z";
  const backend = createLocalBackend({
    store,
    today: () => today,
    now: () => clock,
    zone: fixedZone(480),
    newId: () => `local-${++n}`,
  });
  const at = (iso: string) => void (clock = iso);
  return { store, backend, at };
};

const stored = (store: KeyValueStore, id: string) => readLocalTasks(store).find((t) => t.id === id);

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

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("renames, and moves a task on through its states", async () => {
    const { store, backend } = setup();
    seed(store, [{ id: "a" }]);
    await backend.update("a", { text: "renamed", status: "inProgress" });
    expect(stored(store, "a")).toMatchObject({ text: "renamed", status: "inProgress" });
    expect((await backend.update("missing", { status: "done" })).ok).toBe(false);
    const bad = await backend.update("a", { status: "sideways" as never });
    expect(bad.ok).toBe(false);
  });

  it("starts, pauses, resumes and finishes a task, timing only In Progress", async () => {
    const { store, backend, at } = setup();
    seed(store, [{ id: "a" }, { id: "b", order: 1 }]);

    // Todo → In Progress at 18:00 local
    const started = await backend.update("a", { status: "inProgress" });
    expect(started.ok && started.task).toMatchObject({
      status: "inProgress",
      done: false,
      runningSince: "2026-09-23T18:00:00+08:00",
      startedOn: ["2026-09-23"],
    });

    // In Progress → Todo half an hour later banks 30 minutes
    at("2026-09-23T10:30:00.000Z");
    await backend.update("a", { status: "todo" });
    expect(stored(store, "a")).toMatchObject({ status: "todo", timeLog: { "2026-09-23": 1800 } });
    expect(stored(store, "a")?.runningSince).toBeUndefined();

    // An hour in Todo adds nothing; picked up again at 19:30 until 20:00
    at("2026-09-23T11:30:00.000Z");
    await backend.update("a", { status: "inProgress" });
    at("2026-09-23T12:00:00.000Z");
    const done = await backend.update("a", { status: "done" });
    expect(done.ok && done.task).toMatchObject({
      status: "done",
      done: true,
      timeLog: { "2026-09-23": 3600 },
    });

    // Un-ticking goes back to In Progress, not Todo, with a new run
    at("2026-09-23T13:00:00.000Z");
    const reopened = await backend.update("a", { status: "inProgress" });
    expect(reopened.ok && reopened.task).toMatchObject({
      status: "inProgress",
      runningSince: "2026-09-23T21:00:00+08:00",
      timeLog: { "2026-09-23": 3600 },
    });
  });

  it("puts a picked-up task at the end of In Progress, and a put-back one on top of Todo", async () => {
    const { store, backend } = setup();
    seed(store, [{ id: "a" }, { id: "b", order: 1 }, { id: "c", order: 2 }]);
    await backend.update("a", { status: "inProgress" });
    await backend.update("c", { status: "inProgress" });
    const order = (id: string) => stored(store, id)?.order ?? NaN;
    expect(order("c")).toBeGreaterThan(order("a"));
    await backend.update("a", { status: "todo" });
    expect(order("a")).toBeLessThan(order("b"));
  });

  it("moves a task to the end of a later day, but never into the past", async () => {
    const { store, backend } = setup();
    seed(store, [{ id: "a" }, { id: "b", date: "2026-09-24", order: 5 }]);
    const res = await backend.move("a", "2026-09-24");
    expect(res.ok && res.task).toMatchObject({ date: "2026-09-24", order: 6 });
    expect((await backend.move("a", "2026-09-22")).ok).toBe(false);
  });

  it("logs carry-overs, and counts them in the statistics", async () => {
    const { store, backend } = setup();
    seed(store, [
      { id: "old", date: "2026-09-21" },
      { id: "today" },
      { id: "done-today", done: true },
      { id: "future", date: "2026-09-25" },
    ]);
    await backend.list("2026-09-23"); // sweeps "old" onto today
    await backend.move("today", "2026-09-24"); // deferred off today
    await backend.move("future", "2026-09-27"); // re-planned, not a carry
    const byId = new Map(readLocalTasks(store).map((t) => [t.id, t]));
    expect(byId.get("old")?.carriedFrom).toEqual(["2026-09-21"]);
    expect(byId.get("today")?.carriedFrom).toEqual(["2026-09-23"]);
    expect(byId.get("future")?.carriedFrom).toBeUndefined();
    const res = await backend.stats("2026-09-20", "2026-09-23");
    expect(res.ok && res.days).toEqual({
      "2026-09-21": { done: 0, carried: 1, started: 0 },
      "2026-09-23": { done: 1, carried: 1, started: 0 },
    });
  });

  it("counts pickups in the statistics", async () => {
    const { store, backend } = setup();
    seed(store, [{ id: "a" }, { id: "b", order: 1 }]);
    await backend.update("a", { status: "inProgress" });
    await backend.update("a", { status: "done" });
    await backend.update("b", { status: "inProgress" });
    const res = await backend.stats("2026-09-23", "2026-09-23");
    expect(res.ok && res.days).toEqual({ "2026-09-23": { done: 1, carried: 0, started: 2 } });
  });

  it("carries an In Progress task onto today still running, with yesterday's time banked", async () => {
    const { store, backend } = setup();
    seed(store, [
      {
        id: "run",
        status: "inProgress",
        date: "2026-09-22",
        startedOn: ["2026-09-22"],
        runningSince: "2026-09-22T22:00:00+08:00",
      },
    ]);
    const res = await backend.list("2026-09-23");
    expect(res.ok && res.carried).toEqual(["run"]);
    expect(stored(store, "run")).toMatchObject({
      status: "inProgress",
      date: "2026-09-23",
      carriedFrom: ["2026-09-22"],
      timeLog: { "2026-09-22": 7200 },
      runningSince: "2026-09-23T00:00:00+08:00",
    });
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

  const running = {
    id: "run",
    status: "inProgress" as const,
    startedOn: ["2026-09-23"],
    timeLog: { "2026-09-22": 60 },
    runningSince: "2026-09-23T17:00:00+08:00",
  };

  it("keeps status and time through a reorder", async () => {
    const { store, backend } = setup();
    seed(store, [running, { id: "b", order: 1 }]);
    await backend.reorder("2026-09-23", ["b", "run"]);
    expect(stored(store, "run")).toMatchObject({ ...running, order: 1 });
  });

  it("keeps a running task running through a move, with its time so far banked", async () => {
    const { store, backend } = setup();
    seed(store, [running]);
    const res = await backend.move("run", "2026-09-24");
    expect(res.ok && res.task).toMatchObject({
      status: "inProgress",
      date: "2026-09-24",
      startedOn: ["2026-09-23"],
      timeLog: { "2026-09-22": 60, "2026-09-23": 3600 },
      runningSince: "2026-09-23T18:00:00+08:00",
    });
  });

  it("counts done, in progress and pending per day for the calendar", async () => {
    const { store, backend } = setup();
    seed(store, [
      { id: "a", date: "2026-09-21", done: true },
      { id: "b", date: "2026-09-23" },
      { id: "p", date: "2026-09-23", status: "inProgress" },
      { id: "c", date: "2026-10-30" },
    ]);
    const res = await backend.calendar("2026-09-01", "2026-09-30");
    expect(res.ok && res.days).toEqual({
      "2026-09-21": { done: 1, inProgress: 0, pending: 0 },
      "2026-09-23": { done: 0, inProgress: 1, pending: 1 },
    });
  });

  it("reads a list saved before In Progress existed", () => {
    const store = memoryStore();
    // Exactly what the previous version wrote: no status, no time
    store.setItem(
      LOCAL_TASKS_KEY,
      JSON.stringify([
        { id: "a", text: "open", done: false, date: "2026-09-23", order: 0, editedAt: "x" },
        { id: "b", text: "finished", done: true, date: "2026-09-23", order: 1, editedAt: "x" },
      ]),
    );
    expect(readLocalTasks(store)).toEqual([
      {
        id: "a",
        text: "open",
        status: "todo",
        done: false,
        date: "2026-09-23",
        order: 0,
        editedAt: "x",
      },
      {
        id: "b",
        text: "finished",
        status: "done",
        done: true,
        date: "2026-09-23",
        order: 1,
        editedAt: "x",
      },
    ]);
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

  it("sends status and time along when the device's tasks are copied into Notion", async () => {
    const store = memoryStore();
    seed(store, [running, { id: "d", done: true, timeLog: { "2026-09-21": 90 } }]);
    const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ ok: true, imported: ["run", "d"] }),
    );
    vi.stubGlobal("fetch", fetch);
    await connection.importTasks(readLocalTasks(store));
    const body = JSON.parse(fetch.mock.calls[0]?.[1].body as string) as { tasks: unknown[] };
    // The import route checks each one the way storage is read (restoreTask)
    const received = body.tasks.map((t) => restoreTask({ ...(t as object), editedAt: "" }));
    expect(received[0]).toMatchObject(running);
    expect(received[1]).toMatchObject({ status: "done", timeLog: { "2026-09-21": 90 } });
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
