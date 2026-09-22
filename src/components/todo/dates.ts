// Day keys for the Todo list. The same helpers the server uses live in
// src/lib/tasksLogic.ts; both sides must agree that a "day" is the user's local
// day, not a UTC one — which is why the browser, not the server, says what
// "today" is.

import { formatInstant, type ZoneOffset } from "../../lib/tasksLogic";

export function dateKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayKey(): string {
  return dateKey(new Date());
}

// The browser's own calendar: its UTC offset at any instant, DST included
export const deviceZone: ZoneOffset = (ms) => -new Date(ms).getTimezoneOffset();

// This moment with the device's offset, 2026-09-23T14:05:00+08:00 — the form
// the server needs to file time under the device's days, not its own UTC ones.
export function nowIso(): string {
  const ms = Date.now();
  return formatInstant(ms, deviceZone(ms));
}

// The device's time zone by name, so the server can follow it across a DST
// change. Empty when the browser won't say.
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

export function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return dateKey(new Date(y, m - 1, d + days));
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// "Today" / "Yesterday" / "Tomorrow" where it helps, otherwise a written date.
export function formatDayLabel(key: string): string {
  const today = todayKey();
  if (key === today) return "Today";
  if (key === shiftDateKey(today, -1)) return "Yesterday";
  if (key === shiftDateKey(today, 1)) return "Tomorrow";
  const date = parseDateKey(key);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

// The secondary line under the day label — always the full date, so "Today"
// never leaves you guessing which day you're looking at.
export function formatFullDate(key: string): string {
  return parseDateKey(key).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
