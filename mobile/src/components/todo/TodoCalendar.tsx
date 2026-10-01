import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, withTiming, type EntryAnimationsValues } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { TaskBackend } from "../../lib/api";
import type { TodoDaySummary } from "../../lib/types";
import { duration, figure, mix, space, text, usePalette, type Palette } from "../theme";
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
import PageHead from "./PageHead";
import { ChromeButton, Pill } from "./Chrome";

interface TodoCalendarProps {
  api: TaskBackend;
  // The day the list was showing, outlined so you can see where you came from
  selectedDate: string;
  onPickDay: (date: string) => void;
  onClose: () => void;
}

const WEEKDAYS = weekdayLabels("short");

const easeOut = Easing.bezier(0.16, 1, 0.3, 1);

// A new month slides in from the direction of travel, like a new day
const slideFrom = (dx: number) => (_: EntryAnimationsValues) => {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ translateX: dx }] },
    animations: {
      opacity: withTiming(1, { duration: duration.short, easing: easeOut }),
      transform: [{ translateX: withTiming(0, { duration: duration.short, easing: easeOut }) }],
    },
  };
};
const slideNext = slideFrom(14);
const slidePrev = slideFrom(-14);

function Dot({ kind, palette }: { kind: "done" | "progress" | "pending"; palette: Palette }) {
  if (kind === "done") return <View style={[styles.dot, { backgroundColor: palette.success }]} />;
  // Hollow: pending is work not yet filled in
  if (kind === "pending") {
    return <View style={[styles.dot, styles.dotRing, { borderColor: palette.warning }]} />;
  }
  // Half-filled: in progress sits between the two
  return (
    <View style={[styles.dot, styles.dotRing, { borderColor: palette.accent }]}>
      <View style={[styles.dotHalf, { backgroundColor: palette.accent }]} />
    </View>
  );
}

export default function TodoCalendar({ api, selectedDate, onPickDay, onClose }: TodoCalendarProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
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

  const counts: { kind: "done" | "progress" | "pending"; label: string }[] = [
    { kind: "done", label: "Done" },
    { kind: "progress", label: "In progress" },
    { kind: "pending", label: "Pending" },
  ];

  return (
    <View style={[styles.page, { backgroundColor: palette.surface }]}>
      <PageHead
        title={monthLabel}
        subtitle={
          <>
            <Text style={figure}>{totals.done}</Text> done
            {" · "}
            <Text style={figure}>{totals.inProgress}</Text> in progress
            {" · "}
            <Text style={figure}>{totals.pending}</Text> pending
          </>
        }
      >
        {!inMonth(today, month) && (
          <Pill palette={palette} accent onPress={() => goToMonth(monthStart(today))}>
            Today
          </Pill>
        )}
        <ChromeButton
          icon="chevronLeft"
          size={20}
          label="Previous month"
          palette={palette}
          onPress={() => goToMonth(shiftMonth(month, -1))}
        />
        <ChromeButton
          icon="chevronRight"
          size={20}
          label="Next month"
          palette={palette}
          onPress={() => goToMonth(shiftMonth(month, 1))}
        />
        <ChromeButton icon="checklist" label="Back to the list" palette={palette} onPress={onClose} />
      </PageHead>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Math.max(space["2xl"], insets.bottom) },
        ]}
      >
        <View style={styles.measure}>
          {error && <Text style={[styles.error, { color: palette.danger }]}>{error}</Text>}

          <View style={styles.grid} importantForAccessibility="no-hide-descendants">
            {WEEKDAYS.map((name) => (
              <Text key={name} style={[styles.cell, styles.weekday, { color: palette.textMuted }]}>
                {name}
              </Text>
            ))}
          </View>

          <Animated.View
            key={month}
            entering={slide === "next" ? slideNext : slide === "prev" ? slidePrev : undefined}
            style={styles.grid}
          >
            {grid.map((key) => {
              const day = days[key];
              const isToday = key === today;
              const label = parseDateKey(key).toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              });
              const values = { done: day?.done, progress: day?.inProgress, pending: day?.pending };
              return (
                <View key={key} style={styles.cell}>
                  <Pressable
                    onPress={() => onPickDay(key)}
                    accessibilityRole="button"
                    accessibilityLabel={`${label}: ${summaryPhrase(day)}`}
                    accessibilityState={{ selected: key === selectedDate }}
                    style={({ pressed }) => [
                      styles.day,
                      {
                        borderColor:
                          key === selectedDate
                            ? mix(palette.accent, 55)
                            : mix(palette.border, 35),
                      },
                      // The neighbouring months' days pad the grid; they
                      // recede but stay tappable
                      !inMonth(key, month) && { opacity: 0.4 },
                      pressed && { backgroundColor: mix(palette.sidebarHover, 45) },
                    ]}
                  >
                    <View style={[styles.date, isToday && { backgroundColor: palette.accent }]}>
                      <Text
                        style={[
                          styles.dateText,
                          figure,
                          { color: isToday ? palette.surface : palette.textPrimary },
                        ]}
                      >
                        {parseDateKey(key).getDate()}
                      </Text>
                    </View>
                    <View style={styles.counts}>
                      {counts.map(({ kind }) =>
                        values[kind] ? (
                          <View key={kind} style={styles.count}>
                            <Dot kind={kind} palette={palette} />
                            <Text
                              style={[styles.countText, figure, { color: palette.textSecondary }]}
                            >
                              {values[kind]}
                            </Text>
                          </View>
                        ) : null,
                      )}
                    </View>
                  </Pressable>
                </View>
              );
            })}
          </Animated.View>

          <View style={styles.legend} importantForAccessibility="no-hide-descendants">
            {counts.map(({ kind, label }) => (
              <View key={kind} style={styles.count}>
                <Dot kind={kind} palette={palette} />
                <Text style={[styles.legendText, { color: palette.textMuted }]}>{label}</Text>
              </View>
            ))}
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
  error: {
    marginBottom: space.sm,
    fontSize: text.sm,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    width: `${100 / 7}%`,
    padding: 1,
  },
  weekday: {
    marginBottom: space["2xs"],
    fontSize: text["2xs"],
    textAlign: "center",
  },
  // Cells are tinted hairline boxes, not cards — the counts are the content
  day: {
    minHeight: 64,
    justifyContent: "space-between",
    gap: space["3xs"],
    padding: space["2xs"],
    borderWidth: 1,
    borderRadius: 8,
  },
  date: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 3,
    alignSelf: "flex-start",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
  },
  dateText: {
    fontSize: text.xs,
  },
  counts: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: space["2xs"],
    rowGap: 2,
  },
  count: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  countText: {
    fontSize: text["2xs"],
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    overflow: "hidden",
  },
  dotRing: {
    borderWidth: 1.5,
  },
  dotHalf: {
    width: "50%",
    height: "100%",
  },
  legend: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: space.sm,
    marginTop: space.sm,
  },
  legendText: {
    fontSize: text["2xs"],
  },
});
