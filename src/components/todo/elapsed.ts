// How long a task has been worked on, written for the row. Minute granularity
// on screen — a ticking seconds digit would re-render the list every second
// and tell you nothing — with the exact figure kept for the tooltip. Pure, so
// it can be tested (test/elapsed.test.ts).

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const pad2 = (n: number) => String(n).padStart(2, "0");

const split = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return {
    days: Math.floor(s / DAY),
    hours: Math.floor((s % DAY) / HOUR),
    minutes: Math.floor((s % HOUR) / MINUTE),
    seconds: s % MINUTE,
  };
};

// <1m · 12m · 2h 05m · 1d 3h
export function formatElapsed(total: number): string {
  const { days, hours, minutes } = split(total);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${pad2(minutes)}m`;
  if (minutes > 0) return `${minutes}m`;
  return "<1m";
}

const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// The same figure as words, for screen readers: "2 hours 5 minutes"
export function elapsedWords(total: number): string {
  const { days, hours, minutes } = split(total);
  if (days > 0)
    return [unit(days, "day"), hours > 0 && unit(hours, "hour")].filter(Boolean).join(" ");
  if (hours > 0) {
    return [unit(hours, "hour"), minutes > 0 && unit(minutes, "minute")].filter(Boolean).join(" ");
  }
  if (minutes > 0) return unit(minutes, "minute");
  return "less than a minute";
}

// To the second, for the tooltip: 2h 05m 13s
export function elapsedPrecise(total: number): string {
  const { days, hours, minutes, seconds } = split(total);
  const clock = `${hours}h ${pad2(minutes)}m ${pad2(seconds)}s`;
  return days > 0 ? `${days}d ${clock}` : clock;
}

// The machine-readable duration for <time dateTime>: P1DT2H5M13S
export function isoDuration(total: number): string {
  const { days, hours, minutes, seconds } = split(total);
  return `P${days > 0 ? `${days}D` : ""}T${hours}H${minutes}M${seconds}S`;
}
