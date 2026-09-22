import { useEffect, useMemo, useState } from "react";
import { connection, notionBackend } from "../lib/api";
import { createLocalBackend, type KeyValueStore } from "../lib/localBackend";
import { carryTrackingSince } from "../lib/tracking";
import Setup from "./setup/Setup";
import TodoApp, { resetDayCache } from "./todo/TodoApp";
import { todayKey } from "./todo/dates";

// Decides what this device sees: the first-run choice, or the list backed by
// Notion or by the device. A Notion connection lives in an httpOnly cookie the
// server reads (so the page is told, not asked); choosing to keep tasks on the
// device is remembered in local storage.

interface TasksRootProps {
  connected: boolean;
  databaseUrl: string | null;
}

const MODE_KEY = "tasks:mode";

// Local storage that never throws on read — a private window or blocked site
// data reads as empty. Writes still throw, and the local backend reports them.
const browserStore: KeyValueStore = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing to remove from storage we can't reach
    }
  },
};

type Mode = "notion" | "local" | null;

export default function TasksRoot({ connected, databaseUrl: initialUrl }: TasksRootProps) {
  const [mode, setMode] = useState<Mode>(() =>
    connected ? "notion" : browserStore.getItem(MODE_KEY) === "local" ? "local" : null,
  );
  const [databaseUrl, setDatabaseUrl] = useState(initialUrl);
  // A device on local storage opening the Notion form from the settings menu
  const [connecting, setConnecting] = useState(false);

  // Carry-overs are recorded from the first day this code runs on the device
  useEffect(() => {
    carryTrackingSince(todayKey());
  }, []);

  const localBackend = useMemo(
    () => createLocalBackend({ store: browserStore, today: todayKey }),
    [],
  );

  if (mode === null || connecting) {
    return (
      <Setup
        start={connecting ? "connect" : "welcome"}
        store={browserStore}
        onChooseLocal={() => {
          try {
            browserStore.setItem(MODE_KEY, "local");
          } catch {
            // Not remembered: this device will be asked again next time
          }
          resetDayCache();
          setMode("local");
        }}
        onConnected={(url) => {
          // The cookie says Notion from here on
          browserStore.removeItem(MODE_KEY);
          resetDayCache();
          setDatabaseUrl(url);
          setConnecting(false);
          setMode("notion");
        }}
        onCancel={() => setConnecting(false)}
      />
    );
  }

  return (
    <TodoApp
      key={mode}
      api={mode === "notion" ? notionBackend : localBackend}
      mode={mode}
      databaseUrl={databaseUrl}
      onConnectNotion={() => setConnecting(true)}
      onDisconnectNotion={async () => {
        await connection.disconnect();
        resetDayCache();
        // The server decides what's connected; start over from its answer
        window.location.reload();
      }}
    />
  );
}
