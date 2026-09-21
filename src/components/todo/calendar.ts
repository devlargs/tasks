// Month-grid arithmetic for the Todo calendar view. Pure, so it can be tested
// without a DOM (see test/todoCalendar.test.ts).

import type { TodoDaySummary } from "../../lib/types";
import { dateKey, parseDateKey } from "./dates";

// Six full weeks, always — a fixed grid keeps the page from jumping in height
// between a four-row February and a six-row month.
export const GRID_DAYS = 42;

// The first of the month a day falls in, as a day key.
export function monthStart(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

// The first of the month `months` away from the one `key` is in.
export function shiftMonth(key: string, months: number): string {
  const date = parseDateKey(key);
  return dateKey(new Date(date.getFullYear(), date.getMonth() + months, 1));
}

export function inMonth(key: string, month: string): boolean {
  return key.slice(0, 7) === month.slice(0, 7);
}

// Every day shown for a month: leading days from the month before so the 1st
// lands under its weekday (weeks start on Sunday), then fill to six weeks.
export function monthGrid(month: string): string[] {
  const first = parseDateKey(monthStart(month));
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
  return Array.from({ length: GRID_DAYS }, (_, i) =>
    dateKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)),
  );
}

// The month's own totals; the neighbouring days padding the grid don't count.
export function monthTotals(days: Record<string, TodoDaySummary>, month: string): TodoDaySummary {
  const totals = { done: 0, pending: 0 };
  for (const [key, day] of Object.entries(days)) {
    if (!inMonth(key, month)) continue;
    totals.done += day.done;
    totals.pending += day.pending;
  }
  return totals;
}

// Weekday names in grid order, Sunday first, in the user's locale.
// 4 January 2026 is a Sunday.
export function weekdayLabels(style: "short" | "narrow"): string[] {
  return Array.from({ length: 7 }, (_, i) =>
    new Date(2026, 0, 4 + i).toLocaleDateString(undefined, { weekday: style }),
  );
}

// The counts half of a day cell's accessible name.
export function summaryPhrase(day: TodoDaySummary | undefined): string {
  if (!day || (day.done === 0 && day.pending === 0)) return "no tasks";
  return `${day.done} done, ${day.pending} pending`;
}
