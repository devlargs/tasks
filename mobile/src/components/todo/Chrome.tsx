import { useEffect, type ReactNode } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Icon, { type IconName } from "../Icon";
import { mix, space, text, type Palette } from "../theme";

// The head's controls, shared by the list, the calendar and the Progress view:
// round icon buttons and the small outlined pills (Today, Synced).

export function ChromeButton({
  icon,
  label,
  palette,
  onPress,
  size = 17,
  active = false,
  spinning = false,
  small = false,
}: {
  icon: IconName;
  label: string;
  palette: Palette;
  onPress: () => void;
  size?: number;
  active?: boolean;
  spinning?: boolean;
  small?: boolean;
}) {
  const reduce = useReducedMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    if (spinning && !reduce) {
      turn.set(0);
      turn.set(withRepeat(withTiming(360, { duration: 1000, easing: Easing.linear }), -1));
    } else {
      turn.set(0);
    }
  }, [spinning, reduce, turn]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get()}deg` }] }));
  return (
    <Pressable
      onPress={onPress}
      hitSlop={small ? 8 : 2}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={active ? { expanded: true } : undefined}
      style={({ pressed }) => [
        small ? styles.chromeSmall : styles.chromeButton,
        pressed && { backgroundColor: palette.sidebarHover },
      ]}
    >
      <Animated.View style={spin}>
        <Icon name={icon} size={size} color={active ? palette.accent : palette.textMuted} />
      </Animated.View>
    </Pressable>
  );
}

export function Pill({
  palette,
  accent = false,
  onPress,
  children,
  label,
}: {
  palette: Palette;
  accent?: boolean;
  onPress: () => void;
  children: ReactNode;
  label?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.pill,
        {
          borderColor: accent ? mix(palette.accent, 45) : mix(palette.border, 70),
        },
      ]}
    >
      <Text style={[styles.pillText, { color: accent ? palette.accent : palette.textSecondary }]}>
        {children}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chromeButton: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  chromeSmall: {
    width: 24,
    height: 24,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  pill: {
    paddingVertical: space["3xs"],
    paddingHorizontal: space.xs,
    marginRight: space["2xs"],
    borderWidth: 1,
    borderRadius: 999,
  },
  pillText: {
    fontSize: text["2xs"],
  },
});
