import { useEffect, useMemo, useState } from "react";
import { connection, notionBackend } from "../lib/api";
import { readConnection } from "../lib/connection";
import { createLocalBackend } from "../lib/localBackend";
import { deviceStore } from "../lib/storage";
import { carryTrackingSince } from "../lib/tracking";
import { notionDatabaseUrl } from "../lib/tasksLogic";
import Setup from "./setup/Setup";
import TodoApp, { resetDayCache } from "./todo/TodoApp";
import { todayKey } from "./todo/dates";

// Decides what this device sees: the first-run choice, or the list backed by
// Notion or by the device. A Notion connection lives in the phone's secure
// storage; choosing to keep tasks on the device is remembered in its
// key-value store.

const MODE_KEY = "tasks:mode";

type Mode = "notion" | "local" | null;

export default function TasksRoot() {
  const [mode, setMode] = useState<Mode>(() =>
    readConnection() ? "notion" : deviceStore.getItem(MODE_KEY) === "local" ? "local" : null,
  );
  const [databaseUrl, setDatabaseUrl] = useState(() => {
    const config = readConnection();
    return config ? notionDatabaseUrl(config.databaseId) : null;
  });
  // A device on local storage opening the Notion form from the settings menu
  const [connecting, setConnecting] = useState(false);

  // Carry-overs are recorded from the first day this code runs on the device
  useEffect(() => {
    carryTrackingSince(todayKey());
  }, []);

  const localBackend = useMemo(
    () => createLocalBackend({ store: deviceStore, today: todayKey }),
    [],
  );

  if (mode === null || connecting) {
    return (
      <Setup
        start={connecting ? "connect" : "welcome"}
        store={deviceStore}
        onChooseLocal={() => {
          try {
            deviceStore.setItem(MODE_KEY, "local");
          } catch {
            // Not remembered: this device will be asked again next time
          }
          resetDayCache();
          setMode("local");
        }}
        onConnected={(url) => {
          // The secure store says Notion from here on
          deviceStore.removeItem(MODE_KEY);
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
        // Back to the first-run choice, as the web app is after its reload
        setDatabaseUrl(null);
        setMode(null);
      }}
    />
  );
}
