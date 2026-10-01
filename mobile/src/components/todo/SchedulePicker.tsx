import { useEffect, useMemo, useState, type RefObject } from "react";
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import Icon from "../Icon";
import { figure, mix, space, text, usePalette } from "../theme";
import { inMonth, monthGrid, monthStart, shiftMonth, weekdayLabels } from "./calendar";
import { formatDayLabel, parseDateKey, todayKey } from "./dates";

interface SchedulePickerProps {
  // The row's schedule button; the panel hangs off it
  anchor: RefObject<View | null>;
  // The day the task is on now
  currentDate: string;
  onPick: (date: string) => void;
  onClose: () => void;
}

const WIDTH = 256;
const GAP = 6;
const MARGIN = 8;

const WEEKDAYS = weekdayLabels("narrow");

// A small month to move a task onto. In a modal, so the list's scroll view
// can't clip a panel opened near its bottom edge; a tap anywhere outside the
// panel closes it.
export default function SchedulePicker({
  anchor,
  currentDate,
  onPick,
  onClose,
}: SchedulePickerProps) {
  const palette = usePalette();
  const window = useWindowDimensions();
  const today = todayKey();
  // Decides which month is on screen
  const [focused, setFocused] = useState(() => (currentDate < today ? today : currentDate));
  const [height, setHeight] = useState(0);
  const [rect, setRect] = useState<{ x: number; y: number; width: number; height: number } | null>(
    null,
  );

  const month = monthStart(focused);
  const grid = useMemo(() => monthGrid(month), [month]);

  useEffect(() => {
    anchor.current?.measureInWindow((x, y, width, h) => setRect({ x, y, width, height: h }));
  }, [anchor]);

  // Below the button, right edges aligned; flipped above when there isn't room.
  // Waits for both the button's place and the panel's height.
  let position: { top: number; left: number } | null = null;
  if (rect && height > 0) {
    const below = rect.y + rect.height + GAP;
    position = {
      top:
        below + height <= window.height - MARGIN ? below : Math.max(MARGIN, rect.y - GAP - height),
      left: Math.max(MARGIN, Math.min(rect.x + rect.width - WIDTH, window.width - WIDTH - MARGIN)),
    };
  }

  const goToMonth = (delta: number) => {
    const first = shiftMonth(month, delta);
    setFocused(first < today ? today : first);
  };

  const monthLabel = parseDateKey(month).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <Animated.View
        entering={FadeIn.duration(220)}
        onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
        accessibilityViewIsModal
        accessibilityLabel="Schedule task"
        style={[
          styles.panel,
          {
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            opacity: position ? 1 : 0,
            backgroundColor: palette.contextBg,
            borderColor: palette.border,
          },
        ]}
      >
        <View style={styles.head}>
          <Pressable
            onPress={() => goToMonth(-1)}
            disabled={inMonth(today, month)}
            style={[styles.nav, inMonth(today, month) && { opacity: 0.3 }]}
            accessibilityRole="button"
            accessibilityLabel="Previous month"
          >
            <Icon name="chevronLeft" size={18} color={palette.textMuted} />
          </Pressable>
          <Text
            style={[styles.month, { color: palette.textPrimary }]}
            accessibilityLiveRegion="polite"
          >
            {monthLabel}
          </Text>
          <Pressable
            onPress={() => goToMonth(1)}
            style={styles.nav}
            accessibilityRole="button"
            accessibilityLabel="Next month"
          >
            <Icon name="chevronRight" size={18} color={palette.textMuted} />
          </Pressable>
        </View>

        <View style={styles.grid} importantForAccessibility="no-hide-descendants">
          {WEEKDAYS.map((name, i) => (
            <Text key={i} style={[styles.cell, styles.weekday, { color: palette.textMuted }]}>
              {name}
            </Text>
          ))}
        </View>

        <View style={styles.grid}>
          {grid.map((key) => {
            const past = key < today;
            const current = key === currentDate;
            const outside = !inMonth(key, month);
            return (
              <View key={key} style={styles.cell}>
                <Pressable
                  onPress={() => onPick(key)}
                  // Earlier days would only roll straight back onto today
                  disabled={past}
                  accessibilityRole="button"
                  accessibilityLabel={`${formatDayLabel(key)}${current ? " (current day)" : ""}`}
                  accessibilityState={{ disabled: past, selected: current }}
                  style={({ pressed }) => [
                    styles.day,
                    key === today && { borderColor: mix(palette.accent, 60) },
                    current && { backgroundColor: palette.accent },
                    pressed && !current && { backgroundColor: mix(palette.sidebarHover, 60) },
                    past && { opacity: 0.35 },
                  ]}
                >
                  <Text
                    style={[
                      styles.dayText,
                      figure,
                      {
                        color: current
                          ? palette.surface
                          : past || outside
                            ? palette.textMuted
                            : palette.textPrimary,
                      },
                    ]}
                  >
                    {parseDateKey(key).getDate()}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: "absolute",
    width: WIDTH,
    padding: space.xs,
    borderWidth: 1,
    borderRadius: 10,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space["2xs"],
  },
  nav: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  month: {
    fontSize: text.sm,
    fontWeight: "600",
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
    marginBottom: 2,
    fontSize: text["2xs"],
    textAlign: "center",
  },
  day: {
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: 999,
  },
  dayText: {
    fontSize: text.xs,
  },
});
