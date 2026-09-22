import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import { connection } from "../../lib/api";
import type { KeyValueStore } from "../../lib/localBackend";
import { readLocalTasks, writeLocalTasks } from "../../lib/localBackend";
import { MAX_IMPORT_BATCH } from "../../lib/tasksLogic";
import "./setup.css";

// Where this device keeps its tasks. First run asks: a Notion database the
// visitor owns, or this browser. Later, a device keeping tasks locally comes
// back here (straight to the form) to connect Notion, and its tasks are copied
// into the database on the way.

interface SetupProps {
  // "welcome" offers both choices; "connect" opens on the Notion form
  start: "welcome" | "connect";
  store: KeyValueStore;
  onChooseLocal: () => void;
  onConnected: (databaseUrl: string | null) => void;
  // Back out of the form: to the choices on first run, to the list otherwise
  onCancel: () => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "copying"; done: number; total: number }
  // `copy`: connected, but some of the device's tasks didn't make it across
  | { kind: "error"; message: string; copy?: boolean };

const pluralTasks = (n: number) => `${n} ${n === 1 ? "task" : "tasks"}`;

export default function Setup({ start, store, onChooseLocal, onConnected, onCancel }: SetupProps) {
  const [view, setView] = useState<"choose" | "form">(start === "welcome" ? "choose" : "form");
  const [apiKey, setApiKey] = useState("");
  const [database, setDatabase] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [localCount, setLocalCount] = useState(() => readLocalTasks(store).length);
  const keyRef = useRef<HTMLInputElement>(null);
  const ids = { key: useId(), database: useId(), message: useId() };

  const busy = status.kind === "checking" || status.kind === "copying";

  // The form is the reason you're here; put the caret in it
  useEffect(() => {
    if (view === "form") keyRef.current?.focus();
  }, [view]);

  // Copies what's on the device into the database a batch at a time, dropping
  // each task locally only once Notion has it — so a failure part-way leaves
  // exactly the uncopied ones, and trying again doesn't duplicate anything.
  const copyLocalTasks = async (): Promise<string | null> => {
    const total = readLocalTasks(store).length;
    let done = 0;
    for (;;) {
      const remaining = readLocalTasks(store);
      if (remaining.length === 0) return null;
      setStatus({ kind: "copying", done, total });
      const res = await connection.importTasks(remaining.slice(0, MAX_IMPORT_BATCH));
      const imported = new Set(res.imported ?? []);
      if (imported.size > 0) {
        writeLocalTasks(
          store,
          readLocalTasks(store).filter((t) => !imported.has(t.id)),
        );
        done += imported.size;
        setLocalCount(total - done);
      }
      if (!res.ok) {
        return `Copied ${done} of ${pluralTasks(total)}. ${res.error} Try again to copy the rest.`;
      }
    }
  };

  const submit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    setStatus({ kind: "checking" });
    const res = await connection.connect(apiKey, database);
    if (!res.ok) {
      setStatus({ kind: "error", message: res.error });
      return;
    }
    const copyError = await copyLocalTasks();
    if (copyError) {
      setStatus({ kind: "error", message: copyError, copy: true });
      return;
    }
    onConnected(res.databaseUrl);
  };

  const submitLabel =
    status.kind === "checking"
      ? "Checking…"
      : status.kind === "copying"
        ? `Copying ${status.done} of ${status.total}…`
        : status.kind === "error" && status.copy
          ? "Try again"
          : "Connect";

  // A connect failure is about what was typed; a copy failure isn't
  const fieldsInvalid = status.kind === "error" && !status.copy;

  return (
    <main className="setup">
      <div className="setup-inner">
        <header className="setup-head">
          <img src="/favicon.svg" alt="" width="36" height="36" />
          <h1 className="setup-title">Tasks</h1>
          <p className="setup-lede">
            A list for today that carries unfinished work forward.{" "}
            {view === "choose" ? "Where should it keep your tasks?" : ""}
          </p>
        </header>

        {view === "choose" ? (
          <div className="setup-options">
            <button type="button" className="setup-option" onClick={() => setView("form")}>
              <span className="setup-option-title">Sync with Notion</span>
              <span className="setup-option-body">
                Tasks live in a Notion database you own, and show up on every device you connect to
                it.
              </span>
            </button>
            <button type="button" className="setup-option" onClick={onChooseLocal}>
              <span className="setup-option-title">Keep them on this device</span>
              <span className="setup-option-body">
                Nothing to set up and nothing leaves this browser. You can connect Notion later from
                the settings menu.
              </span>
            </button>
          </div>
        ) : (
          <form className="setup-form" onSubmit={submit} noValidate>
            <h2 className="setup-form-title">Connect a Notion database</h2>

            <div className="setup-field">
              <label htmlFor={ids.key}>Integration secret</label>
              <input
                ref={keyRef}
                id={ids.key}
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="ntn_…"
                aria-invalid={fieldsInvalid}
                aria-describedby={ids.message}
              />
            </div>

            <div className="setup-field">
              <label htmlFor={ids.database}>Database link or ID</label>
              <input
                id={ids.database}
                type="text"
                inputMode="url"
                value={database}
                onChange={(e) => setDatabase(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="https://www.notion.so/…"
                aria-invalid={fieldsInvalid}
                aria-describedby={ids.message}
              />
            </div>

            <details className="setup-help">
              <summary>Where do I find these?</summary>
              <ol>
                <li>
                  Create an integration at{" "}
                  <a
                    href="https://www.notion.so/profile/integrations"
                    target="_blank"
                    rel="noreferrer"
                  >
                    notion.so/profile/integrations
                  </a>{" "}
                  and copy its <strong>Internal Integration Secret</strong>.
                </li>
                <li>
                  Open the database in Notion, choose <strong>•••</strong> ›{" "}
                  <strong>Connections</strong>, and add the integration.
                </li>
                <li>
                  Choose <strong>Share</strong> › <strong>Copy link</strong> and paste the link
                  here. Any database works — the columns tasks need are added for you.
                </li>
              </ol>
            </details>

            <p className="setup-note">
              {localCount > 0 && (
                <>The {pluralTasks(localCount)} on this device will be copied into the database. </>
              )}
              The secret stays in a cookie on this device and is only used to reach Notion. This
              site doesn't save it.
            </p>

            <p
              id={ids.message}
              className="setup-message"
              role={status.kind === "error" ? "alert" : undefined}
              aria-live="polite"
            >
              {status.kind === "error" ? status.message : ""}
            </p>

            <div className="setup-actions">
              <button
                type="submit"
                className="setup-button setup-button-primary"
                disabled={busy || !apiKey.trim() || !database.trim()}
                aria-busy={busy}
              >
                {submitLabel}
              </button>
              <button
                type="button"
                className="setup-button"
                onClick={() => {
                  setStatus({ kind: "idle" });
                  if (start === "welcome") setView("choose");
                  else onCancel();
                }}
                disabled={busy}
              >
                Back
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
