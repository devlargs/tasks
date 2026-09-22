import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MdOutlineChecklist } from "react-icons/md";
import type { TaskBackend } from "../../lib/api";
import { carryTrackingSince, pickupTrackingSince } from "../../lib/tracking";
import type { TodoDayStats } from "../../lib/types";
import { parseDateKey, todayKey } from "./dates";
import {
  niceCeiling,
  rangeDays,
  STATS_RANGES,
  statsRows,
  statsTotals,
  type StatsRange,
  type StatsRow,
} from "./stats";

// How the days went: what was picked up on each, what got done, and what was
// left unfinished and carried onto a later day. One column per day on a shared
// baseline — done rises above it, carried hangs below — so a good day reads
// tall and a day that spilled over reads deep, on one axis and one scale.
// Started stands behind done as a wider outline: most of what gets done was
// started, so the outline reads as the day's intake and the fill as how much
// of it landed, without a third bar competing for the eye.

interface TodoStatsProps {
  api: TaskBackend;
  onPickDay: (date: string) => void;
  onClose: () => void;
}

const chromeButton = {
  width: 30,
  height: 30,
  color: "var(--text-muted)",
  background: "transparent",
  border: "none",
} as const;

// Chart geometry, in CSS pixels
const PLOT_HEIGHT = 196;
const AXIS_WIDTH = 28;
const X_LABEL_BAND = 22;
const MAX_BAR = 24;
const RADIUS = 4;
// Half the surface gap either side of the baseline
const BASELINE_GAP = 1;
// How far the started outline stands out either side of the done column: the
// 2px surface gap plus its own 1.5px stroke
const STARTED_INSET = 3.5;

const formatDay = (key: string, options: Intl.DateTimeFormatOptions) =>
  parseDateKey(key).toLocaleDateString(undefined, options);

// A column's painted height: the value on the scale, less the half-gap it
// starts after, so the tallest one still ends exactly on the frame.
const barHeight = (value: number, unit: number) =>
  value > 0 ? Math.max(2, value * unit - BASELINE_GAP) : 0;

// A column with its data-end rounded and its baseline end square
function barPath(x: number, width: number, baseY: number, height: number, up: boolean): string {
  if (height <= 0) return "";
  const r = Math.min(RADIUS, height, width / 2);
  const end = up ? baseY - height : baseY + height;
  const toward = up ? r : -r;
  return [
    `M${x},${baseY}`,
    `V${end + toward}`,
    `Q${x},${end} ${x + r},${end}`,
    `H${x + width - r}`,
    `Q${x + width},${end} ${x + width},${end + toward}`,
    `V${baseY}`,
    "Z",
  ].join(" ");
}

// Which days get an x-axis label: all of a week, fewer as the range widens,
// and always today at the right edge
function labelEvery(count: number): number {
  return count <= 7 ? 1 : count <= 14 ? 2 : 5;
}

export default function TodoStats({ api, onPickDay, onClose }: TodoStatsProps) {
  const today = todayKey();
  const [range, setRange] = useState<StatsRange>(14);
  const [data, setData] = useState<Record<string, TodoDayStats> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [width, setWidth] = useState(0);
  const chartRef = useRef<HTMLDivElement>(null);

  const since = useMemo(
    () => ({ carried: carryTrackingSince(today), started: pickupTrackingSince(today) }),
    [today],
  );
  const days = useMemo(() => rangeDays(today, range), [today, range]);
  const rows = useMemo(() => statsRows(days, data ?? {}, since), [days, data, since]);
  const totals = statsTotals(rows);

  useEffect(() => {
    let cancelled = false;
    // Refetch keeps the previous frame on screen, dimmed, rather than blanking it
    setLoading(true);
    void api.stats(days[0], days[days.length - 1]).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.ok) {
        setData(res.days);
        setError(null);
      } else {
        setError(res.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [api, days]);

  useLayoutEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // --- geometry ------------------------------------------------------------

  // The upper half is scaled to whichever of done and started runs taller
  const maxUp = Math.max(0, ...rows.map((r) => Math.max(r.done, r.started ?? 0)));
  const maxCarried = Math.max(0, ...rows.map((r) => r.carried ?? 0));
  const top = niceCeiling(maxUp);
  const bottom = maxCarried > 0 ? niceCeiling(maxCarried) : Math.max(1, Math.round(top / 4));
  const unit = PLOT_HEIGHT / (top + bottom);
  const baseY = top * unit;
  const plotWidth = Math.max(0, width - AXIS_WIDTH);
  const slot = rows.length > 0 ? plotWidth / rows.length : 0;
  const barWidth = Math.max(4, Math.min(MAX_BAR, slot * 0.56));
  const every = labelEvery(rows.length);

  const activeRow = active !== null ? rows[active] : null;
  const tooltipLeft =
    active !== null
      ? Math.min(Math.max(AXIS_WIDTH + slot * (active + 0.5), 80), Math.max(80, width - 80))
      : 0;

  const describe = (row: StatsRow) =>
    `${formatDay(row.date, { weekday: "long", month: "long", day: "numeric" })}: ${
      row.started === null ? "pickups not tracked yet" : `${row.started} started`
    }, ${row.done} done, ${
      row.carried === null ? "carry-overs not tracked yet" : `${row.carried} carried over`
    }`;

  // Measures this device only began recording partway through the range
  const untracked = (
    [
      ["Carry-overs", since.carried],
      ["Pickups", since.started],
    ] as const
  ).filter(([, from]) => from > days[0]);

  const percent =
    totals.followThrough === null ? "—" : `${Math.round(totals.followThrough * 100)}%`;

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
                Progress
              </h1>
              <p
                style={{
                  marginTop: "var(--space-3xs)",
                  fontSize: "var(--text-xs)",
                  color: "var(--text-secondary)",
                }}
              >
                The last {range} days, up to today
              </p>
            </div>
            <div className="flex items-center shrink-0" style={{ gap: "var(--space-3xs)" }}>
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
        <div className="todo-progress-track" />
      </div>

      <div className="todo-scroll flex-1 overflow-y-auto">
        <div className="todo-measure">
          {/* The one filter, above everything it scopes */}
          <div className="todo-stats-range" role="radiogroup" aria-label="Range">
            {STATS_RANGES.map((option) => (
              <button
                key={option}
                role="radio"
                aria-checked={range === option}
                onClick={() => {
                  setActive(null);
                  setRange(option);
                }}
                className="todo-stats-range-option"
              >
                {option} days
              </button>
            ))}
          </div>

          {error && (
            <p className="todo-stats-error" role="alert">
              {error}
            </p>
          )}

          <div className={`todo-stats-body ${loading && data ? "todo-stats-refetching" : ""}`}>
            <dl className="todo-stats-tiles">
              <div className="todo-stats-tile">
                <dt>Started</dt>
                <dd>{totals.started}</dd>
              </div>
              <div className="todo-stats-tile">
                <dt>Done</dt>
                <dd>{totals.done}</dd>
              </div>
              <div className="todo-stats-tile">
                <dt>Carried over</dt>
                <dd>{totals.carried}</dd>
              </div>
              <div className="todo-stats-tile">
                <dt>Follow-through</dt>
                <dd>{percent}</dd>
              </div>
            </dl>
            <p className="todo-stats-hint">
              Follow-through is the share of each day's tasks that got done that day instead of
              moving to a later one.
            </p>

            <div className="todo-stats-legend" aria-hidden>
              <span>
                <span className="todo-stats-swatch todo-stats-swatch-started" />
                Started that day
              </span>
              <span>
                <span className="todo-stats-swatch todo-stats-swatch-done" />
                Done that day
              </span>
              <span>
                <span className="todo-stats-swatch todo-stats-swatch-carried" />
                Carried to a later day
              </span>
            </div>

            <div
              ref={chartRef}
              className="todo-stats-chart"
              onPointerLeave={() => setActive(null)}
              style={{ height: PLOT_HEIGHT + X_LABEL_BAND }}
            >
              {width > 0 && data && (
                <svg
                  width={width}
                  height={PLOT_HEIGHT + X_LABEL_BAND}
                  role="img"
                  aria-label={`Tasks started, done and carried over per day, the last ${range} days. ${totals.started} started, ${totals.done} done, ${totals.carried} carried over.`}
                >
                  {/* Axis: the two extremes and the baseline, nothing between */}
                  <g className="todo-stats-axis">
                    <line x1={AXIS_WIDTH} x2={width} y1={0.5} y2={0.5} />
                    <line
                      x1={AXIS_WIDTH}
                      x2={width}
                      y1={PLOT_HEIGHT - 0.5}
                      y2={PLOT_HEIGHT - 0.5}
                    />
                    <text x={AXIS_WIDTH - 8} y={0} dy="0.8em" textAnchor="end">
                      {top}
                    </text>
                    <text x={AXIS_WIDTH - 8} y={baseY} dy="0.32em" textAnchor="end">
                      0
                    </text>
                    <text x={AXIS_WIDTH - 8} y={PLOT_HEIGHT} dy="-0.2em" textAnchor="end">
                      {bottom}
                    </text>
                  </g>
                  <line
                    className="todo-stats-baseline"
                    x1={AXIS_WIDTH}
                    x2={width}
                    y1={baseY}
                    y2={baseY}
                  />

                  {rows.map((row, i) => {
                    const x = AXIS_WIDTH + slot * i + (slot - barWidth) / 2;
                    const dim = active !== null && active !== i;
                    const isToday = row.date === today;
                    const showLabel = isToday || (rows.length - 1 - i) % every === 0;
                    return (
                      <g key={row.date} className={dim ? "todo-stats-dim" : undefined}>
                        {/* Drawn first so done paints over it; its baseline
                            end sits under the gap like done's */}
                        <path
                          className="todo-stats-bar-started"
                          d={barPath(
                            x - STARTED_INSET + 0.75,
                            barWidth + 2 * STARTED_INSET - 1.5,
                            baseY - BASELINE_GAP,
                            Math.max(0, barHeight(row.started ?? 0, unit) - 0.75),
                            true,
                          ).replace(/ Z$/, "")}
                        />
                        <path
                          className="todo-stats-bar-done"
                          d={barPath(
                            x,
                            barWidth,
                            baseY - BASELINE_GAP,
                            barHeight(row.done, unit),
                            true,
                          )}
                        />
                        <path
                          className="todo-stats-bar-carried"
                          d={barPath(
                            x,
                            barWidth,
                            baseY + BASELINE_GAP,
                            barHeight(row.carried ?? 0, unit),
                            false,
                          )}
                        />
                        {showLabel && (
                          <text
                            className={`todo-stats-xlabel ${isToday ? "todo-stats-xlabel-today" : ""}`}
                            // The last label ends on the plot's edge instead of spilling past it
                            x={i === rows.length - 1 ? width : AXIS_WIDTH + slot * (i + 0.5)}
                            y={PLOT_HEIGHT + X_LABEL_BAND - 6}
                            textAnchor={i === rows.length - 1 ? "end" : "middle"}
                          >
                            {isToday
                              ? "Today"
                              : rows.length <= 7
                                ? formatDay(row.date, { weekday: "short" })
                                : formatDay(row.date, { day: "numeric", month: "short" })}
                          </text>
                        )}
                        {/* The whole column is the hit target, not the painted bar */}
                        <rect
                          className="todo-stats-hit"
                          x={AXIS_WIDTH + slot * i}
                          y={0}
                          width={slot}
                          height={PLOT_HEIGHT}
                          tabIndex={0}
                          role="button"
                          aria-label={`${describe(row)}. Open this day.`}
                          onPointerEnter={() => setActive(i)}
                          onFocus={() => setActive(i)}
                          onBlur={() => setActive(null)}
                          onClick={() => onPickDay(row.date)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onPickDay(row.date);
                            }
                          }}
                        />
                      </g>
                    );
                  })}
                </svg>
              )}

              {activeRow && (
                <div className="todo-stats-tooltip" style={{ left: tooltipLeft }} aria-hidden>
                  <p className="todo-stats-tooltip-date">
                    {activeRow.date === today
                      ? "Today so far"
                      : formatDay(activeRow.date, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })}
                  </p>
                  <p>
                    <span className="todo-stats-key todo-stats-key-started" />
                    {activeRow.started === null ? (
                      "Pickups not tracked yet"
                    ) : (
                      <>
                        <strong className="todo-figure">{activeRow.started}</strong> started
                      </>
                    )}
                  </p>
                  <p>
                    <span className="todo-stats-key todo-stats-key-done" />
                    <strong className="todo-figure">{activeRow.done}</strong> done
                  </p>
                  <p>
                    <span className="todo-stats-key todo-stats-key-carried" />
                    {activeRow.carried === null ? (
                      "Carry-overs not tracked yet"
                    ) : (
                      <>
                        <strong className="todo-figure">{activeRow.carried}</strong> carried over
                      </>
                    )}
                  </p>
                </div>
              )}
            </div>

            {untracked.length > 0 && (
              <p className="todo-stats-hint">
                {untracked
                  .map(
                    ([what, from]) =>
                      `${what} are counted from ${formatDay(from, {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                      })}, when this device started recording them.`,
                  )
                  .join(" ")}
              </p>
            )}

            <button
              type="button"
              className="todo-stats-table-toggle"
              aria-expanded={showTable}
              onClick={() => setShowTable((v) => !v)}
            >
              {showTable ? "Hide the numbers" : "Show the numbers"}
            </button>

            {showTable && (
              <table className="todo-stats-table">
                <thead>
                  <tr>
                    <th scope="col">Day</th>
                    <th scope="col">Started</th>
                    <th scope="col">Done</th>
                    <th scope="col">Carried over</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].reverse().map((row) => (
                    <tr key={row.date}>
                      <th scope="row">
                        {row.date === today
                          ? "Today"
                          : formatDay(row.date, {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            })}
                      </th>
                      <td className="todo-figure">{row.started ?? "—"}</td>
                      <td className="todo-figure">{row.done}</td>
                      <td className="todo-figure">{row.carried ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
