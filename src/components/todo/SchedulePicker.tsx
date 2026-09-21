import { type KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MdChevronLeft, MdChevronRight } from "react-icons/md";
import { inMonth, monthGrid, monthStart, shiftMonth, weekdayLabels } from "./calendar";
import { formatDayLabel, parseDateKey, shiftDateKey, todayKey } from "./dates";

interface SchedulePickerProps {
  // The row's schedule button; the panel hangs off it and ignores clicks on it,
  // so the button itself can toggle the picker shut.
  anchor: HTMLElement;
  // The day the task is on now
  currentDate: string;
  onPick: (date: string) => void;
  onClose: () => void;
}

const WIDTH = 256;
const GAP = 6;
const MARGIN = 8;

const WEEKDAYS = weekdayLabels("narrow");

const KEY_STEPS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

// A small month to move a task onto. Portaled to <body>: the task list is a
// scroll box and would clip a panel opened near its bottom edge. Outside taps
// are caught on pointerdown so a finger closes it as surely as a mouse.
export default function SchedulePicker({
  anchor,
  currentDate,
  onPick,
  onClose,
}: SchedulePickerProps) {
  const today = todayKey();
  // The keyboard cursor. It also decides which month is on screen.
  const [focused, setFocused] = useState(() => (currentDate < today ? today : currentDate));
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Only keyboard moves (and opening) pull DOM focus into the grid; clicking a
  // month arrow leaves it on the arrow.
  const moveFocus = useRef(true);

  const month = monthStart(focused);
  const grid = useMemo(() => monthGrid(month), [month]);

  // Below the button, right edges aligned; flipped above when there isn't room.
  useLayoutEffect(() => {
    const place = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const rect = anchor.getBoundingClientRect();
      const height = panel.offsetHeight;
      const below = rect.bottom + GAP;
      const top =
        below + height <= window.innerHeight - MARGIN
          ? below
          : Math.max(MARGIN, rect.top - GAP - height);
      const left = Math.max(
        MARGIN,
        Math.min(rect.right - WIDTH, window.innerWidth - WIDTH - MARGIN),
      );
      setPosition({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || anchor.contains(target)) return;
      onClose();
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      onClose();
      anchor.focus();
    };
    // The panel is pinned to the viewport — a list scrolling under it would
    // leave it floating beside the wrong row.
    const onScroll = (e: Event) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [anchor, onClose]);

  // Waits for the first placement: a hidden panel can't take focus.
  useEffect(() => {
    if (!moveFocus.current || !position) return;
    moveFocus.current = false;
    panelRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)?.focus();
  }, [focused, position]);

  const goToMonth = (delta: number) => {
    const first = shiftMonth(month, delta);
    setFocused(first < today ? today : first);
  };

  const handleGridKey = (e: KeyboardEvent) => {
    let next: string | null = null;
    if (e.key in KEY_STEPS) next = shiftDateKey(focused, KEY_STEPS[e.key]);
    else if (e.key === "PageUp") next = shiftMonth(month, -1);
    else if (e.key === "PageDown") next = shiftMonth(month, 1);
    if (next === null) return;
    e.preventDefault();
    moveFocus.current = true;
    setFocused(next < today ? today : next);
  };

  const monthLabel = parseDateKey(month).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Schedule task"
      className="todo-picker"
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        width: WIDTH,
        visibility: position ? undefined : "hidden",
      }}
    >
      <div className="todo-picker-head flex items-center justify-between">
        <button
          onClick={() => goToMonth(-1)}
          disabled={inMonth(today, month)}
          className="todo-picker-nav"
          aria-label="Previous month"
          title="Previous month"
        >
          <MdChevronLeft size={18} />
        </button>
        <span className="todo-picker-month" aria-live="polite">
          {monthLabel}
        </span>
        <button
          onClick={() => goToMonth(1)}
          className="todo-picker-nav"
          aria-label="Next month"
          title="Next month"
        >
          <MdChevronRight size={18} />
        </button>
      </div>

      <div className="todo-picker-grid todo-picker-weekdays" aria-hidden>
        {WEEKDAYS.map((name, i) => (
          <span key={i}>{name}</span>
        ))}
      </div>

      <div className="todo-picker-grid" onKeyDown={handleGridKey}>
        {grid.map((key) => {
          const classes = [
            "todo-picker-day",
            !inMonth(key, month) && "todo-picker-day-outside",
            key === today && "todo-picker-day-today",
            key === currentDate && "todo-picker-day-current",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={key}
              data-day={key}
              onClick={() => onPick(key)}
              // Earlier days would only roll straight back onto today
              disabled={key < today}
              tabIndex={key === focused ? 0 : -1}
              className={classes}
              aria-label={`${formatDayLabel(key)}${key === currentDate ? " (current day)" : ""}`}
              aria-current={key === today ? "date" : undefined}
            >
              <span className="todo-figure">{parseDateKey(key).getDate()}</span>
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
