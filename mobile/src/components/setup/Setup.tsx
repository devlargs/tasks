import { useState } from "react";
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path, Rect } from "react-native-svg";
import { connection } from "../../lib/api";
import type { KeyValueStore } from "../../lib/localBackend";
import { readLocalTasks, writeLocalTasks } from "../../lib/localBackend";
import { MAX_IMPORT_BATCH } from "../../lib/tasksLogic";
import { mix, space, text, usePalette, type Palette } from "../theme";

// Where this device keeps its tasks. First run asks: a Notion database the
// person owns, or this phone. Later, a device keeping tasks locally comes back
// here (straight to the form) to connect Notion, and its tasks are copied into
// the database on the way.

interface SetupProps {
  // "welcome" offers both choices; "connect" opens on the Notion form
  start: "welcome" | "connect";
  store: KeyValueStore;
  onChooseLocal: () => void;
  onConnected: (databaseUrl: string | null) => void;
  // Back out of the form: to the choices on first run, to the list otherwise
  onCancel: () => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "copying"; done: number; total: number }
  // `copy`: connected, but some of the device's tasks didn't make it across
  | { kind: "error"; message: string; copy?: boolean };

const pluralTasks = (n: number) => `${n} ${n === 1 ? "task" : "tasks"}`;

// The checklist mark: the Todo service icon (public/favicon.svg on the web)
function AppMark() {
  return (
    <Svg width={36} height={36} viewBox="0 0 64 64">
      <Rect x={10} y={7} width={44} height={50} rx={7} fill="#f2f2f7" />
      <Rect x={22} y={3} width={20} height={9} rx={4.5} fill="#9ca0b0" />
      <Path
        d="M17 22.5l3.6 3.6L27 19.5"
        stroke="#40a02b"
        strokeWidth={3.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Rect x={31} y={21} width={16} height={3.4} rx={1.7} fill="#9ca0b0" />
      <Path
        d="M17 35.5l3.6 3.6L27 32.5"
        stroke="#40a02b"
        strokeWidth={3.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Rect x={31} y={34} width={16} height={3.4} rx={1.7} fill="#9ca0b0" />
      <Rect x={16.5} y={45} width={8} height={8} rx={2.5} fill="none" stroke="#4c4f69" strokeWidth={3} />
      <Rect x={31} y={47} width={16} height={3.4} rx={1.7} fill="#4c4f69" />
    </Svg>
  );
}

function Field({
  label,
  palette,
  invalid,
  ...input
}: {
  label: string;
  palette: Palette;
  invalid: boolean;
} & React.ComponentProps<typeof TextInput>) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: palette.textSecondary }]}>{label}</Text>
      <TextInput
        {...input}
        accessibilityLabel={label}
        placeholderTextColor={palette.textMuted}
        autoComplete="off"
        autoCorrect={false}
        autoCapitalize="none"
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          styles.input,
          {
            color: palette.textPrimary,
            backgroundColor: mix(palette.panel, 70, palette.surface),
            borderColor: invalid
              ? palette.danger
              : focused
                ? palette.accent
                : mix(palette.border, 80),
          },
        ]}
      />
    </View>
  );
}

export default function Setup({ start, store, onChooseLocal, onConnected, onCancel }: SetupProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<"choose" | "form">(start === "welcome" ? "choose" : "form");
  const [apiKey, setApiKey] = useState("");
  const [database, setDatabase] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [localCount, setLocalCount] = useState(() => readLocalTasks(store).length);
  const [helpOpen, setHelpOpen] = useState(false);

  const busy = status.kind === "checking" || status.kind === "copying";

  // Copies what's on the device into the database a batch at a time, dropping
  // each task locally only once Notion has it — so a failure part-way leaves
  // exactly the uncopied ones, and trying again doesn't duplicate anything.
  const copyLocalTasks = async (): Promise<string | null> => {
    const total = readLocalTasks(store).length;
    let done = 0;
    for (;;) {
      const remaining = readLocalTasks(store);
      if (remaining.length === 0) return null;
      setStatus({ kind: "copying", done, total });
      const res = await connection.importTasks(remaining.slice(0, MAX_IMPORT_BATCH));
      const imported = new Set(res.imported ?? []);
      if (imported.size > 0) {
        writeLocalTasks(
          store,
          readLocalTasks(store).filter((t) => !imported.has(t.id)),
        );
        done += imported.size;
        setLocalCount(total - done);
      }
      if (!res.ok) {
        return `Copied ${done} of ${pluralTasks(total)}. ${res.error} Try again to copy the rest.`;
      }
    }
  };

  const submit = async () => {
    if (busy || !apiKey.trim() || !database.trim()) return;
    setStatus({ kind: "checking" });
    const res = await connection.connect(apiKey, database);
    if (!res.ok) {
      setStatus({ kind: "error", message: res.error });
      return;
    }
    const copyError = await copyLocalTasks();
    if (copyError) {
      setStatus({ kind: "error", message: copyError, copy: true });
      return;
    }
    onConnected(res.databaseUrl);
  };

  const submitLabel =
    status.kind === "checking"
      ? "Checking…"
      : status.kind === "copying"
        ? `Copying ${status.done} of ${status.total}…`
        : status.kind === "error" && status.copy
          ? "Try again"
          : "Connect";

  // A connect failure is about what was typed; a copy failure isn't
  const fieldsInvalid = status.kind === "error" && !status.copy;
  const canSubmit = !busy && apiKey.trim().length > 0 && database.trim().length > 0;

  const link = (url: string, label: string) => (
    <Text
      style={[styles.link, { color: palette.accent }]}
      onPress={() => void Linking.openURL(url)}
      accessibilityRole="link"
    >
      {label}
    </Text>
  );
  const strong = (value: string) => (
    <Text style={[styles.strong, { color: palette.textPrimary }]}>{value}</Text>
  );

  return (
    <KeyboardAvoidingView
      style={[styles.page, { backgroundColor: palette.surface }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop: insets.top + space.xl,
            paddingBottom: Math.max(space.xl, insets.bottom + space.md),
          },
        ]}
      >
        <View style={styles.inner}>
          <View style={styles.head}>
            <AppMark />
            <Text style={[styles.title, { color: palette.textPrimary }]} accessibilityRole="header">
              Tasks
            </Text>
            <Text style={[styles.lede, { color: palette.textSecondary }]}>
              A list for today that carries unfinished work forward.
              {view === "choose" ? " Where should it keep your tasks?" : ""}
            </Text>
          </View>

          {view === "choose" ? (
            <View style={styles.options}>
              <Option
                palette={palette}
                title="Sync with Notion"
                body="Tasks live in a Notion database you own, and show up on every device you connect to it."
                onPress={() => setView("form")}
              />
              <Option
                palette={palette}
                title="Keep them on this device"
                body="Nothing to set up and nothing leaves this phone. You can connect Notion later from the settings menu."
                onPress={onChooseLocal}
              />
            </View>
          ) : (
            <View style={styles.form}>
              <Text style={[styles.formTitle, { color: palette.textPrimary }]}>
                Connect a Notion database
              </Text>

              <Field
                label="Integration secret"
                palette={palette}
                invalid={fieldsInvalid}
                value={apiKey}
                onChangeText={setApiKey}
                secureTextEntry
                autoFocus
                placeholder="ntn_…"
                returnKeyType="next"
                textContentType="password"
              />

              <Field
                label="Database link or ID"
                palette={palette}
                invalid={fieldsInvalid}
                value={database}
                onChangeText={setDatabase}
                keyboardType="url"
                placeholder="https://www.notion.so/…"
                returnKeyType="go"
                onSubmitEditing={() => void submit()}
              />

              <View>
                <Pressable
                  onPress={() => setHelpOpen((v) => !v)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: helpOpen }}
                  hitSlop={8}
                  style={styles.summary}
                >
                  <Text style={[styles.help, { color: palette.accent }]}>
                    {helpOpen ? "▾" : "▸"} Where do I find these?
                  </Text>
                </Pressable>
                {helpOpen && (
                  <View style={styles.steps}>
                    {[
                      <>
                        Create an integration at{" "}
                        {link(
                          "https://www.notion.so/profile/integrations",
                          "notion.so/profile/integrations",
                        )}{" "}
                        and copy its {strong("Internal Integration Secret")}.
                      </>,
                      <>
                        Open the database in Notion, choose {strong("•••")} ›{" "}
                        {strong("Connections")}, and add the integration.
                      </>,
                      <>
                        Choose {strong("Share")} › {strong("Copy link")} and paste the link here.
                        Any database works — the columns tasks need are added for you.
                      </>,
                    ].map((step, i) => (
                      <View key={i} style={styles.step}>
                        <Text style={[styles.help, { color: palette.textSecondary }]}>
                          {i + 1}.
                        </Text>
                        <Text style={[styles.help, styles.stepText, { color: palette.textSecondary }]}>
                          {step}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              <Text style={[styles.note, { color: palette.textSecondary }]}>
                {localCount > 0 &&
                  `The ${pluralTasks(localCount)} on this device will be copied into the database. `}
                The secret is kept in this phone&apos;s secure storage and is only used to reach
                Notion.
              </Text>

              {/* One line reserved, so an error doesn't push the buttons down */}
              <Text
                style={[styles.message, { color: palette.danger }]}
                accessibilityLiveRegion="polite"
                accessibilityRole={status.kind === "error" ? "alert" : undefined}
              >
                {status.kind === "error" ? status.message : ""}
              </Text>

              <View style={styles.actions}>
                <Pressable
                  onPress={() => void submit()}
                  disabled={!canSubmit}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canSubmit, busy }}
                  style={({ pressed }) => [
                    styles.button,
                    styles.primary,
                    { backgroundColor: palette.accent, borderColor: palette.accent },
                    !canSubmit && { opacity: busy ? 0.8 : 0.5 },
                    pressed && { transform: [{ translateY: 1 }] },
                  ]}
                >
                  <Text
                    style={[styles.buttonText, { color: palette.surface }]}
                    numberOfLines={1}
                  >
                    {submitLabel}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setStatus({ kind: "idle" });
                    if (start === "welcome") setView("choose");
                    else onCancel();
                  }}
                  disabled={busy}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.button,
                    { borderColor: mix(palette.border, 90) },
                    busy && { opacity: 0.5 },
                    pressed && { backgroundColor: palette.sidebarHover },
                  ]}
                >
                  <Text style={[styles.buttonText, { color: palette.textPrimary }]}>Back</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Option({
  palette,
  title,
  body,
  onPress,
}: {
  palette: Palette;
  title: string;
  body: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.option,
        pressed
          ? {
              backgroundColor: mix(palette.panel, 70, palette.surface),
              borderColor: mix(palette.accent, 40, palette.border),
              transform: [{ translateY: 1 }],
            }
          : {
              backgroundColor: mix(palette.panel, 45, palette.surface),
              borderColor: mix(palette.border, 80),
            },
      ]}
    >
      <Text style={[styles.optionTitle, { color: palette.textPrimary }]}>{title}</Text>
      <Text style={[styles.optionBody, { color: palette.textSecondary }]}>{body}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    alignItems: "center",
    paddingHorizontal: space.md,
  },
  inner: {
    width: "100%",
    maxWidth: 416,
    gap: space.lg,
  },
  head: {
    gap: space.xs,
  },
  title: {
    marginTop: space.xs,
    fontSize: text.displayS,
    fontWeight: "200",
    letterSpacing: -0.7,
    lineHeight: text.displayS * 1.1,
  },
  lede: {
    fontSize: text.md,
    lineHeight: text.md * 1.5,
  },
  options: {
    gap: space.sm,
  },
  option: {
    gap: space["2xs"],
    padding: space.md,
    borderWidth: 1,
    borderRadius: 10,
  },
  optionTitle: {
    fontSize: text.lg,
    fontWeight: "600",
  },
  optionBody: {
    fontSize: text.sm,
    lineHeight: text.sm * 1.5,
  },
  form: {
    gap: space.md,
  },
  formTitle: {
    fontSize: text.lg,
    fontWeight: "600",
  },
  field: {
    gap: space["2xs"],
  },
  label: {
    fontSize: text.sm,
    fontWeight: "600",
  },
  input: {
    height: 44,
    paddingHorizontal: space.sm,
    fontSize: 16,
    borderWidth: 1,
    borderRadius: 8,
  },
  summary: {
    alignSelf: "flex-start",
  },
  help: {
    fontSize: text.sm,
    lineHeight: text.sm * 1.55,
  },
  steps: {
    marginTop: space.xs,
    gap: space.xs,
  },
  step: {
    flexDirection: "row",
    gap: space.xs,
  },
  stepText: {
    flex: 1,
  },
  strong: {
    fontWeight: "600",
  },
  link: {
    textDecorationLine: "underline",
  },
  note: {
    fontSize: text.xs,
    lineHeight: text.xs * 1.55,
  },
  message: {
    minHeight: text.sm * 1.5,
    fontSize: text.sm,
    lineHeight: text.sm * 1.5,
  },
  actions: {
    flexDirection: "row",
    gap: space.sm,
  },
  button: {
    height: 44,
    paddingHorizontal: space.lg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 8,
  },
  primary: {
    flex: 1,
    minWidth: 0,
  },
  buttonText: {
    fontSize: text.md,
    fontWeight: "600",
  },
});
