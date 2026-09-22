import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  MdDragIndicator,
  MdOutlineArrowForward,
  MdOutlineDeleteOutline,
  MdOutlineEditCalendar,
  MdOutlineUndo,
} from "react-icons/md";
import { formatInstant, totalSeconds } from "../../lib/tasksLogic";
import type { TaskStatus, TodoTask } from "../../lib/types";
import { buildDissolveWords } from "./dissolve";
import { elapsedPrecise, elapsedWords, formatElapsed, isoDuration } from "./elapsed";
import { parseTaskSegments } from "./links";
import SchedulePicker from "./SchedulePicker";
import { useTicker } from "./ticker";

interface TaskRowProps {
  task: TodoTask;
  // The task has just been finished and its label is dissolving away. The row
  // still reads as done for the whole animation, so the tick doesn't wait.
  dissolving: boolean;
  // Done rows sit in their own section and aren't part of the manual order
  reorderable: boolean;
  // The checkbox moves the task one step on: Todo starts it, In Progress
  // finishes it, and Done puts it back in progress
  onToggle: () => void;
  // Puts an In Progress task back in Todo. Absent on every other row.
  onBack?: () => void;
  onRename: (text: string) => void;
  // Push the task onto the next day. Absent for done rows — finished work has
  // no tomorrow.
  onDefer?: () => void;
  // Move the task onto a picked day. Absent for done rows, like onDefer.
  onSchedule?: (date: string) => void;
  onDelete: () => void;
  // Pressing the grip starts a drag. Pointer events rather than HTML5
  // drag-and-drop, which phones never fire — the page tracks the pointer and
  // finds the row under it by its data-drop-id.
  onDragStart: (e: ReactPointerEvent) => void;
  dragging: boolean;
  dropTarget: boolean;
}

// What the checkbox does from each state, for its name and tooltip
const CHECK_LABEL: Record<TaskStatus, string> = {
  todo: "Start this task",
  inProgress: "Mark as done",
  done: "Move back to In Progress",
};

// A tri-state box: Todo is unticked, In Progress half-way, Done ticked
const CHECKED: Record<TaskStatus, "false" | "mixed" | "true"> = {
  todo: "false",
  inProgress: "mixed",
  done: "true",
};

// The time an In Progress task has run, all days included. Always worked out
// from the banked log and the open run, never counted up in state, so a reload
// shows the same figure.
function RunningTime({ task }: { task: TodoTask }) {
  const now = useTicker();
  const seconds = totalSeconds(task, formatInstant(now, 0));
  return (
    <span className="todo-running shrink-0">
      {task.runningSince && <span className="todo-running-dot" aria-hidden />}
      <time
        className="todo-figure"
        dateTime={isoDuration(seconds)}
        title={`${elapsedPrecise(seconds)} worked on this task`}
        aria-label={`Running for ${elapsedWords(seconds)}`}
      >
        {formatElapsed(seconds)}
      </time>
    </span>
  );
}

export default function TaskRow({
  task,
  dissolving,
  reorderable,
  onToggle,
  onBack,
  onRename,
  onDefer,
  onSchedule,
  onDelete,
  onDragStart,
  dragging,
  dropTarget,
}: TaskRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.text);
  // Runs the one-shot spring class; cleared on animation end so a later toggle
  // can retrigger it.
  const [springing, setSpringing] = useState(false);
  // The schedule button while its date picker is open, null while closed
  const [scheduleAnchor, setScheduleAnchor] = useState<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    if (!editing) setDraft(task.text);
  }, [task.text, editing]);

  const commit = () => {
    setEditing(false);
    const text = draft.trim();
    if (text && text !== task.text) onRename(text);
    else setDraft(task.text);
  };

  const actionStyle = {
    width: 28,
    height: 28,
    marginTop: -4,
    background: "transparent",
    border: "none",
  } as const;

  // Checked reads true for the whole dissolve, so the tick draws itself in
  // while the letters are still going rather than after them.
  const status: TaskStatus = dissolving ? "done" : task.status;
  const checked = status === "done";
  const inProgress = status === "inProgress";

  const labelStyle = {
    fontSize: "var(--text-md)",
    lineHeight: 1.45,
    color: checked ? "var(--text-muted)" : "var(--text-primary)",
    background: "transparent",
    border: "none",
    padding: 0,
  } as const;

  // Recomputed only when the text changes — every row renders on any list update
  const segments = useMemo(() => parseTaskSegments(task.text), [task.text]);
  const dissolveWords = useMemo(
    () => (dissolving ? buildDissolveWords(segments) : []),
    [dissolving, segments],
  );

  return (
    <div
      data-drop-id={reorderable ? task.id : undefined}
      // A row only takes drops from its own section
      data-drop-section={reorderable ? task.status : undefined}
      onAnimationEnd={() => setSpringing(false)}
      className={[
        "todo-row flex items-start",
        checked ? "todo-row-done" : "",
        dissolving ? "todo-row-dissolving" : "",
        springing ? "todo-row-springing" : "",
        dragging ? "todo-row-dragging" : "",
        dropTarget ? "todo-row-drop-target" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ gap: "var(--space-sm)", padding: "var(--space-sm) var(--space-sm)" }}
    >
      {reorderable ? (
        <span
          onPointerDown={(e) => {
            if (!editing && !dissolving) onDragStart(e);
          }}
          className="todo-row-action todo-grip shrink-0 cursor-grab"
          style={{ color: "var(--text-muted)", marginTop: 2 }}
          aria-label="Drag to reorder"
          title="Drag to reorder"
        >
          <MdDragIndicator size={16} />
        </span>
      ) : (
        // Holds the checkbox on the same column as the open rows above
        <span className="shrink-0" style={{ width: 16 }} />
      )}

      {/* Checkbox — half-filled while in progress; the tick draws itself in */}
      <button
        onClick={() => {
          setSpringing(true);
          onToggle();
        }}
        disabled={dissolving}
        role="checkbox"
        aria-checked={CHECKED[status]}
        className={`todo-check shrink-0 flex items-center justify-center rounded-md cursor-pointer ${
          checked ? "todo-check-on" : ""
        } ${inProgress ? "todo-check-progress" : ""}`}
        style={{
          width: 19,
          height: 19,
          marginTop: 1,
          background: checked ? "var(--accent)" : "transparent",
          border: `1.5px solid ${
            checked || inProgress
              ? "var(--accent)"
              : "color-mix(in srgb, var(--border) 90%, transparent)"
          }`,
        }}
        aria-label={CHECK_LABEL[status]}
        title={CHECK_LABEL[status]}
      >
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect className="todo-check-half" x={5} y={5} width={14} height={14} rx={2.5} />
          <path
            className="todo-check-tick"
            d="M5 12.5l4.5 4.5L19 7.5"
            stroke="var(--surface)"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Label / inline editor */}
      <div className="flex-1 min-w-0">
        {dissolving ? (
          // Every character on its own delay, grouped into nowrap words so the
          // line breaks stay exactly where they were.
          <span className="todo-label todo-dissolve" style={labelStyle} aria-hidden="true">
            {dissolveWords.map((word, w) => (
              <span key={w} className="todo-dissolve-word">
                {word.map((c, i) => (
                  <span
                    key={i}
                    className={`todo-char ${c.isLink ? "todo-char-link" : ""}`}
                    style={{ animationDelay: `${c.delayMs}ms` }}
                  >
                    {c.char}
                  </span>
                ))}
              </span>
            ))}
          </span>
        ) : editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setDraft(task.text);
                setEditing(false);
              }
            }}
            className="w-full outline-none rounded-md"
            style={{
              padding: "var(--space-3xs) var(--space-2xs)",
              fontSize: "var(--text-md)",
              background: "var(--surface)",
              color: "var(--text-primary)",
              border: "1px solid var(--accent)",
            }}
          />
        ) : segments.length === 1 && segments[0].type === "text" ? (
          // No links — one button for the whole label keeps this the simple,
          // single-tab-stop case that most tasks are.
          <button
            onClick={() => setEditing(true)}
            className="todo-label cursor-text text-left"
            style={labelStyle}
            aria-label="Click to edit"
            title="Click to edit"
          >
            {task.text}
          </button>
        ) : (
          // The label carries a link. Runs must be *inline* to share a line
          // with the text around them — buttons are inline-block and centre
          // their own wrapped lines, which is what mangled these labels.
          <span
            role="button"
            tabIndex={0}
            onClick={() => setEditing(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setEditing(true);
            }}
            className="todo-label cursor-text"
            style={labelStyle}
            aria-label="Click to edit"
            title="Click to edit"
          >
            {segments.map((segment, i) =>
              segment.type === "link" ? (
                <a
                  key={i}
                  href={segment.href}
                  className="todo-link"
                  aria-label={`Open ${segment.href}`}
                  title={`Open ${segment.href}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  // Follow the link, don't open the editor under it
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  {segment.value}
                </a>
              ) : (
                <span key={i}>{segment.value}</span>
              ),
            )}
          </span>
        )}
        {/* Under the label rather than beside it, so it never takes width
            from the text on a narrow screen */}
        {inProgress && !editing && <RunningTime task={task} />}
      </div>

      {onBack && (
        <button
          onClick={onBack}
          disabled={dissolving}
          className="todo-row-action shrink-0 flex items-center justify-center rounded-md cursor-pointer hover:bg-sidebar-hover"
          style={{ ...actionStyle, color: "var(--text-muted)" }}
          aria-label="Move back to Todo"
          title="Move back to Todo"
        >
          <MdOutlineUndo size={16} />
        </button>
      )}

      {onSchedule && (
        <button
          onClick={(e) => {
            const button = e.currentTarget;
            setScheduleAnchor((open) => (open ? null : button));
          }}
          disabled={dissolving}
          className="todo-row-action shrink-0 flex items-center justify-center rounded-md cursor-pointer hover:bg-sidebar-hover"
          style={{ ...actionStyle, color: "var(--text-muted)" }}
          aria-label="Schedule task"
          title="Schedule task"
          aria-haspopup="dialog"
          aria-expanded={scheduleAnchor !== null}
        >
          <MdOutlineEditCalendar size={16} />
        </button>
      )}
      {onSchedule && scheduleAnchor && (
        <SchedulePicker
          anchor={scheduleAnchor}
          currentDate={task.date}
          onPick={(date) => {
            setScheduleAnchor(null);
            onSchedule(date);
          }}
          onClose={() => setScheduleAnchor(null)}
        />
      )}

      {onDefer && (
        <button
          onClick={onDefer}
          disabled={dissolving}
          className="todo-row-action shrink-0 flex items-center justify-center rounded-md cursor-pointer hover:bg-sidebar-hover"
          style={{ ...actionStyle, color: "var(--text-muted)" }}
          aria-label="Move to tomorrow"
          title="Move to tomorrow"
        >
          <MdOutlineArrowForward size={16} />
        </button>
      )}

      <button
        onClick={onDelete}
        className="todo-row-action shrink-0 flex items-center justify-center rounded-md cursor-pointer hover:bg-sidebar-hover"
        style={{ ...actionStyle, color: "var(--danger)" }}
        aria-label="Delete task"
        title="Delete task"
      >
        <MdOutlineDeleteOutline size={16} />
      </button>
    </div>
  );
}
