import { Pressable, StyleSheet, Text, View } from "react-native";
import { THEMES, type Theme } from "../../lib/themeChoice";
import { mix, space, text, usePalette, useTheme } from "../theme";

// Dark or Light, at the top of the settings menu — the web's ThemeSwitch. The
// app re-themes the moment one is picked and the menu stays open, so the
// change is its own confirmation. Remembered on this device; the root layout
// applies it before the first frame on the next launch.

const LABEL: Record<Theme, string> = { dark: "Dark", light: "Light" };

export default function ThemeSwitch() {
  const palette = usePalette();
  const [theme, choose] = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: mix(palette.border, 70) }]}>
      <Text style={[styles.label, { color: palette.textPrimary }]}>Theme</Text>
      {/* The Progress range's pill, a size down */}
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Theme"
        style={[styles.switch, { borderColor: mix(palette.border, 70) }]}
      >
        {THEMES.map((option) => {
          const checked = theme === option;
          return (
            <Pressable
              key={option}
              onPress={() => choose(option)}
              accessibilityRole="radio"
              accessibilityState={{ checked }}
              hitSlop={{ top: 8, bottom: 8 }}
              style={({ pressed }) => [
                styles.option,
                checked && { backgroundColor: palette.sidebarHover },
                pressed && !checked && { backgroundColor: mix(palette.sidebarHover, 45) },
              ]}
            >
              <Text
                style={[
                  styles.optionText,
                  checked
                    ? { color: palette.textPrimary, fontWeight: "600" }
                    : { color: palette.textSecondary },
                ]}
              >
                {LABEL[option]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingTop: space["2xs"],
    paddingBottom: space.xs,
    paddingLeft: space.sm,
    paddingRight: space.xs,
    marginBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: {
    fontSize: text.md,
  },
  switch: {
    flexDirection: "row",
    gap: space["3xs"],
    padding: space["3xs"],
    borderWidth: 1,
    borderRadius: 9999,
  },
  option: {
    paddingVertical: space["2xs"],
    paddingHorizontal: space.sm,
    borderRadius: 9999,
  },
  optionText: {
    fontSize: text.xs,
  },
});
