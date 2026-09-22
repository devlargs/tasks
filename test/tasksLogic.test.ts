import { describe, expect, it } from "vitest";
import {
  type Task,
  bankElapsed,
  bankRun,
  carryOverPending,
  changeStatus,
  deviceClock,
  fixedZone,
  formatInstant,
  formatTimeLog,
  MAX_CARRY_LOG,
  MAX_TIME_LOG,
  namedZone,
  parseInstant,
  restoreTask,
  sanitizeTimeLog,
  splitRunAcrossDays,
  startRun,
  stopRun,
  totalSeconds,
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

// Status follows `done` unless it's given, and `done` always follows status
function task(overrides: Partial<Task> & { id: string }): Task {
  const status = overrides.status ?? (overrides.done ? "done" : "todo");
  return {
    text: "a task",
    date: "2026-08-24",
    order: 0,
    editedAt: "2026-08-24T09:00:00.000Z",
    ...overrides,
    status,
    done: status === "done",
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
  it("counts done, in progress and pending per day inside the range, leaving empty days out", () => {
    const tasks = [
      task({ id: "a", date: "2026-08-01", done: true }),
      task({ id: "b", date: "2026-08-01" }),
      task({ id: "c", date: "2026-08-31" }),
      task({ id: "d", date: "2026-08-31", status: "inProgress" }),
      task({ id: "out", date: "2026-09-01" }),
    ];
    expect(summarizeDays(tasks, "2026-08-01", "2026-08-31")).toEqual({
      "2026-08-01": { done: 1, inProgress: 0, pending: 1 },
      "2026-08-31": { done: 0, inProgress: 1, pending: 1 },
    });
  });
});

// Singapore: +08:00 all year, so its midnights fall at 16:00 UTC — a clean case
// for "the server's UTC day is the wrong day"
const SGT = fixedZone(480);

describe("instants", () => {
  it("reads ISO instants with their offset, and nothing looser", () => {
    expect(parseInstant("2026-09-23T14:05:00+08:00")).toEqual({
      ms: Date.UTC(2026, 8, 23, 6, 5),
      offset: 480,
    });
    expect(parseInstant("2026-09-23T06:05:00.000Z")?.offset).toBe(0);
    expect(parseInstant("2026-09-23T14:05:00.000-05:30")?.offset).toBe(-330);
    // A bare local time means a different moment in every zone
    expect(parseInstant("2026-09-23T14:05:00")).toBeNull();
    expect(parseInstant("2026-09-23")).toBeNull();
    expect(parseInstant("2026-09-23T14:05:00+15:00")).toBeNull();
    expect(parseInstant(1_790_000_000_000)).toBeNull();
  });

  it("writes an instant in the device's offset, to the second", () => {
    const ms = Date.UTC(2026, 8, 23, 6, 5, 9, 750);
    expect(formatInstant(ms, 480)).toBe("2026-09-23T14:05:09+08:00");
    expect(formatInstant(ms, -330)).toBe("2026-09-23T00:35:09-05:30");
    expect(parseInstant(formatInstant(ms, -330))?.ms).toBe(Date.UTC(2026, 8, 23, 6, 5, 9));
  });

  it("follows a named zone across a DST change", () => {
    const newYork = namedZone("America/New_York");
    expect(newYork?.(Date.UTC(2026, 0, 15, 12))).toBe(-300);
    expect(newYork?.(Date.UTC(2026, 6, 15, 12))).toBe(-240);
    expect(namedZone("Mars/Olympus_Mons")).toBeNull();
    expect(namedZone(42)).toBeNull();
  });
});

describe("splitRunAcrossDays", () => {
  it("keeps a same-day run on its day", () => {
    expect(splitRunAcrossDays("2026-09-23T09:00:00+08:00", "2026-09-23T11:30:15+08:00")).toEqual({
      "2026-09-23": 9015,
    });
  });

  it("splits at the device's midnight, not UTC's", () => {
    // 23:00 to 01:00 UTC, but all of it on the 23rd in Singapore
    expect(splitRunAcrossDays("2026-09-23T07:00:00+08:00", "2026-09-23T09:00:00+08:00")).toEqual({
      "2026-09-23": 7200,
    });
  });

  it("splits a run that crosses one midnight", () => {
    expect(splitRunAcrossDays("2026-09-22T22:00:00+08:00", "2026-09-23T01:00:00+08:00")).toEqual({
      "2026-09-22": 7200,
      "2026-09-23": 3600,
    });
  });

  it("gives whole days to a run that crosses several", () => {
    expect(
      splitRunAcrossDays("2026-09-20T23:00:00+08:00", "2026-09-23T00:30:00+08:00", SGT),
    ).toEqual({
      "2026-09-20": 3600,
      "2026-09-21": 86_400,
      "2026-09-22": 86_400,
      "2026-09-23": 1800,
    });
  });

  it("returns nothing for a zero or backwards run, or an unreadable one", () => {
    const at = "2026-09-23T09:00:00+08:00";
    expect(splitRunAcrossDays(at, at)).toEqual({});
    expect(splitRunAcrossDays(at, "2026-09-23T08:00:00+08:00")).toEqual({});
    expect(splitRunAcrossDays("yesterday", at)).toEqual({});
  });

  it("counts a 23-hour and a 25-hour DST day as they really were", () => {
    const newYork = namedZone("America/New_York")!;
    // Clocks went forward at 02:00 on 8 March 2026
    expect(
      splitRunAcrossDays("2026-03-07T22:00:00-05:00", "2026-03-09T01:00:00-04:00", newYork),
    ).toEqual({ "2026-03-07": 7200, "2026-03-08": 23 * 3600, "2026-03-09": 3600 });
    // And back at 02:00 on 1 November 2026
    expect(
      splitRunAcrossDays("2026-10-31T23:00:00-04:00", "2026-11-02T00:30:00-05:00", newYork),
    ).toEqual({ "2026-10-31": 3600, "2026-11-01": 25 * 3600, "2026-11-02": 1800 });
  });

  it("always adds up to the whole run", () => {
    const days = splitRunAcrossDays("2026-09-01T13:17:41+08:00", "2026-09-19T02:03:04+08:00");
    const total = Object.values(days).reduce((a, b) => a + b, 0);
    expect(total).toBe(
      (Date.parse("2026-09-19T02:03:04+08:00") - Date.parse("2026-09-01T13:17:41+08:00")) / 1000,
    );
  });
});

describe("runs", () => {
  const base = task({ id: "a", date: "2026-09-22", status: "inProgress" });

  it("opens a run and logs the pickup day in the device's calendar", () => {
    // 01:00 on the 23rd in Singapore is still the 22nd in UTC
    const started = startRun(base, "2026-09-23T01:00:00+08:00");
    expect(started.runningSince).toBe("2026-09-23T01:00:00+08:00");
    expect(started.startedOn).toEqual(["2026-09-23"]);
  });

  it("leaves a running task's run alone when started again", () => {
    const started = startRun(base, "2026-09-23T09:00:00+08:00");
    expect(startRun(started, "2026-09-23T10:00:00+08:00")).toBe(started);
  });

  it("logs every pickup day once", () => {
    let t = startRun(base, "2026-09-22T09:00:00+08:00");
    t = stopRun(t, "2026-09-22T10:00:00+08:00");
    t = startRun(t, "2026-09-22T11:00:00+08:00");
    t = stopRun(t, "2026-09-22T11:30:00+08:00");
    t = startRun(t, "2026-09-24T08:00:00+08:00");
    expect(t.startedOn).toEqual(["2026-09-22", "2026-09-24"]);
  });

  it("banks a stopped run day by day and adds to what's logged", () => {
    const running = {
      ...base,
      timeLog: { "2026-09-22": 600 },
      runningSince: "2026-09-22T23:00:00+08:00",
    };
    const stopped = stopRun(running, "2026-09-23T00:15:00+08:00");
    expect(stopped.runningSince).toBeUndefined();
    expect(stopped.timeLog).toEqual({ "2026-09-22": 4200, "2026-09-23": 900 });
  });

  it("leaves a task that isn't running alone when stopped", () => {
    const stopped = stopRun(base, "2026-09-23T00:15:00+08:00");
    expect(stopped).toBe(base);
    const once = stopRun(
      { ...base, runningSince: "2026-09-23T00:00:00+08:00" },
      "2026-09-23T01:00:00+08:00",
    );
    expect(stopRun(once, "2026-09-23T05:00:00+08:00")).toBe(once);
  });

  it("banks the finished days of an open run and keeps it open from midnight", () => {
    const running = { ...base, runningSince: "2026-09-21T22:00:00+08:00" };
    const now = "2026-09-23T10:00:00+08:00";
    const banked = bankRun(running, now);
    expect(banked.timeLog).toEqual({ "2026-09-21": 7200, "2026-09-22": 86_400 });
    expect(banked.runningSince).toBe("2026-09-23T00:00:00+08:00");
    // Nothing is lost or counted twice
    expect(totalSeconds(banked, now)).toBe(totalSeconds(running, now));
  });

  it("leaves a run that began today alone when banking", () => {
    const running = { ...base, runningSince: "2026-09-23T08:00:00+08:00" };
    expect(bankRun(running, "2026-09-23T10:00:00+08:00")).toBe(running);
    expect(bankRun(base, "2026-09-23T10:00:00+08:00")).toBe(base);
  });

  it("banks everything so far and keeps running when moved by hand", () => {
    const running = { ...base, runningSince: "2026-09-23T08:00:00+08:00" };
    const banked = bankElapsed(running, "2026-09-23T09:30:00+08:00");
    expect(banked.timeLog).toEqual({ "2026-09-23": 5400 });
    expect(banked.runningSince).toBe("2026-09-23T09:30:00+08:00");
  });

  it("totals the log, plus the live run when there is one", () => {
    const logged = { ...base, timeLog: { "2026-09-21": 60, "2026-09-22": 120 } };
    expect(totalSeconds(logged, "2026-09-23T10:00:00+08:00")).toBe(180);
    const running = { ...logged, runningSince: "2026-09-23T09:00:00+08:00" };
    expect(totalSeconds(running, "2026-09-23T10:00:00+08:00")).toBe(3780);
    // Compared as instants, so the offsets needn't match
    expect(totalSeconds(running, "2026-09-23T02:00:00Z")).toBe(3780);
    // A clock behind the run's start adds nothing rather than taking time away
    expect(totalSeconds(running, "2026-09-23T08:00:00+08:00")).toBe(180);
  });
});

describe("sanitizeTimeLog", () => {
  it("reads the text Notion holds, and writes it back the same", () => {
    const text = "2026-09-22:3600 2026-09-23:120";
    expect(sanitizeTimeLog(text)).toEqual({ "2026-09-22": 3600, "2026-09-23": 120 });
    expect(formatTimeLog(sanitizeTimeLog(text))).toBe(text);
  });

  it("drops malformed entries and keeps the rest", () => {
    expect(
      sanitizeTimeLog(
        "2026-02-30:5 2026-09-20:-5 2026-09-21:1.5 nope 2026-09-22 :60 2026-09-23:999999 2026-09-24:90",
      ),
    ).toEqual({ "2026-09-24": 90 });
    expect(sanitizeTimeLog({ "2026-09-22": "60", "2026-09-23": 30, junk: 5 })).toEqual({
      "2026-09-23": 30,
    });
  });

  it("reads junk as no log", () => {
    for (const junk of [undefined, null, 42, "", "garbage", [], ["2026-09-22:60"], {}]) {
      expect(sanitizeTimeLog(junk)).toBeUndefined();
    }
  });

  it("keeps the most recent days", () => {
    const log = Object.fromEntries(
      Array.from({ length: MAX_TIME_LOG + 5 }, (_, i) => [shiftDateKey("2026-06-01", i), 60]),
    );
    const kept = sanitizeTimeLog(log)!;
    expect(Object.keys(kept)).toHaveLength(MAX_TIME_LOG);
    expect(Object.keys(kept)[0]).toBe(shiftDateKey("2026-06-01", 5));
  });
});

describe("changeStatus", () => {
  const now = "2026-09-23T10:00:00+08:00";
  const day = [
    task({ id: "p", date: "2026-09-23", status: "inProgress", order: 0 }),
    task({ id: "t1", date: "2026-09-23", order: 1 }),
    task({ id: "t2", date: "2026-09-23", order: 2 }),
    task({ id: "d", date: "2026-09-23", done: true, order: 3 }),
  ];

  it("picks a task up: In Progress, running, at the end of the section", () => {
    const next = changeStatus(day[2], "inProgress", day, now);
    expect(next).toMatchObject({ status: "inProgress", done: false, runningSince: now, order: 4 });
    expect(next.startedOn).toEqual(["2026-09-23"]);
  });

  it("finishes it: Done, clock stopped, time banked, place kept", () => {
    const running = { ...day[0], runningSince: "2026-09-23T09:00:00+08:00" };
    const next = changeStatus(running, "done", day, now);
    expect(next).toMatchObject({ status: "done", done: true, order: 0 });
    expect(next.runningSince).toBeUndefined();
    expect(next.timeLog).toEqual({ "2026-09-23": 3600 });
  });

  it("puts it back: Todo, clock stopped, at the top of the list", () => {
    const running = { ...day[0], runningSince: "2026-09-23T09:30:00+08:00" };
    const next = changeStatus(running, "todo", day, now);
    expect(next).toMatchObject({ status: "todo", done: false, order: 0 });
    expect(next.runningSince).toBeUndefined();
    expect(next.timeLog).toEqual({ "2026-09-23": 1800 });
  });

  it("un-ticks a done task into In Progress with a new run", () => {
    const next = changeStatus({ ...day[3], timeLog: { "2026-09-22": 60 } }, "inProgress", day, now);
    expect(next).toMatchObject({ status: "inProgress", done: false, runningSince: now });
    expect(next.timeLog).toEqual({ "2026-09-22": 60 });
  });

  it("changes nothing when the status is the same", () => {
    expect(changeStatus(day[1], "todo", day, now)).toBe(day[1]);
  });
});

describe("carry-over with In Progress", () => {
  it("keeps an In Progress task In Progress and banks the days it left", () => {
    const running = task({
      id: "run",
      date: "2026-09-22",
      status: "inProgress",
      startedOn: ["2026-09-22"],
      runningSince: "2026-09-22T20:00:00+08:00",
    });
    const clock = { now: "2026-09-23T09:00:00+08:00", zone: SGT };
    const [moved] = carryOverPending([running], [], "2026-09-23", clock);
    expect(moved).toMatchObject({
      status: "inProgress",
      date: "2026-09-23",
      carriedFrom: ["2026-09-22"],
      startedOn: ["2026-09-22"],
      timeLog: { "2026-09-22": 4 * 3600 },
      runningSince: "2026-09-23T00:00:00+08:00",
    });
  });

  it("carries a task that was never started as it always has", () => {
    const [moved] = carryOverPending([task({ id: "t", date: "2026-09-22" })], [], "2026-09-23", {
      now: "2026-09-23T09:00:00+08:00",
      zone: SGT,
    });
    expect(moved.status).toBe("todo");
    expect(moved.timeLog).toBeUndefined();
    expect(moved.runningSince).toBeUndefined();
  });
});

describe("deviceClock", () => {
  const server = new Date("2026-09-23T02:00:00Z");

  it("takes a plausible device clock and its zone", () => {
    const clock = deviceClock("2026-09-23T10:00:30+08:00", "Asia/Singapore", server);
    expect(clock.now).toBe("2026-09-23T10:00:30+08:00");
    expect(clock.zone(server.getTime())).toBe(480);
    // The named zone, not a fixed offset: Singapore was UTC+7:30 in 1970
    expect(clock.zone(0)).toBe(450);
  });

  it("uses the named zone only when it agrees with the offset", () => {
    const clock = deviceClock("2026-09-23T10:00:00+08:00", "America/New_York", server);
    expect(clock.zone(Date.UTC(2026, 0, 1))).toBe(480);
  });

  it("swaps a clock that's far off for the server's time, in the device's zone", () => {
    const clock = deviceClock("2026-09-24T10:00:00+08:00", "", server);
    expect(clock.now).toBe("2026-09-23T10:00:00+08:00");
  });

  it("falls back to the server's time in UTC when there's no clock to read", () => {
    for (const junk of [undefined, "", "2026-09-23T10:00:00", 12]) {
      expect(deviceClock(junk, "Asia/Singapore", server).now).toBe("2026-09-23T02:00:00+00:00");
    }
  });
});

describe("restoreTask", () => {
  const stored = {
    id: "a",
    text: "a task",
    date: "2026-09-23",
    order: 0,
    editedAt: "2026-09-23T09:00:00.000Z",
  };

  it("reads a task from before In Progress by its done flag", () => {
    expect(restoreTask({ ...stored, done: true })).toMatchObject({ status: "done", done: true });
    expect(restoreTask({ ...stored, done: false })).toMatchObject({ status: "todo", done: false });
    expect(restoreTask({ ...stored, status: "sideways", done: true })?.status).toBe("done");
  });

  it("keeps the done flag in step with status", () => {
    expect(restoreTask({ ...stored, status: "inProgress", done: true })).toMatchObject({
      status: "inProgress",
      done: false,
    });
  });

  it("only keeps a run on a task that's In Progress", () => {
    const run = { runningSince: "2026-09-23T09:00:00+08:00" };
    expect(restoreTask({ ...stored, status: "inProgress", ...run })?.runningSince).toBe(
      run.runningSince,
    );
    expect(restoreTask({ ...stored, status: "todo", ...run })?.runningSince).toBeUndefined();
    expect(restoreTask({ ...stored, status: "done", ...run })?.runningSince).toBeUndefined();
    expect(
      restoreTask({ ...stored, status: "inProgress", runningSince: "soon" })?.runningSince,
    ).toBeUndefined();
  });

  it("sanitises and caps the pickup log", () => {
    const days = Array.from({ length: MAX_CARRY_LOG + 10 }, (_, i) =>
      shiftDateKey("2026-06-01", i),
    );
    const restored = restoreTask({
      ...stored,
      startedOn: ["nope", "2026-02-30", ...days, days[0]],
    });
    expect(restored?.startedOn).toHaveLength(MAX_CARRY_LOG);
    expect(restored?.startedOn?.[0]).toBe(days[10]);
    expect(restoreTask({ ...stored, startedOn: "2026-09-23" })?.startedOn).toBeUndefined();
  });

  it("refuses something that isn't a task", () => {
    expect(restoreTask(null)).toBeNull();
    expect(restoreTask({ ...stored, date: "2026-02-30" })).toBeNull();
    expect(restoreTask({ ...stored, order: "1" })).toBeNull();
  });
});
