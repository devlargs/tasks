import { useEffect, useMemo, useState } from "react";
import { MdChevronLeft, MdChevronRight, MdOutlineChecklist } from "react-icons/md";
import type { TaskBackend } from "../../lib/api";
import type { TodoDaySummary } from "../../lib/types";
import {
  inMonth,
  monthGrid,
  monthStart,
  monthTotals,
  shiftMonth,
  summaryPhrase,
  weekdayLabels,
} from "./calendar";
import { parseDateKey, todayKey } from "./dates";

interface TodoCalendarProps {
  api: TaskBackend;
  // The day the list was showing, outlined so you can see where you came from
  selectedDate: string;
  onPickDay: (date: string) => void;
  onClose: () => void;
}

const WEEKDAYS = weekdayLabels("short");

const chromeButton = {
  width: 30,
  height: 30,
  color: "var(--text-muted)",
  background: "transparent",
  border: "none",
} as const;

export default function TodoCalendar({ api, selectedDate, onPickDay, onClose }: TodoCalendarProps) {
  const [month, setMonth] = useState(() => monthStart(selectedDate));
  const [slide, setSlide] = useState<"next" | "prev" | null>(null);
  const [days, setDays] = useState<Record<string, TodoDaySummary>>({});
  const [error, setError] = useState<string | null>(null);

  const grid = useMemo(() => monthGrid(month), [month]);
  const today = todayKey();
  const totals = monthTotals(days, month);

  useEffect(() => {
    let cancelled = false;
    void api.calendar(grid[0], grid[grid.length - 1]).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setDays(res.days);
        setError(null);
      } else {
        setError(res.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [api, grid]);

  const goToMonth = (next: string) => {
    setSlide(next > month ? "next" : "prev");
    setMonth(next);
  };

  const monthLabel = parseDateKey(month).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="todo-page h-full flex flex-col" style={{ background: "var(--surface)" }}>
      <div className="todo-head shrink-0">
        <div className="todo-measure">
          <header
            className="flex items-start justify-between flex-wrap"
            style={{ gap: "var(--space-sm)", marginBottom: "var(--space-md)" }}
          >
            <div className="min-w-0">
              <h1 className="todo-day" style={{ color: "var(--text-primary)" }}>
                {monthLabel}
              </h1>
              <p
                style={{
                  marginTop: "var(--space-3xs)",
                  fontSize: "var(--text-xs)",
                  color: "var(--text-secondary)",
                }}
              >
                <span className="todo-figure">{totals.done}</span> done
                {" · "}
                <span className="todo-figure">{totals.pending}</span> pending
              </p>
            </div>

            <div className="flex items-center shrink-0" style={{ gap: "var(--space-3xs)" }}>
              {!inMonth(today, month) && (
                <button
                  onClick={() => goToMonth(monthStart(today))}
                  className="rounded-full cursor-pointer"
                  style={{
                    padding: "var(--space-3xs) var(--space-xs)",
                    marginRight: "var(--space-2xs)",
                    fontSize: "var(--text-2xs)",
                    whiteSpace: "nowrap",
                    color: "var(--accent)",
                    background: "transparent",
                    border: "1px solid color-mix(in srgb, var(--accent) 45%, transparent)",
                  }}
                >
                  Today
                </button>
              )}
              <button
                onClick={() => goToMonth(shiftMonth(month, -1))}
                className="todo-daynav flex items-center justify-center rounded-full cursor-pointer hover:bg-sidebar-hover"
                style={chromeButton}
                title="Previous month"
                aria-label="Previous month"
              >
                <MdChevronLeft size={18} />
              </button>
              <button
                onClick={() => goToMonth(shiftMonth(month, 1))}
                className="todo-daynav flex items-center justify-center rounded-full cursor-pointer hover:bg-sidebar-hover"
                style={chromeButton}
                title="Next month"
                aria-label="Next month"
              >
                <MdChevronRight size={18} />
              </button>
              <button
                onClick={onClose}
                className="todo-daynav flex items-center justify-center rounded-full cursor-pointer hover:bg-sidebar-hover"
                style={chromeButton}
                title="Back to the list"
                aria-label="Back to the list"
              >
                <MdOutlineChecklist size={16} />
              </button>
            </div>
          </header>
        </div>

        {/* Same bottom rule as the list's head, just without the progress */}
        <div className="todo-progress-track" />
      </div>

      <div className="todo-scroll flex-1 overflow-y-auto">
        <div className="todo-measure">
          {error && (
            <p
              style={{
                marginBottom: "var(--space-sm)",
                fontSize: "var(--text-sm)",
                color: "var(--danger)",
              }}
            >
              {error}
            </p>
          )}

          <div className="todo-cal-weekdays" aria-hidden>
            {WEEKDAYS.map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>

          <div
            key={month}
            className={`todo-cal-grid ${slide === "next" ? "todo-day-next" : slide === "prev" ? "todo-day-prev" : ""}`}
          >
            {grid.map((key) => {
              const day = days[key];
              const classes = [
                "todo-cal-day",
                !inMonth(key, month) && "todo-cal-day-outside",
                key === today && "todo-cal-day-today",
                key === selectedDate && "todo-cal-day-selected",
              ]
                .filter(Boolean)
                .join(" ");
              const label = parseDateKey(key).toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              });
              return (
                <button
                  key={key}
                  onClick={() => onPickDay(key)}
                  className={classes}
                  aria-label={`${label}: ${summaryPhrase(day)}`}
                  aria-current={key === today ? "date" : undefined}
                >
                  <span className="todo-cal-date todo-figure">{parseDateKey(key).getDate()}</span>
                  <span className="todo-cal-counts" aria-hidden>
                    {day?.done ? (
                      <span className="todo-cal-count" title={`${day.done} done`}>
                        <span className="todo-cal-dot todo-cal-dot-done" />
                        <span className="todo-figure">{day.done}</span>
                      </span>
                    ) : null}
                    {day?.pending ? (
                      <span className="todo-cal-count" title={`${day.pending} pending`}>
                        <span className="todo-cal-dot todo-cal-dot-pending" />
                        <span className="todo-figure">{day.pending}</span>
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="todo-cal-legend">
            <span className="todo-cal-count">
              <span className="todo-cal-dot todo-cal-dot-done" />
              Done
            </span>
            <span className="todo-cal-count">
              <span className="todo-cal-dot todo-cal-dot-pending" />
              Pending
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
