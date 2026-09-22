import { describe, expect, it } from "vitest";
import { niceCeiling, rangeDays, statsRows, statsTotals } from "../src/components/todo/stats";
import {
  isCarry,
  logCarry,
  MAX_CARRY_LOG,
  sanitizeCarryLog,
  shiftDateKey,
  summarizeStats,
} from "../src/lib/tasksLogic";
import type { TodoTask } from "../src/lib/types";

// Status follows `done` unless it's given, and `done` always follows status
const task = (overrides: Partial<TodoTask>): TodoTask => {
  const status = overrides.status ?? (overrides.done ? "done" : "todo");
  return {
    id: "t",
    text: "a task",
    date: "2026-09-23",
    order: 0,
    editedAt: "2026-09-23T09:00:00.000Z",
    ...overrides,
    status,
    done: status === "done",
  };
};

describe("carry log", () => {
  it("records each day once, in order", () => {
    let t = task({ date: "2026-09-21" });
    t = logCarry(t, "2026-09-22");
    t = logCarry(t, "2026-09-20");
    t = logCarry(t, "2026-09-22");
    expect(t.carriedFrom).toEqual(["2026-09-20", "2026-09-22"]);
  });

  it("keeps only the most recent days", () => {
    let t = task({});
    for (let i = 0; i < MAX_CARRY_LOG + 5; i++) t = logCarry(t, shiftDateKey("2026-01-01", i));
    expect(t.carriedFrom).toHaveLength(MAX_CARRY_LOG);
    expect(t.carriedFrom?.at(-1)).toBe(shiftDateKey("2026-01-01", MAX_CARRY_LOG + 4));
  });

  it("reads anything that isn't a list of real days as no log", () => {
    expect(sanitizeCarryLog("2026-09-20")).toBeUndefined();
    expect(sanitizeCarryLog([])).toBeUndefined();
    expect(sanitizeCarryLog(["2026-02-30", "x", 5])).toBeUndefined();
    expect(sanitizeCarryLog(["2026-09-22", "2026-09-20", "2026-09-22"])).toEqual([
      "2026-09-20",
      "2026-09-22",
    ]);
  });
});

describe("isCarry", () => {
  const today = "2026-09-23";

  it("counts leaving today or an earlier day unfinished", () => {
    expect(isCarry(task({ date: today }), "2026-09-24", today)).toBe(true);
    expect(isCarry(task({ date: "2026-09-20" }), today, today)).toBe(true);
  });

  it("doesn't count re-planning between future days, or finished tasks", () => {
    expect(isCarry(task({ date: "2026-09-25" }), "2026-09-28", today)).toBe(false);
    expect(isCarry(task({ date: today, done: true }), "2026-09-24", today)).toBe(false);
  });
});

describe("summarizeStats", () => {
  it("counts done where tasks sit, and carried and started from every log", () => {
    const tasks = [
      task({ id: "a", date: "2026-09-21", done: true, startedOn: ["2026-09-21"] }),
      task({
        id: "b",
        date: "2026-09-23",
        status: "inProgress",
        carriedFrom: ["2026-09-21", "2026-09-22"],
        startedOn: ["2026-09-22"],
      }),
      task({ id: "c", date: "2026-09-23", done: true, carriedFrom: ["2026-09-22"] }),
      task({ id: "d", date: "2026-09-10", done: true, startedOn: ["2026-09-10"] }),
      // Picked up twice: once on each day it was worked on
      task({ id: "e", date: "2026-09-23", done: true, startedOn: ["2026-09-20", "2026-09-23"] }),
    ];
    expect(summarizeStats(tasks, "2026-09-20", "2026-09-23")).toEqual({
      "2026-09-20": { done: 0, carried: 0, started: 1 },
      "2026-09-21": { done: 1, carried: 1, started: 1 },
      "2026-09-22": { done: 0, carried: 2, started: 1 },
      "2026-09-23": { done: 2, carried: 0, started: 1 },
    });
  });

  it("doesn't count an In Progress task as done", () => {
    const tasks = [task({ id: "a", status: "inProgress", startedOn: ["2026-09-23"] })];
    expect(summarizeStats(tasks, "2026-09-23", "2026-09-23")).toEqual({
      "2026-09-23": { done: 0, carried: 0, started: 1 },
    });
  });
});

describe("statistics view helpers", () => {
  it("lists the last N days, oldest first, ending today", () => {
    expect(rangeDays("2026-09-23", 3)).toEqual(["2026-09-21", "2026-09-22", "2026-09-23"]);
  });

  it("marks carry-overs and pickups before tracking began as unknown, not zero", () => {
    const rows = statsRows(
      ["2026-09-21", "2026-09-22", "2026-09-23"],
      {
        "2026-09-21": { done: 2, carried: 0, started: 0 },
        "2026-09-22": { done: 1, carried: 1, started: 3 },
      },
      // Carry-overs were recorded a day before pickups were
      { carried: "2026-09-22", started: "2026-09-23" },
    );
    expect(rows).toEqual([
      { date: "2026-09-21", done: 2, carried: null, started: null },
      { date: "2026-09-22", done: 1, carried: 1, started: null },
      { date: "2026-09-23", done: 0, carried: 0, started: 0 },
    ]);
  });

  it("works out follow-through from tracked days only", () => {
    const totals = statsTotals([
      { date: "2026-09-21", done: 5, carried: null, started: null },
      { date: "2026-09-22", done: 3, carried: 1, started: 4 },
    ]);
    expect(totals).toEqual({ done: 8, carried: 1, started: 4, followThrough: 0.75 });
    expect(
      statsTotals([{ date: "2026-09-21", done: 0, carried: 0, started: 0 }]).followThrough,
    ).toBeNull();
  });

  it("totals pickups over the days they were recorded", () => {
    const totals = statsTotals([
      { date: "2026-09-21", done: 2, carried: 0, started: null },
      { date: "2026-09-22", done: 1, carried: 0, started: 2 },
      { date: "2026-09-23", done: 0, carried: 0, started: 3 },
    ]);
    expect(totals.started).toBe(5);
  });

  it("rounds the axis up to a clean number", () => {
    expect(niceCeiling(0)).toBe(1);
    expect(niceCeiling(3)).toBe(3);
    expect(niceCeiling(6)).toBe(10);
    expect(niceCeiling(23)).toBe(25);
    expect(niceCeiling(140)).toBe(150);
  });
});
