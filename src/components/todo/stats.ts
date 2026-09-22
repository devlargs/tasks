// Pure helpers for the statistics view: which days a range covers, one row per
// day, the range's totals, and a clean axis. Kept out of the component so they
// can be unit-tested (test/todoStats.test.ts).

import type { TodoDayStats } from "../../lib/types";
import { shiftDateKey } from "./dates";

export const STATS_RANGES = [7, 14, 30] as const;
export type StatsRange = (typeof STATS_RANGES)[number];

export interface StatsRow {
  date: string;
  done: number;
  // Null before carry-overs were being recorded: unknown, not zero
  carried: number | null;
}

// The last `days` days, oldest first, ending today.
export function rangeDays(today: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => shiftDateKey(today, i - days + 1));
}

export function statsRows(
  days: string[],
  data: Record<string, TodoDayStats>,
  trackedSince: string,
): StatsRow[] {
  return days.map((date) => ({
    date,
    done: data[date]?.done ?? 0,
    carried: date < trackedSince ? null : (data[date]?.carried ?? 0),
  }));
}

export interface StatsTotals {
  done: number;
  carried: number;
  // done / (done + carried) over the tracked days, or null with nothing to go on
  followThrough: number | null;
}

// Totals for the range. Follow-through only counts days where carry-overs were
// recorded, so days before tracking can't flatter the rate.
export function statsTotals(rows: StatsRow[]): StatsTotals {
  let done = 0;
  let carried = 0;
  let trackedDone = 0;
  for (const row of rows) {
    done += row.done;
    if (row.carried !== null) {
      carried += row.carried;
      trackedDone += row.done;
    }
  }
  const settled = trackedDone + carried;
  return { done, carried, followThrough: settled === 0 ? null : trackedDone / settled };
}

// The axis top for a count: the smallest clean number at or above it, so the
// tallest column never touches the frame. Tasks are whole, so small counts
// step by one.
export function niceCeiling(value: number): number {
  if (value <= 4) return Math.max(1, Math.ceil(value));
  const steps = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100];
  return steps.find((s) => s >= value) ?? Math.ceil(value / 50) * 50;
}
