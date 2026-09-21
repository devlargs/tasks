import { describe, expect, it } from "vitest";
import {
  GRID_DAYS,
  inMonth,
  monthGrid,
  monthStart,
  monthTotals,
  shiftMonth,
  summaryPhrase,
  weekdayLabels,
} from "../src/components/todo/calendar";

describe("months", () => {
  it("finds the first of the month", () => {
    expect(monthStart("2026-09-16")).toBe("2026-09-01");
  });

  it("shifts across year boundaries and short months", () => {
    expect(shiftMonth("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftMonth("2026-01-31", -1)).toBe("2025-12-01");
    // Day 31 must not overflow February into March
    expect(shiftMonth("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("tells a month's days from its neighbours", () => {
    expect(inMonth("2026-09-30", "2026-09-01")).toBe(true);
    expect(inMonth("2026-10-01", "2026-09-01")).toBe(false);
  });
});

describe("monthGrid", () => {
  it("starts on the Sunday on or before the 1st and spans six weeks", () => {
    // 1 September 2026 is a Tuesday
    const grid = monthGrid("2026-09-16");
    expect(grid).toHaveLength(GRID_DAYS);
    expect(grid[0]).toBe("2026-08-30");
    expect(grid[2]).toBe("2026-09-01");
    expect(grid[GRID_DAYS - 1]).toBe("2026-10-10");
  });

  it("puts a 1st that falls on Sunday in the first cell", () => {
    // 1 February 2026 is a Sunday
    expect(monthGrid("2026-02-01")[0]).toBe("2026-02-01");
  });

  it("lists consecutive days with no gaps or repeats", () => {
    const grid = monthGrid("2026-03-01");
    expect(new Set(grid).size).toBe(GRID_DAYS);
    expect([...grid].sort()).toEqual(grid);
  });
});

describe("monthTotals", () => {
  it("sums only the month's own days", () => {
    const days = {
      "2026-08-31": { done: 5, pending: 0 },
      "2026-09-01": { done: 2, pending: 1 },
      "2026-09-16": { done: 1, pending: 3 },
      "2026-10-01": { done: 0, pending: 4 },
    };
    expect(monthTotals(days, "2026-09-01")).toEqual({ done: 3, pending: 4 });
  });
});

describe("weekdayLabels", () => {
  it("lists seven days starting on Sunday", () => {
    const labels = weekdayLabels("short");
    expect(labels).toHaveLength(7);
    // 1 February 2026 is a Sunday, 7 February a Saturday
    const name = (day: number) =>
      new Date(2026, 1, day).toLocaleDateString(undefined, { weekday: "short" });
    expect(labels[0]).toBe(name(1));
    expect(labels[6]).toBe(name(7));
  });
});

describe("summaryPhrase", () => {
  it("describes a day's counts", () => {
    expect(summaryPhrase({ done: 2, pending: 1 })).toBe("2 done, 1 pending");
    expect(summaryPhrase(undefined)).toBe("no tasks");
    expect(summaryPhrase({ done: 0, pending: 0 })).toBe("no tasks");
  });
});
