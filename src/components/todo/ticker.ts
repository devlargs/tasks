import { useSyncExternalStore } from "react";

// One clock for every running row: a single interval, started when the first
// row subscribes and stopped when the last one leaves, and paused while the
// tab is hidden. Nothing is written — it only moves the time the rows read.

const TICK_MS = 15_000;

let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

const tick = () => {
  now = Date.now();
  for (const listener of listeners) listener();
};

const start = () => {
  if (timer === null && document.visibilityState === "visible") timer = setInterval(tick, TICK_MS);
};

const stop = () => {
  if (timer !== null) clearInterval(timer);
  timer = null;
};

// Back on the tab, the time is brought up to date at once, not on the next tick
const onVisibility = () => {
  if (document.visibilityState === "visible") {
    tick();
    start();
  } else {
    stop();
  }
};

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    now = Date.now();
    document.addEventListener("visibilitychange", onVisibility);
    start();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    }
  };
}

// The current time in ms, updated about every 15 seconds
export function useTicker(): number {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => now,
  );
}
