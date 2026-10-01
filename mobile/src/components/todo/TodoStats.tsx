import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { G, Line, Path, Rect, Text as SvgText } from "react-native-svg";
import type { TaskBackend } from "../../lib/api";
import { carryTrackingSince, pickupTrackingSince } from "../../lib/tracking";
import type { TodoDayStats } from "../../lib/types";
import { figure, mix, space, text, usePalette } from "../theme";
import { ChromeButton } from "./Chrome";
import { parseDateKey, todayKey } from "./dates";
import PageHead from "./PageHead";
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
//
// With no hover on a phone, a tap shows a day's numbers and a second tap on
// the same day opens it.

interface TodoStatsProps {
  api: TaskBackend;
  onPickDay: (date: string) => void;
  onClose: () => void;
}

// Chart geometry, in device pixels
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

const MONO = figure.fontFamily;

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
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const today = todayKey();
  const [range, setRange] = useState<StatsRange>(14);
  // The last answer, and the range it was for: a new range keeps the previous
  // frame on screen, dimmed, rather than blanking it
  const [result, setResult] = useState<{ range: string; days: Record<string, TodoDayStats> } | null>(
    null,
  );
  const [settled, setSettled] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [width, setWidth] = useState(0);
  const [tooltipWidth, setTooltipWidth] = useState(0);

  const since = useMemo(
    () => ({ carried: carryTrackingSince(today), started: pickupTrackingSince(today) }),
    [today],
  );
  const days = useMemo(() => rangeDays(today, range), [today, range]);
  const rangeKey = `${days[0]}…${days[days.length - 1]}`;
  const data = result?.days ?? null;
  const loading = settled !== rangeKey;

  const rows = useMemo(() => statsRows(days, data ?? {}, since), [days, data, since]);
  const totals = statsTotals(rows);

  useEffect(() => {
    let cancelled = false;
    void api.stats(days[0], days[days.length - 1]).then((res) => {
      if (cancelled) return;
      setSettled(rangeKey);
      if (res.ok) {
        setResult({ range: rangeKey, days: res.days });
        setError(null);
      } else {
        setError(res.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [api, days, rangeKey]);

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
  const tooltipCenter =
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

  const startedFill = mix(palette.chartDone, 14);
  const axisLine = mix(palette.border, 60);

  const tiles = [
    ["Started", totals.started],
    ["Done", totals.done],
    ["Carried over", totals.carried],
    ["Follow-through", percent],
  ] as const;

  const tooltipLine = (key: "started" | "done" | "carried", content: React.ReactNode) => (
    <View style={styles.tooltipLine}>
      <View
        style={[
          styles.key,
          key === "started"
            ? { height: 6, borderWidth: 1.5, borderColor: palette.chartDone }
            : { backgroundColor: key === "done" ? palette.chartDone : palette.chartCarried },
        ]}
      />
      <Text style={[styles.tooltipText, { color: palette.textSecondary }]}>{content}</Text>
    </View>
  );
  const strong = (value: number) => (
    <Text style={[figure, styles.strong, { color: palette.textPrimary }]}>{value}</Text>
  );

  return (
    <View style={[styles.page, { backgroundColor: palette.surface }]}>
      <PageHead title="Progress" subtitle={`The last ${range} days, up to today`}>
        <ChromeButton icon="checklist" label="Back to the list" palette={palette} onPress={onClose} />
      </PageHead>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Math.max(space["2xl"], insets.bottom) },
        ]}
      >
        <View style={styles.measure}>
          {/* The one filter, above everything it scopes */}
          <View
            style={[styles.range, { borderColor: mix(palette.border, 70) }]}
            accessibilityRole="radiogroup"
            accessibilityLabel="Range"
          >
            {STATS_RANGES.map((option) => (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ checked: range === option }}
                onPress={() => {
                  setActive(null);
                  setRange(option);
                }}
                style={[
                  styles.rangeOption,
                  range === option && { backgroundColor: palette.sidebarHover },
                ]}
              >
                <Text
                  style={[
                    styles.rangeText,
                    range === option
                      ? { color: palette.textPrimary, fontWeight: "600" }
                      : { color: palette.textSecondary },
                  ]}
                >
                  {option} days
                </Text>
              </Pressable>
            ))}
          </View>

          {error && (
            <Text style={[styles.error, { color: palette.danger }]} accessibilityRole="alert">
              {error}
            </Text>
          )}

          <View style={loading && data ? styles.refetching : undefined}>
            <View style={styles.tiles}>
              {tiles.map(([label, value]) => (
                <View key={label} style={styles.tile}>
                  <Text
                    style={[styles.tileLabel, { color: palette.textSecondary }]}
                    numberOfLines={1}
                  >
                    {label}
                  </Text>
                  <Text style={[styles.tileValue, { color: palette.textPrimary }]}>{value}</Text>
                </View>
              ))}
            </View>
            <Text style={[styles.hint, { color: palette.textSecondary }]}>
              Follow-through is the share of each day&apos;s tasks that got done that day instead
              of moving to a later one.
            </Text>

            <View style={styles.legend} importantForAccessibility="no-hide-descendants">
              <View style={styles.legendItem}>
                <View
                  style={[
                    styles.swatch,
                    {
                      width: 12,
                      borderWidth: 1.5,
                      borderColor: palette.chartDone,
                      backgroundColor: startedFill,
                    },
                  ]}
                />
                <Text style={[styles.legendText, { color: palette.textSecondary }]}>
                  Started that day
                </Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.swatch, { backgroundColor: palette.chartDone }]} />
                <Text style={[styles.legendText, { color: palette.textSecondary }]}>
                  Done that day
                </Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.swatch, { backgroundColor: palette.chartCarried }]} />
                <Text style={[styles.legendText, { color: palette.textSecondary }]}>
                  Carried to a later day
                </Text>
              </View>
            </View>

            {activeRow && (
              <Text style={[styles.hint, styles.tapHint, { color: palette.textMuted }]}>
                Tap the same day again to open it.
              </Text>
            )}

            <View
              style={[styles.chart, { height: PLOT_HEIGHT + X_LABEL_BAND }]}
              onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
              accessible
              accessibilityRole="image"
              accessibilityLabel={`Tasks started, done and carried over per day, the last ${range} days. ${totals.started} started, ${totals.done} done, ${totals.carried} carried over.`}
            >
              {width > 0 && data && (
                <Svg width={width} height={PLOT_HEIGHT + X_LABEL_BAND}>
                  {/* Axis: the two extremes and the baseline, nothing between */}
                  <G>
                    <Line
                      x1={AXIS_WIDTH}
                      x2={width}
                      y1={0.5}
                      y2={0.5}
                      stroke={axisLine}
                      strokeWidth={1}
                    />
                    <Line
                      x1={AXIS_WIDTH}
                      x2={width}
                      y1={PLOT_HEIGHT - 0.5}
                      y2={PLOT_HEIGHT - 0.5}
                      stroke={axisLine}
                      strokeWidth={1}
                    />
                    <SvgText
                      x={AXIS_WIDTH - 8}
                      y={9}
                      textAnchor="end"
                      fontFamily={MONO}
                      fontSize={10}
                      fill={palette.textMuted}
                    >
                      {top}
                    </SvgText>
                    <SvgText
                      x={AXIS_WIDTH - 8}
                      y={baseY + 3.5}
                      textAnchor="end"
                      fontFamily={MONO}
                      fontSize={10}
                      fill={palette.textMuted}
                    >
                      0
                    </SvgText>
                    <SvgText
                      x={AXIS_WIDTH - 8}
                      y={PLOT_HEIGHT - 2}
                      textAnchor="end"
                      fontFamily={MONO}
                      fontSize={10}
                      fill={palette.textMuted}
                    >
                      {bottom}
                    </SvgText>
                  </G>
                  <Line
                    x1={AXIS_WIDTH}
                    x2={width}
                    y1={baseY}
                    y2={baseY}
                    stroke={palette.border}
                    strokeWidth={1}
                  />

                  {rows.map((row, i) => {
                    const x = AXIS_WIDTH + slot * i + (slot - barWidth) / 2;
                    // Tapping one day quiets the rest, so the one you're
                    // reading stands out
                    const dim = active !== null && active !== i;
                    const isToday = row.date === today;
                    const showLabel = isToday || (rows.length - 1 - i) % every === 0;
                    const last = i === rows.length - 1;
                    return (
                      <G key={row.date}>
                        <G opacity={dim ? 0.35 : 1}>
                          {/* Drawn first so done paints over it; its baseline
                              end sits under the gap like done's */}
                          <Path
                            d={barPath(
                              x - STARTED_INSET + 0.75,
                              barWidth + 2 * STARTED_INSET - 1.5,
                              baseY - BASELINE_GAP,
                              Math.max(0, barHeight(row.started ?? 0, unit) - 0.75),
                              true,
                            ).replace(/ Z$/, "")}
                            fill={startedFill}
                            stroke={palette.chartDone}
                            strokeWidth={1.5}
                            strokeLinejoin="round"
                          />
                          <Path
                            d={barPath(
                              x,
                              barWidth,
                              baseY - BASELINE_GAP,
                              barHeight(row.done, unit),
                              true,
                            )}
                            fill={palette.chartDone}
                          />
                          <Path
                            d={barPath(
                              x,
                              barWidth,
                              baseY + BASELINE_GAP,
                              barHeight(row.carried ?? 0, unit),
                              false,
                            )}
                            fill={palette.chartCarried}
                          />
                        </G>
                        {showLabel && (
                          <SvgText
                            // The last label ends on the plot's edge instead
                            // of spilling past it
                            x={last ? width : AXIS_WIDTH + slot * (i + 0.5)}
                            y={PLOT_HEIGHT + X_LABEL_BAND - 6}
                            textAnchor={last ? "end" : "middle"}
                            fontSize={11}
                            fontWeight={isToday ? "600" : "400"}
                            fill={isToday ? palette.textSecondary : palette.textMuted}
                          >
                            {isToday
                              ? "Today"
                              : rows.length <= 7
                                ? formatDay(row.date, { weekday: "short" })
                                : formatDay(row.date, { day: "numeric", month: "short" })}
                          </SvgText>
                        )}
                        {/* The whole column is the hit target, not the painted bar */}
                        <Rect
                          x={AXIS_WIDTH + slot * i}
                          y={0}
                          width={slot}
                          height={PLOT_HEIGHT}
                          fill="transparent"
                          onPress={() => (active === i ? onPickDay(row.date) : setActive(i))}
                          accessibilityLabel={`${describe(row)}. Open this day.`}
                        />
                      </G>
                    );
                  })}
                </Svg>
              )}

              {activeRow && (
                <View
                  pointerEvents="none"
                  onLayout={(e) => setTooltipWidth(e.nativeEvent.layout.width)}
                  style={[
                    styles.tooltip,
                    {
                      left: tooltipCenter - tooltipWidth / 2,
                      opacity: tooltipWidth ? 1 : 0,
                      backgroundColor: palette.contextBg,
                      borderColor: palette.border,
                    },
                  ]}
                >
                  <Text style={[styles.tooltipDate, { color: palette.textPrimary }]}>
                    {activeRow.date === today
                      ? "Today so far"
                      : formatDay(activeRow.date, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })}
                  </Text>
                  {tooltipLine(
                    "started",
                    activeRow.started === null ? (
                      "Pickups not tracked yet"
                    ) : (
                      <>{strong(activeRow.started)} started</>
                    ),
                  )}
                  {tooltipLine("done", <>{strong(activeRow.done)} done</>)}
                  {tooltipLine(
                    "carried",
                    activeRow.carried === null ? (
                      "Carry-overs not tracked yet"
                    ) : (
                      <>{strong(activeRow.carried)} carried over</>
                    ),
                  )}
                </View>
              )}
            </View>

            {untracked.length > 0 && (
              <Text style={[styles.hint, { color: palette.textSecondary }]}>
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
              </Text>
            )}

            <Pressable
              onPress={() => setShowTable((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: showTable }}
              style={styles.tableToggle}
              hitSlop={8}
            >
              <Text style={[styles.tableToggleText, { color: palette.accent }]}>
                {showTable ? "Hide the numbers" : "Show the numbers"}
              </Text>
            </Pressable>

            {showTable && (
              <View style={styles.table}>
                {[
                  { key: "head", cells: ["Day", "Started", "Done", "Carried over"] },
                  ...[...rows].reverse().map((row) => ({
                    key: row.date,
                    cells: [
                      row.date === today
                        ? "Today"
                        : formatDay(row.date, { weekday: "short", month: "short", day: "numeric" }),
                      row.started ?? "—",
                      row.done,
                      row.carried ?? "—",
                    ],
                  })),
                ].map(({ key, cells }) => {
                  const head = key === "head";
                  return (
                    <View
                      key={key}
                      style={[
                        styles.tableRow,
                        {
                          borderBottomWidth: StyleSheet.hairlineWidth,
                          borderBottomColor: mix(palette.border, 50),
                        },
                      ]}
                    >
                      {cells.map((cell, i) => (
                        <Text
                          key={i}
                          style={[
                            styles.tableCell,
                            i === 0 ? styles.tableFirst : [styles.tableNumber, !head && figure],
                            head
                              ? { fontSize: text.xs, fontWeight: "600", color: palette.textMuted }
                              : { color: i === 0 ? palette.textSecondary : palette.textPrimary },
                          ]}
                        >
                          {cell}
                        </Text>
                      ))}
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  scroll: {
    paddingTop: space.sm,
    paddingHorizontal: space.md,
  },
  measure: {
    width: "100%",
    maxWidth: 620,
    alignSelf: "center",
  },
  range: {
    flexDirection: "row",
    alignSelf: "flex-start",
    gap: space["3xs"],
    padding: space["3xs"],
    marginBottom: space.lg,
    borderWidth: 1,
    borderRadius: 9999,
  },
  rangeOption: {
    paddingVertical: space["2xs"],
    paddingHorizontal: space.sm,
    borderRadius: 9999,
  },
  rangeText: {
    fontSize: text.xs,
  },
  error: {
    marginBottom: space.sm,
    fontSize: text.sm,
  },
  // A new range keeps the old frame, dimmed, until its numbers arrive
  refetching: {
    opacity: 0.55,
  },
  // Four figures don't fit a phone's width in one row
  tiles: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: space.md,
  },
  tile: {
    width: "50%",
    paddingRight: space.md,
  },
  tileLabel: {
    fontSize: text.xs,
  },
  // Proportional figures at display size; tabular digits look loose this big
  tileValue: {
    marginTop: space["3xs"],
    fontSize: text["2xl"],
    fontWeight: "600",
    letterSpacing: -0.25,
    lineHeight: text["2xl"] * 1.1,
  },
  hint: {
    marginTop: space.sm,
    fontSize: text.xs,
    lineHeight: text.xs * 1.5,
  },
  tapHint: {
    marginTop: 0,
    marginBottom: space.xs,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: space.md,
    rowGap: space["2xs"],
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
  },
  legendText: {
    fontSize: text.xs,
  },
  // Legend mirrors the mark: a small column, not a dot
  swatch: {
    width: 8,
    height: 12,
    borderRadius: 2,
  },
  chart: {
    width: "100%",
  },
  tooltip: {
    position: "absolute",
    bottom: PLOT_HEIGHT + X_LABEL_BAND + space.xs,
    minWidth: 152,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    borderWidth: 1,
    borderRadius: 8,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  tooltipDate: {
    marginBottom: space["3xs"],
    fontSize: text.xs,
    fontWeight: "600",
    lineHeight: text.xs * 1.6,
  },
  tooltipLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
  },
  tooltipText: {
    fontSize: text.xs,
    lineHeight: text.xs * 1.6,
  },
  strong: {
    fontWeight: "600",
  },
  // Tooltip rows key their series with a short stroke, not a box
  key: {
    width: 10,
    height: 2,
    borderRadius: 1,
  },
  tableToggle: {
    alignSelf: "flex-start",
    marginTop: space.md,
  },
  tableToggleText: {
    fontSize: text.xs,
  },
  table: {
    marginTop: space.sm,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: space["2xs"],
  },
  tableCell: {
    fontSize: text.sm,
  },
  tableFirst: {
    flex: 1.6,
  },
  tableNumber: {
    flex: 1,
    textAlign: "right",
  },
});
