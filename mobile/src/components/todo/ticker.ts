import { useSyncExternalStore } from "react";
import { AppState, type AppStateStatus, type NativeEventSubscription } from "react-native";

// One clock for every running row: a single interval, started when the first
// row subscribes and stopped when the last one leaves, and paused while the
// app is in the background. Nothing is written — it only moves the time the
// rows read.

const TICK_MS = 15_000;

let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
let appState: NativeEventSubscription | null = null;
const listeners = new Set<() => void>();

const tick = () => {
  now = Date.now();
  for (const listener of listeners) listener();
};

const start = () => {
  if (timer === null && AppState.currentState === "active") timer = setInterval(tick, TICK_MS);
};

const stop = () => {
  if (timer !== null) clearInterval(timer);
  timer = null;
};

// Back in the app, the time is brought up to date at once, not on the next tick
const onAppState = (state: AppStateStatus) => {
  if (state === "active") {
    tick();
    start();
  } else {
    stop();
  }
};

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    now = Date.now();
    appState = AppState.addEventListener("change", onAppState);
    start();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stop();
      appState?.remove();
      appState = null;
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
