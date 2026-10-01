import { useEffect, useMemo, useRef, useState } from "react";
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { formatInstant, totalSeconds } from "../../lib/tasksLogic";
import type { TaskStatus, TodoTask } from "../../lib/types";
import Icon from "../Icon";
import { duration, figure, mix, space, text, usePalette, type Palette } from "../theme";
import { buildDissolveWords, CHAR_MS } from "./dissolve";
import { elapsedPrecise, elapsedWords, formatElapsed } from "./elapsed";
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
  // Pressing the grip starts a drag. A pan from react-native-gesture-handler
  // rather than a long-press on the row, so the rest of the row still scrolls
  // the list; the list finds the row under the finger from its absolute y.
  onDragStart: () => void;
  onDragMove: (absoluteY: number) => void;
  // `completed` is false when the system took the gesture away
  onDragEnd: (completed: boolean) => void;
  dragging: boolean;
  dropTarget: boolean;
  // A hairline above the row, when another row is right above it
  divided: boolean;
}

// What the checkbox does from each state, for its name
const CHECK_LABEL: Record<TaskStatus, string> = {
  todo: "Start this task",
  inProgress: "Mark as done",
  done: "Move back to In Progress",
};

const ease = {
  out: Easing.bezier(0.16, 1, 0.3, 1),
  in: Easing.bezier(0.7, 0, 0.84, 0),
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
};

const CHECK_SIZE = 22;
const ACTION_SIZE = 32;

const AnimatedPath = Animated.createAnimatedComponent(Path);

// A tri-state box: Todo is unticked, In Progress half-way, Done ticked. The
// tick draws itself on; the half square grows in.
function Checkbox({
  status,
  disabled,
  onPress,
  palette,
}: {
  status: TaskStatus;
  disabled: boolean;
  onPress: () => void;
  palette: Palette;
}) {
  const reduce = useReducedMotion();
  const on = useSharedValue(status === "done" ? 1 : 0);
  const half = useSharedValue(status === "inProgress" ? 1 : 0);
  const pressed = useSharedValue(1);

  useEffect(() => {
    const time = (to: number) =>
      reduce ? to : withTiming(to, { duration: duration.short, easing: ease.inOut });
    on.set(time(status === "done" ? 1 : 0));
    half.set(time(status === "inProgress" ? 1 : 0));
  }, [status, reduce, on, half]);

  const idleBorder = mix(palette.border, 90);
  const boxStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.get(), [0, 1], ["#00000000", palette.accent]),
    borderColor: interpolateColor(
      Math.max(on.get(), half.get()),
      [0, 1],
      [idleBorder, palette.accent],
    ),
    transform: [{ scale: pressed.get() }],
  }));
  const halfStyle = useAnimatedStyle(() => ({ transform: [{ scale: half.get() * 0.5 }] }));
  const tickProps = useAnimatedProps(() => ({ strokeDashoffset: 22 * (1 - on.get()) }));

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        if (!reduce) pressed.set(withTiming(0.88, { duration: duration.micro }));
      }}
      onPressOut={() => {
        pressed.set(reduce ? 1 : withTiming(1, { duration: duration.micro }));
      }}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="checkbox"
      accessibilityState={{
        checked: status === "done" ? true : status === "inProgress" ? "mixed" : false,
        disabled,
      }}
      accessibilityLabel={CHECK_LABEL[status]}
    >
      <Animated.View style={[styles.check, boxStyle]}>
        <Animated.View style={[styles.checkHalf, { backgroundColor: palette.accent }, halfStyle]} />
        <Svg width={15} height={15} viewBox="0 0 24 24" style={styles.checkTick}>
          <AnimatedPath
            d="M5 12.5l4.5 4.5L19 7.5"
            stroke={palette.surface}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            strokeDasharray={22}
            animatedProps={tickProps}
          />
        </Svg>
      </Animated.View>
    </Pressable>
  );
}

// The time an In Progress task has run, all days included. Always worked out
// from the banked log and the open run, never counted up in state, so a
// restart shows the same figure.
function RunningTime({ task, palette }: { task: TodoTask; palette: Palette }) {
  const now = useTicker();
  const reduce = useReducedMotion();
  const seconds = totalSeconds(task, formatInstant(now, 0));
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (reduce) return;
    pulse.set(withRepeat(
      withSequence(
        withTiming(0.35, { duration: 1200, easing: ease.inOut }),
        withTiming(1, { duration: 1200, easing: ease.inOut }),
      ),
      -1,
    ));
  }, [reduce, pulse]);
  const dotStyle = useAnimatedStyle(() => ({ opacity: pulse.get() }));

  return (
    <View
      style={styles.running}
      accessible
      accessibilityLabel={`Running for ${elapsedWords(seconds)}`}
      accessibilityHint={`${elapsedPrecise(seconds)} worked on this task`}
    >
      {task.runningSince && (
        <Animated.View style={[styles.runningDot, { backgroundColor: palette.accent }, dotStyle]} />
      )}
      <Text style={[styles.runningText, figure, { color: palette.textSecondary }]}>
        {formatElapsed(seconds)}
      </Text>
    </View>
  );
}

// One character of the letter-dissolve: it fades, lifts and goes on its own
// delay. Blur isn't available on a native view, so the fade carries it alone.
function DissolveChar({
  char,
  delayMs,
  style,
}: {
  char: string;
  delayMs: number;
  style: StyleProp<TextStyle>;
}) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(withDelay(delayMs, withTiming(1, { duration: CHAR_MS, easing: ease.in })));
  }, [delayMs, progress]);
  const animated = useAnimatedStyle(() => ({
    opacity: 1 - progress.get(),
    transform: [{ translateY: -3 * progress.get() }],
  }));
  return <Animated.Text style={[style, animated]}>{char}</Animated.Text>;
}

function RowAction({
  icon,
  label,
  color,
  disabled,
  onPress,
  actionRef,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  color: string;
  disabled?: boolean;
  onPress: () => void;
  actionRef?: React.Ref<View>;
}) {
  return (
    <Pressable
      ref={actionRef}
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.action,
        disabled && { opacity: 0.35 },
        pressed && { transform: [{ translateY: 0.5 }] },
      ]}
    >
      <Icon name={icon} size={18} color={color} />
    </Pressable>
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
  onDragMove,
  onDragEnd,
  dragging,
  dropTarget,
  divided,
}: TaskRowProps) {
  const palette = usePalette();
  const reduce = useReducedMotion();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.text);
  // The schedule button while its date picker is open
  const [scheduling, setScheduling] = useState(false);
  const scheduleRef = useRef<View>(null);
  const spring = useSharedValue(1);

  const commit = () => {
    setEditing(false);
    const next = draft.replace(/\s+/g, " ").trim();
    if (next && next !== task.text) onRename(next);
  };

  // Checked reads true for the whole dissolve, so the tick draws itself in
  // while the letters are still going rather than after them.
  const status: TaskStatus = dissolving ? "done" : task.status;
  const checked = status === "done";
  const inProgress = status === "inProgress";

  const labelStyle: TextStyle = {
    fontSize: text.md,
    // A whole pixel: iOS clips the last line of nested text (the links) when a
    // fractional line height lands between pixels
    lineHeight: Math.round(text.md * 1.45),
    color: checked ? palette.textMuted : palette.textPrimary,
  };

  // Recomputed only when the text changes — every row renders on any list update
  const segments = useMemo(() => parseTaskSegments(task.text), [task.text]);
  const dissolveWords = useMemo(
    () => (dissolving ? buildDissolveWords(segments) : []),
    [dissolving, segments],
  );

  const springStyle = useAnimatedStyle(() => ({ transform: [{ scale: spring.get() }] }));

  // A completed task's link recedes with the rest of the row rather than
  // staying the one bright thing left on it
  const linkColor = checked ? mix(palette.accent, 55, palette.textMuted) : palette.accent;

  // Callbacks run on the JS thread: the drag only moves state, not a view.
  // The grip owns its gesture: it activates on the first movement, before the
  // scroll view's own pan can, which cancels that one.
  const drag = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onStart(() => onDragStart())
    .onUpdate((e) => onDragMove(e.absoluteY))
    .onFinalize((_, success) => onDragEnd(success));

  const grip = (
    <View
      style={styles.grip}
      accessible
      accessibilityLabel="Drag to reorder"
      hitSlop={{ top: 10, bottom: 10, left: 8, right: 4 }}
    >
      <Icon name="dragIndicator" size={18} color={palette.textMuted} />
    </View>
  );

  return (
    <Animated.View
      style={[
        styles.row,
        divided && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: mix(palette.border, 45) },
        checked && { opacity: 0.5 },
        dragging && { opacity: 0.5, backgroundColor: mix(palette.sidebarHover, 45) },
        // Where the dragged row will land: just above this one
        dropTarget && { borderTopWidth: 2, borderTopColor: palette.accent },
        springStyle,
      ]}
      pointerEvents={dissolving ? "none" : "auto"}
    >
      {reorderable && !editing && !dissolving ? (
        <GestureDetector gesture={drag}>{grip}</GestureDetector>
      ) : reorderable ? (
        grip
      ) : (
        // Holds the checkbox on the same column as the open rows above
        <View style={{ width: 18 }} />
      )}

      <Checkbox
        status={status}
        disabled={dissolving}
        palette={palette}
        onPress={() => {
          if (!reduce) {
            spring.set(withSequence(
              withTiming(1.012, { duration: 128, easing: ease.out }),
              withTiming(1, { duration: 192, easing: ease.out }),
            ));
          }
          onToggle();
        }}
      />

      {/* Label / inline editor */}
      <View style={styles.body}>
        {dissolving ? (
          // Every character on its own delay, grouped into words so the line
          // breaks stay close to where they were
          <View style={styles.dissolve} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {dissolveWords.map((word, w) => (
              <View key={w} style={styles.dissolveWord}>
                {word.map((c, i) => (
                  <DissolveChar
                    key={i}
                    char={c.char}
                    delayMs={c.delayMs}
                    style={[labelStyle, c.isLink && { color: palette.accent }]}
                  />
                ))}
              </View>
            ))}
          </View>
        ) : editing ? (
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onBlur={commit}
            onSubmitEditing={commit}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            submitBehavior="blurAndSubmit"
            maxLength={500}
            style={[
              styles.editor,
              {
                color: palette.textPrimary,
                backgroundColor: palette.surface,
                borderColor: palette.accent,
              },
            ]}
          />
        ) : (
          // Tapping the text edits it; tapping a link opens it instead
          <Text
            style={labelStyle}
            onPress={() => {
              setDraft(task.text);
              setEditing(true);
            }}
            accessibilityRole="button"
            accessibilityHint="Double tap to edit"
          >
            {segments.map((segment, i) =>
              segment.type === "link" ? (
                <Text
                  key={i}
                  style={[styles.link, { color: linkColor, textDecorationColor: linkColor }]}
                  onPress={() => void Linking.openURL(segment.href)}
                  accessibilityRole="link"
                  accessibilityLabel={`Open ${segment.href}`}
                >
                  {segment.value}
                </Text>
              ) : (
                segment.value
              ),
            )}
          </Text>
        )}
        {/* Under the label rather than beside it, so it never takes width
            from the text */}
        {inProgress && !editing && <RunningTime task={task} palette={palette} />}
      </View>

      {onBack && (
        <RowAction
          icon="undo"
          label="Move back to Todo"
          color={palette.textMuted}
          disabled={dissolving}
          onPress={onBack}
        />
      )}

      {onSchedule && (
        <RowAction
          icon="editCalendar"
          label="Schedule task"
          color={palette.textMuted}
          disabled={dissolving}
          onPress={() => setScheduling(true)}
          actionRef={scheduleRef}
        />
      )}
      {onSchedule && scheduling && (
        <SchedulePicker
          anchor={scheduleRef}
          currentDate={task.date}
          onPick={(date) => {
            setScheduling(false);
            onSchedule(date);
          }}
          onClose={() => setScheduling(false)}
        />
      )}

      {onDefer && (
        <RowAction
          icon="arrowForward"
          label="Move to tomorrow"
          color={palette.textMuted}
          disabled={dissolving}
          onPress={onDefer}
        />
      )}

      <RowAction icon="deleteOutline" label="Delete task" color={palette.danger} onPress={onDelete} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.xs,
    paddingVertical: space.sm,
    paddingHorizontal: space["2xs"],
  },
  grip: {
    marginTop: 2,
  },
  check: {
    width: CHECK_SIZE,
    height: CHECK_SIZE,
    marginTop: 0,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  checkHalf: {
    width: 15,
    height: 15,
    borderRadius: 3,
  },
  // Centred over the half square by the box's own alignment
  checkTick: {
    position: "absolute",
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  editor: {
    paddingVertical: space["3xs"],
    paddingHorizontal: space["2xs"],
    // 16 keeps the phone's text at a size it doesn't want to zoom
    fontSize: 16,
    borderWidth: 1,
    borderRadius: 6,
  },
  link: {
    textDecorationLine: "underline",
  },
  dissolve: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  dissolveWord: {
    flexDirection: "row",
  },
  running: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
  runningDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
  },
  runningText: {
    fontSize: text.xs,
  },
  action: {
    width: ACTION_SIZE,
    height: ACTION_SIZE,
    marginTop: -5,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
});
