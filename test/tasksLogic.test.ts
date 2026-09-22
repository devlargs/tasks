import { describe, expect, it } from "vitest";
import {
  type Task,
  carryOverPending,
  dateKey,
  isDateKey,
  isPageId,
  isPlausibleToday,
  isSchedulableDate,
  nextOrder,
  normalizeDatabaseId,
  notionDatabaseUrl,
  reorderTasks,
  sanitizeTaskText,
  shiftDateKey,
  sortTasks,
  summarizeDays,
  tasksForDate,
  topOrder,
} from "../src/lib/tasksLogic";

function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    text: "a task",
    done: false,
    date: "2026-08-24",
    order: 0,
    editedAt: "2026-08-24T09:00:00.000Z",
    ...overrides,
  };
}

describe("dates", () => {
  it("formats a local date as YYYY-MM-DD", () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(dateKey(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
  });

  it("shifts across month and year boundaries", () => {
    expect(shiftDateKey("2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftDateKey("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDateKey("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("recognises well-formed day keys", () => {
    expect(isDateKey("2026-08-24")).toBe(true);
    expect(isDateKey("2026-8-24")).toBe(false);
    expect(isDateKey(20260824)).toBe(false);
  });
});

describe("isPlausibleToday", () => {
  const now = new Date("2026-09-21T12:00:00Z");

  it("accepts any date within a day of UTC — every timezone lands there", () => {
    expect(isPlausibleToday("2026-09-20", now)).toBe(true);
    expect(isPlausibleToday("2026-09-21", now)).toBe(true);
    expect(isPlausibleToday("2026-09-22", now)).toBe(true);
  });

  it("rejects a clock that is days out, and anything that isn't a date", () => {
    expect(isPlausibleToday("2026-09-19", now)).toBe(false);
    expect(isPlausibleToday("2026-09-23", now)).toBe(false);
    expect(isPlausibleToday("2026-02-30", now)).toBe(false);
    expect(isPlausibleToday(null, now)).toBe(false);
  });
});

describe("ordering and bucketing", () => {
  const tasks = [
    task({ id: "b", order: 1 }),
    task({ id: "a", order: 0 }),
    task({ id: "c", order: 1, editedAt: "2026-08-24T08:00:00.000Z" }),
    task({ id: "other", date: "2026-08-25", order: 0 }),
  ];

  it("sorts by manual order, oldest edit breaking ties", () => {
    expect(sortTasks(tasks.slice(0, 3)).map((t) => t.id)).toEqual(["a", "c", "b"]);
  });

  it("filters to one day", () => {
    expect(tasksForDate(tasks, "2026-08-24").map((t) => t.id)).toEqual(["a", "c", "b"]);
  });

  it("puts a new task after the day's last one", () => {
    expect(nextOrder(tasks, "2026-08-24")).toBe(2);
    expect(nextOrder(tasks, "2026-08-30")).toBe(0);
  });

  it("puts a topmost task before the day's first one", () => {
    expect(topOrder(tasks, "2026-08-24")).toBe(-1);
    expect(topOrder(tasks, "2026-08-30")).toBe(0);
  });
});

describe("reorderTasks", () => {
  const day = [
    task({ id: "a", order: 0 }),
    task({ id: "b", order: 1 }),
    task({ id: "c", order: 2 }),
  ];

  it("renumbers to the given order and reports only what changed", () => {
    const { tasks, changed } = reorderTasks(day, "2026-08-24", ["b", "a", "c"]);
    expect(tasks.map((t) => [t.id, t.order])).toEqual([
      ["b", 0],
      ["a", 1],
      ["c", 2],
    ]);
    expect(changed.map((t) => t.id).sort()).toEqual(["a", "b"]);
  });

  it("keeps ids the caller left out instead of dropping them", () => {
    const { tasks } = reorderTasks(day, "2026-08-24", ["c"]);
    expect(tasks.map((t) => t.id)).toEqual(["c", "a", "b"]);
  });

  it("ignores ids that aren't on the day", () => {
    const { tasks } = reorderTasks(day, "2026-08-24", ["ghost", "b"]);
    expect(tasks.map((t) => t.id)).toEqual(["b", "a", "c"]);
  });
});

describe("carryOverPending", () => {
  const today = "2026-08-24";

  it("moves only unfinished earlier tasks, appended after today's", () => {
    const backlog = [
      task({ id: "open", date: "2026-08-23", order: 0 }),
      task({ id: "done", date: "2026-08-23", order: 1, done: true }),
    ];
    const onDay = [task({ id: "t", date: today, order: 4 })];
    expect(carryOverPending(backlog, onDay, today)).toEqual([
      { ...backlog[0], date: today, order: 5, carriedFrom: ["2026-08-23"] },
    ]);
  });

  it("sweeps every earlier day, oldest first", () => {
    const backlog = [
      task({ id: "yesterday", date: "2026-08-23", order: 0 }),
      task({ id: "last-week-2", date: "2026-08-17", order: 1 }),
      task({ id: "last-week-1", date: "2026-08-17", order: 0 }),
    ];
    const moved = carryOverPending(backlog, [], today);
    expect(moved.map((t) => [t.id, t.order])).toEqual([
      ["last-week-1", 0],
      ["last-week-2", 1],
      ["yesterday", 2],
    ]);
  });

  it("leaves today and later alone", () => {
    const backlog = [task({ id: "tomorrow", date: "2026-08-25" }), task({ id: "t", date: today })];
    expect(carryOverPending(backlog, [], today)).toEqual([]);
  });
});

describe("sanitizeTaskText", () => {
  it("trims and collapses whitespace", () => {
    expect(sanitizeTaskText("  buy \n milk  ")).toBe("buy milk");
  });

  it("rejects empty, oversized, and non-string values", () => {
    expect(sanitizeTaskText("   ")).toBeNull();
    expect(sanitizeTaskText("x".repeat(501))).toBeNull();
    expect(sanitizeTaskText(42)).toBeNull();
  });
});

describe("normalizeDatabaseId", () => {
  const id = "0123456789abcdef0123456789abcdef";

  it("accepts a bare id or a full URL", () => {
    expect(normalizeDatabaseId(id)).toBe(id);
    expect(normalizeDatabaseId(`https://www.notion.so/ws/Tasks-${id}?v=1`)).toBe(id);
  });

  it("rejects anything that isn't an id", () => {
    expect(normalizeDatabaseId("not an id")).toBeNull();
  });
});

describe("isPageId", () => {
  it("accepts dashed and bare page ids", () => {
    expect(isPageId("01234567-89ab-cdef-0123-456789abcdef")).toBe(true);
    expect(isPageId("0123456789abcdef0123456789abcdef")).toBe(true);
  });

  it("rejects paths and anything with extra characters", () => {
    expect(isPageId("../databases/0123456789abcdef0123456789abcdef")).toBe(false);
    expect(isPageId("temp-01234567-89ab-cdef-0123-456789abcdef")).toBe(false);
    expect(isPageId(undefined)).toBe(false);
  });
});

describe("notionDatabaseUrl", () => {
  it("builds the database's page URL without dashes, lowercased", () => {
    expect(notionDatabaseUrl("0123ABCD-89ab-cdef-0123-456789abcdef")).toBe(
      "https://www.notion.so/0123abcd89abcdef0123456789abcdef",
    );
    expect(notionDatabaseUrl("")).toBeNull();
  });
});

describe("isSchedulableDate", () => {
  const today = "2026-08-24";

  it("accepts today and any later real day", () => {
    expect(isSchedulableDate(today, today)).toBe(true);
    expect(isSchedulableDate("2027-01-01", today)).toBe(true);
  });

  it("rejects earlier days, malformed keys and impossible dates", () => {
    expect(isSchedulableDate("2026-08-23", today)).toBe(false);
    expect(isSchedulableDate("2026-02-30", "2026-01-01")).toBe(false);
    expect(isSchedulableDate("tomorrow", today)).toBe(false);
  });
});

describe("summarizeDays", () => {
  it("counts done and pending per day inside the range, leaving empty days out", () => {
    const tasks = [
      task({ id: "a", date: "2026-08-01", done: true }),
      task({ id: "b", date: "2026-08-01" }),
      task({ id: "c", date: "2026-08-31" }),
      task({ id: "out", date: "2026-09-01" }),
    ];
    expect(summarizeDays(tasks, "2026-08-01", "2026-08-31")).toEqual({
      "2026-08-01": { done: 1, pending: 1 },
      "2026-08-31": { done: 0, pending: 1 },
    });
  });
});
