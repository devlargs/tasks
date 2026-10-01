import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { mix, space, text, usePalette } from "../theme";

// The pinned head the calendar and the Progress view share with the list: a
// display title, a line under it, the controls on the right, and the same
// bottom rule, just without the progress.
export default function PageHead({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.head, { paddingTop: insets.top + space.xs }]}>
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <Text style={[styles.title, { color: palette.textPrimary }]} accessibilityRole="header">
            {title}
          </Text>
          <Text style={[styles.subtitle, { color: palette.textSecondary }]}>{subtitle}</Text>
        </View>
        <View style={styles.chrome}>{children}</View>
      </View>
      <View style={[styles.rule, { backgroundColor: mix(palette.border, 55) }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    paddingHorizontal: space.md,
  },
  header: {
    width: "100%",
    maxWidth: 620,
    alignSelf: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space.sm,
    marginBottom: space.md,
  },
  titleBlock: {
    minWidth: 0,
    flexShrink: 1,
  },
  title: {
    fontSize: text["2xl"],
    fontWeight: "200",
    letterSpacing: -0.5,
    lineHeight: text["2xl"] * 1.15,
  },
  subtitle: {
    marginTop: space["3xs"],
    fontSize: text.xs,
  },
  chrome: {
    flexDirection: "row",
    alignItems: "center",
    gap: space["3xs"],
  },
  rule: {
    height: 2,
    marginHorizontal: -space.md,
  },
});
