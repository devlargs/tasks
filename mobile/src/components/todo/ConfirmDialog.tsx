import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { mix, space, text, usePalette } from "../theme";

interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  // Red confirm button, for an action that destroys something
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// A modal yes/no: the list behind it can't be touched, a tap on the backdrop
// or the back button cancels, and it reads as a question rather than an error
// the way a system alert would.
export default function ConfirmDialog({
  title,
  children,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const palette = usePalette();
  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel="Cancel" />
        <Animated.View
          entering={FadeIn.duration(220)}
          accessibilityViewIsModal
          style={[styles.panel, { backgroundColor: palette.contextBg, borderColor: palette.border }]}
        >
          <Text style={[styles.title, { color: palette.textPrimary }]} accessibilityRole="header">
            {title}
          </Text>
          <View style={styles.body}>{children}</View>
          <View style={styles.actions}>
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.button,
                { borderColor: palette.border },
                pressed && { backgroundColor: palette.contextHover },
              ]}
            >
              <Text style={[styles.buttonText, { color: palette.textPrimary }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: destructive ? palette.danger : palette.accent,
                  borderColor: destructive ? palette.danger : palette.accent,
                },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={[styles.buttonText, { color: palette.surface }]}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

// The task itself, quoted, so it's clear which row the tap landed on
export function ConfirmTask({ children }: { children: string }) {
  const palette = usePalette();
  return (
    <Text
      style={[
        styles.task,
        { color: palette.textPrimary, backgroundColor: mix(palette.panel, 70, palette.surface) },
      ]}
    >
      {children}
    </Text>
  );
}

export function ConfirmNote({ children }: { children: ReactNode }) {
  const palette = usePalette();
  return <Text style={[styles.note, { color: palette.textSecondary }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space.md,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  panel: {
    width: "100%",
    maxWidth: 352,
    padding: space.md,
    borderWidth: 1,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  title: {
    fontSize: text.md,
    fontWeight: "600",
  },
  body: {
    marginTop: space.xs,
    gap: space["2xs"],
  },
  task: {
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    fontSize: text.sm,
    lineHeight: text.sm * 1.5,
    borderRadius: 8,
    overflow: "hidden",
  },
  note: {
    fontSize: text.sm,
    lineHeight: text.sm * 1.5,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: space.xs,
    marginTop: space.md,
  },
  button: {
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    borderWidth: 1,
    borderRadius: 8,
  },
  buttonText: {
    fontSize: text.sm,
    fontWeight: "600",
  },
});
