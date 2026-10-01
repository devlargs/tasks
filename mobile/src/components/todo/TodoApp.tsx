import { randomUUID } from "expo-crypto";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AppState,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutRectangle,
} from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type EntryAnimationsValues,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { TaskBackend } from "../../lib/api";
import { deviceStore } from "../../lib/storage";
import { changeStatus, restoreTask } from "../../lib/tasksLogic";
import { carryTrackingSince, pickupTrackingSince } from "../../lib/tracking";
import type { TaskStatus, TodoTask } from "../../lib/types";
import Icon from "../Icon";
import { duration, figure, mix, space, text, usePalette, type Palette } from "../theme";
import { ChromeButton, Pill } from "./Chrome";
import ConfirmDialog, { ConfirmNote, ConfirmTask } from "./ConfirmDialog";
import { dissolveDurationMs } from "./dissolve";
import { matchesSearch, searchTerms } from "./search";
import TaskRow from "./TaskRow";
import ThemeSwitch from "./ThemeSwitch";
import TodoCalendar from "./TodoCalendar";
import TodoStats from "./TodoStats";
import {
  deviceZone,
  formatDayLabel,
  formatFullDate,
  nowIso,
  shiftDateKey,
  todayKey,
} from "./dates";

// The daily list. Tasks live in the device's Notion database or on the device
// itself (see TaskBackend); either way every change is applied on screen first
// (optimistically) and the write follows. A failed write says so and re-reads
// the day, so the list never keeps showing something that wasn't saved.

interface TodoAppProps {
  api: TaskBackend;
  mode: "notion" | "local";
  // The connected database's page on notion.so, for the settings menu
  databaseUrl: string | null;
  onConnectNotion: () => void;
  onDisconnectNotion: () => void;
}

// Days read before, keyed by date. A day you've seen renders from here at once;
// it's only re-read from Notion when its copy is older than the TTL (the
// Refresh button and an app start bypass that). Kept in the device's store, so
// a restart shows the last known list straight away while the fresh read runs.
const CACHE_TTL_MS = 30_000;
const CACHE_STORAGE_KEY = "tasks:dayCache:v1";
// Only the most recently read days are kept, so storage doesn't grow forever
const CACHE_MAX_DAYS = 60;

type CachedDay = { tasks: TodoTask[]; at: number };

// Every cached task goes through restoreTask, as stored ones do: a copy from
// before In Progress existed has no status, and must land in the right section
// (and show no clock) from the first frame, not after the fresh read.
function restoreCache(): Map<string, CachedDay> {
  try {
    const raw = deviceStore.getItem(CACHE_STORAGE_KEY);
    const entries = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(entries)) return new Map();
    const days = new Map<string, CachedDay>();
    for (const entry of entries as unknown[]) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
      const cached = entry[1] as Partial<CachedDay> | null;
      if (!cached || !Array.isArray(cached.tasks) || typeof cached.at !== "number") continue;
      const tasks = cached.tasks.map(restoreTask).filter((t): t is TodoTask => t !== null);
      days.set(entry[0], { tasks, at: cached.at });
    }
    return days;
  } catch {
    return new Map();
  }
}

const dayCache = restoreCache();

// Switching between Notion and the device changes whose tasks the cached days
// are, so they're dropped rather than shown for a moment under the other one.
export function resetDayCache(): void {
  dayCache.clear();
  deviceStore.removeItem(CACHE_STORAGE_KEY);
}

function persistCache(): void {
  try {
    const entries = [...dayCache]
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, CACHE_MAX_DAYS)
      // A row still waiting on its create isn't in Notion yet; after a restart
      // it would never get its page id
      .map(([day, { tasks, at }]): [string, CachedDay] => [
        day,
        { tasks: tasks.filter((t) => !t.id.startsWith(TEMP_PREFIX)), at },
      ]);
    deviceStore.setItem(CACHE_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Full or blocked storage just means no instant list next time
  }
}

// Created on screen, not yet in Notion — the row needs a key before the page id
// comes back.
const TEMP_PREFIX = "temp-";

const byOrder = (tasks: TodoTask[]): TodoTask[] => [...tasks].sort((a, b) => a.order - b.order);

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// The three sections, each under a heading that opens and closes it
const SECTION_LABEL: Record<TaskStatus, string> = {
  inProgress: "In Progress",
  todo: "Todo",
  done: "Done tasks",
};

const ALL_SECTIONS_OPEN: Record<TaskStatus, boolean> = { inProgress: true, todo: true, done: true };

// Which way the checkbox moves a task
const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  todo: "inProgress",
  inProgress: "done",
  done: "inProgress",
};

// Near the top or bottom of the list, a drag scrolls it along
const DRAG_SCROLL_EDGE = 48;
const DRAG_SCROLL_STEP = 12;

const easeOut = Easing.bezier(0.16, 1, 0.3, 1);

// Rows that move (a task picked up and rising into In Progress, one put back,
// neighbours closing a gap) slide from where they were instead of jumping.
const rowLayout = LinearTransition.duration(260).easing(easeOut);
// A new or carried-over row grows in; a row leaving fades as the gap closes
const rowEntering = FadeIn.duration(duration.short);
const rowExiting = FadeOut.duration(200);

// Day switch: the list slides in from the direction of travel
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

export default function TodoApp({
  api,
  mode,
  databaseUrl,
  onConnectNotion,
  onDisconnectNotion,
}: TodoAppProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const [date, setDate] = useState(todayKey);
  // Direction of the last day change, so the list can slide the right way
  const [slide, setSlide] = useState<"next" | "prev" | null>(null);
  // The month grid and the statistics replace the whole list page while open
  const [view, setView] = useState<"list" | "calendar" | "stats">("list");
  // Whatever was cached for today shows at once; the fresh read replaces it
  const [tasks, setTasks] = useState<TodoTask[]>(() => dayCache.get(todayKey())?.tasks ?? []);
  const [loaded, setLoaded] = useState(() => dayCache.has(todayKey()));
  // Requests still on their way to Notion; drives the sync pill
  const [inFlight, setInFlight] = useState(0);
  // Reads under way, so a background refresh of a cached list shows as syncing
  const [reading, setReading] = useState(0);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [enteringIds, setEnteringIds] = useState<string[]>([]);
  // The task whose label is mid-dissolve; it stays in the open list until the
  // letters have gone, so the row doesn't vanish out from under the animation.
  const [dissolvingId, setDissolvingId] = useState<string | null>(null);
  // Which sections are open. In Progress and Todo start open; Done starts
  // closed, since finished work is filed away rather than read past.
  const [sectionsOpen, setSectionsOpen] = useState<Record<TaskStatus, boolean>>({
    inProgress: true,
    todo: true,
    done: false,
  });
  // The search field is tucked away until asked for; the query outlives a day
  // change, so the same search can be run down the days
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  // During a search every section shows open, so no match hides behind a
  // closed one — without touching the list's own state. A new query opens
  // them all again.
  const [searchSectionsOpen, setSearchSectionsOpen] = useState(ALL_SECTIONS_OPEN);
  // The section just opened by hand, whose rows ease in as they appear
  const [revealed, setRevealed] = useState<TaskStatus | null>(null);
  // Finishing and deleting a task each ask first — both are one stray tap
  // from the row's other buttons
  const [confirming, setConfirming] = useState<{
    action: "done" | "delete";
    task: TodoTask;
  } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const composerRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const settingsRef = useRef<View>(null);
  // The day on screen, for callbacks that finish after a navigation. Moved
  // along by goToDay, the only place the date changes.
  const dateRef = useRef(date);
  // Temp id -> the page id Notion gave it, once the create has landed
  const createdIds = useRef(new Map<string, Promise<string | null>>());
  // Page id -> the temp id its row was first keyed by, so swapping in the real
  // id doesn't remount the row (and replay its enter and exit)
  const [rowKeys, setRowKeys] = useState<ReadonlyMap<string, string>>(() => new Map());
  // Bumped by every write. A read that started before a write finished may not
  // include it, so its answer is dropped and the day re-read once writes settle.
  const writeEpoch = useRef(0);
  const inFlightRef = useRef(0);
  const reloadWanted = useRef(false);

  const ordered = useMemo(() => byOrder(tasks), [tasks]);
  const progressTasks = useMemo(() => ordered.filter((t) => t.status === "inProgress"), [ordered]);
  const todoTasks = useMemo(() => ordered.filter((t) => t.status === "todo"), [ordered]);
  const doneTasks = useMemo(() => ordered.filter((t) => t.status === "done"), [ordered]);
  const doneCount = doneTasks.length;
  const openCount = progressTasks.length + todoTasks.length;
  const progress = ordered.length === 0 ? 0 : doneCount / ordered.length;
  const started = ordered.length === 0 ? 0 : progressTasks.length / ordered.length;

  // What the list shows. The full sections above still drive the counts, the
  // progress bar and reordering; these only decide which rows are on screen.
  const terms = useMemo(() => searchTerms(query), [query]);
  const filtering = terms.length > 0;
  const shownProgress = useMemo(
    () => progressTasks.filter((t) => matchesSearch(t.text, terms)),
    [progressTasks, terms],
  );
  const shownTodo = useMemo(
    () => todoTasks.filter((t) => matchesSearch(t.text, terms)),
    [todoTasks, terms],
  );
  const shownDone = useMemo(
    () => doneTasks.filter((t) => matchesSearch(t.text, terms)),
    [doneTasks, terms],
  );
  const shownCount = shownProgress.length + shownTodo.length + shownDone.length;
  const sections = filtering ? searchSectionsOpen : sectionsOpen;

  const toggleSection = (section: TaskStatus) => {
    const open = !sections[section];
    (filtering ? setSearchSectionsOpen : setSectionsOpen)((current) => ({
      ...current,
      [section]: open,
    }));
    setRevealed(open ? section : null);
  };

  // A task that lands in a closed section opens it rather than vanishing: one
  // just started, put back, or added
  const openSection = useCallback((section: TaskStatus) => {
    const opened = (current: Record<TaskStatus, boolean>) =>
      current[section] ? current : { ...current, [section]: true };
    setSectionsOpen(opened);
    setSearchSectionsOpen(opened);
  }, []);

  const changeQuery = (next: string) => {
    setQuery(next);
    setSearchSectionsOpen(ALL_SECTIONS_OPEN);
  };

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery("");
  }, []);

  // Pickups and time are recorded from the first day this device runs a
  // version that records them; the Progress view needs to know which day that
  // was, even if it's opened weeks later.
  useEffect(() => {
    carryTrackingSince(todayKey());
    pickupTrackingSince(todayKey());
  }, []);

  // --- loading ---------------------------------------------------------------

  const loadDay = useCallback(
    async (targetDate: string, manual = false) => {
      if (manual) setRefreshing(true);
      const epoch = writeEpoch.current;
      setReading((n) => n + 1);
      const res = await api.list(targetDate);
      setReading((n) => n - 1);
      if (manual) setRefreshing(false);
      if (dateRef.current !== targetDate) return; // navigated away meanwhile
      if (epoch !== writeEpoch.current || inFlightRef.current > 0) {
        reloadWanted.current = true;
        return;
      }
      setLoaded(true);
      if (res.ok) {
        setTasks(res.tasks);
        dayCache.set(targetDate, { tasks: res.tasks, at: Date.now() });
        persistCache();
        // Anything just carried over from an earlier day grows in, so a list
        // that gained tasks on its own explains itself.
        if (res.carried.length) setEnteringIds(res.carried);
        if (manual) setError(null);
      } else {
        setError(res.error);
      }
    },
    [api],
  );

  const loadIfStale = useCallback(
    (targetDate: string) => {
      const cached = dayCache.get(targetDate);
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) return;
      void loadDay(targetDate);
    },
    [loadDay],
  );

  const goToDay = useCallback((next: string, direction: "next" | "prev") => {
    dateRef.current = next;
    setSlide(direction);
    setDate(next);
    setError(null);
    const cached = dayCache.get(next);
    setTasks(cached?.tasks ?? []);
    setLoaded(!!cached);
  }, []);

  // An app start always asks Notion, however fresh the stored copy looks — the
  // cache is there to show something while that read runs, not to skip it.
  // Day changes after that only re-read a stale day.
  const firstLoad = useRef(true);
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      void loadDay(date);
    } else {
      loadIfStale(date);
    }
  }, [date, loadDay, loadIfStale]);

  // Local edits keep the cached copy current, so coming back to a day shows
  // them — without resetting its age, which only a real read does.
  useEffect(() => {
    const cached = dayCache.get(dateRef.current);
    if (cached && cached.tasks !== tasks) {
      cached.tasks = tasks;
      persistCache();
    }
  }, [tasks]);

  // A phone app sits in the background for hours; coming back to it should
  // show what the other devices did in the meantime.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") loadIfStale(dateRef.current);
    });
    return () => subscription.remove();
  }, [loadIfStale]);

  // Left open overnight the app would still be showing the old day under the
  // heading "Today". Once the date turns, the view follows it — which is what
  // brings the unfinished tasks across as well. Only a view that was sitting
  // on "today" moves; a day you navigated to deliberately stays put.
  const lastTodayRef = useRef(todayKey());
  useEffect(() => {
    const timer = setInterval(() => {
      const today = todayKey();
      const previous = lastTodayRef.current;
      if (today === previous) return;
      lastTodayRef.current = today;
      if (dateRef.current === previous) goToDay(today, "next");
    }, 60_000);
    return () => clearInterval(timer);
  }, [goToDay]);

  // --- writes ----------------------------------------------------------------

  // Every write goes through here: it counts toward the sync pill, and a
  // failure re-reads the day so the optimistic edit doesn't linger.
  const write = useCallback(
    async <T extends { ok: boolean; error?: string }>(request: () => Promise<T>) => {
      writeEpoch.current++;
      inFlightRef.current++;
      setInFlight(inFlightRef.current);
      const res = await request();
      writeEpoch.current++;
      inFlightRef.current--;
      setInFlight(inFlightRef.current);
      if (!res.ok) {
        setError(res.error ?? "Couldn't save that change.");
        reloadWanted.current = true;
      }
      if (inFlightRef.current === 0 && reloadWanted.current) {
        reloadWanted.current = false;
        void loadDay(dateRef.current);
      }
      return res;
    },
    [loadDay],
  );

  // A task typed a moment ago may still be on its way to Notion; anything done
  // to it waits for its real id. Null when the create failed.
  const resolveId = useCallback(async (id: string) => {
    if (!id.startsWith(TEMP_PREFIX)) return id;
    return (await createdIds.current.get(id)) ?? null;
  }, []);

  const withId = useCallback(
    <T extends { ok: boolean; error?: string }>(id: string, run: (realId: string) => Promise<T>) =>
      write(async () => {
        const realId = await resolveId(id);
        if (!realId) return { ok: false, error: "That task was never saved." } as T;
        return run(realId);
      }),
    [write, resolveId],
  );

  // Swap in Notion's copy of a task, unless it has left the day on screen.
  const applyTask = useCallback((localId: string, task: TodoTask) => {
    setTasks((current) =>
      task.date === dateRef.current
        ? current.map((t) => (t.id === localId || t.id === task.id ? task : t))
        : current.filter((t) => t.id !== localId && t.id !== task.id),
    );
  }, []);

  const handleCreate = useCallback(() => {
    const text = draft.replace(/\s+/g, " ").trim();
    if (!text) return;
    setDraft("");
    setError(null);
    const tempId = `${TEMP_PREFIX}${randomUUID()}`;
    const targetDate = date;
    // Newest first, matching the order the backend will store
    const order = tasks.length === 0 ? 0 : Math.min(...tasks.map((t) => t.order)) - 1;
    const optimistic: TodoTask = {
      id: tempId,
      text,
      status: "todo",
      done: false,
      date: targetDate,
      order,
      editedAt: new Date().toISOString(),
    };
    setTasks((current) => [...current, optimistic]);
    setEnteringIds((ids) => [...ids, tempId]);
    openSection("todo");

    let settle: (id: string | null) => void = () => undefined;
    createdIds.current.set(tempId, new Promise((resolve) => (settle = resolve)));
    void write(() => api.create(targetDate, text)).then((res) => {
      settle(res.ok ? res.task.id : null);
      if (!res.ok) {
        setTasks((current) => current.filter((t) => t.id !== tempId));
        return;
      }
      setRowKeys((keys) => new Map(keys).set(res.task.id, tempId));
      // Keep the edits made while it was in flight (a tick, a rename); only
      // the id and Notion's timestamp are news.
      setTasks((current) =>
        current.map((t) =>
          t.id === tempId ? { ...t, id: res.task.id, editedAt: res.task.editedAt } : t,
        ),
      );
    });
  }, [api, draft, date, tasks, write, openSection]);

  // Todo → In Progress → Done, and back. The clock and the task's place in
  // the day follow the same rules the backends apply (changeStatus), so the
  // row lands where the saved copy will put it.
  const handleStatus = useCallback(
    async (task: TodoTask, status: TaskStatus) => {
      // The write goes out first — the animation is presentation, and a task
      // must never be lost because a frame was dropped.
      const request = withId(task.id, (id) => api.update(id, { status }));
      // Finishing a task dissolves its letters, then the row fades out as the
      // gap closes. Every other change is a move: the row travels to its new
      // section.
      if (status === "done" && !reduce) {
        setDissolvingId(task.id);
        await wait(dissolveDurationMs([...task.text].length));
        setDissolvingId(null);
      }
      if (status !== "done") openSection(status);
      const now = nowIso();
      setTasks((current) => {
        const live = current.find((t) => t.id === task.id);
        if (!live) return current;
        const next = changeStatus(live, status, current, now, deviceZone);
        return current.map((t) => (t.id === task.id ? next : t));
      });
      // A failed write re-reads the day (see write), which puts the row back
      // where it was saved and takes away a clock that never started.
      await request;
    },
    [api, withId, reduce, openSection],
  );

  const handleRename = useCallback(
    async (task: TodoTask, text: string) => {
      setTasks((current) => current.map((t) => (t.id === task.id ? { ...t, text } : t)));
      await withId(task.id, (id) => api.update(id, { text }));
    },
    [api, withId],
  );

  // Moves a task off this day: the row leaves the list and lands at the end of
  // the chosen day, exactly where the overnight carry-over would have put it.
  // Shared by defer (tomorrow) and schedule (a picked day).
  const moveOff = useCallback(
    async (task: TodoTask, toDate: string) => {
      if (toDate === task.date) return;
      const request = withId(task.id, (id) => api.move(id, toDate));
      setTasks((current) => current.filter((t) => t.id !== task.id));
      const res = await request;
      if (res.ok) applyTask(task.id, res.task);
    },
    [api, withId, applyTask],
  );

  const handleDelete = useCallback(
    async (task: TodoTask) => {
      const request = withId(task.id, (id) => api.remove(id));
      setTasks((current) => current.filter((t) => t.id !== task.id));
      await request;
    },
    [api, withId],
  );

  // --- drag to reorder -------------------------------------------------------

  // A drag stays inside its own section: the buttons, not a drop, are how a
  // task changes state.
  const dragState = useRef<{ id: string; section: TaskStatus; target: string | null } | null>(null);
  // Where each open row sits within the list, and where the list sits in the
  // scroll view, so a finger's position can be turned into the row under it
  const rowLayouts = useRef(new Map<string, LayoutRectangle>());
  const listY = useRef(0);
  const scrollY = useRef(0);
  const viewport = useRef({ y: 0, height: 0 });
  const scrollContainer = useRef<View>(null);
  // Which section each row on screen is in, for a drag. Rows in a closed
  // section aren't on screen, so their last positions can't take a drop.
  const sectionOf = useMemo(
    () =>
      new Map(
        [
          ...(sectionsOpen.inProgress ? progressTasks : []),
          ...(sectionsOpen.todo ? todoTasks : []),
        ].map((t) => [t.id, t.status]),
      ),
    [progressTasks, todoTasks, sectionsOpen],
  );

  // Forget rows that have left, so a stale position can't take a drop
  useEffect(() => {
    for (const id of rowLayouts.current.keys()) {
      if (!sectionOf.has(id)) rowLayouts.current.delete(id);
    }
  }, [sectionOf]);


  const finishDrag = useCallback(() => {
    const drag = dragState.current;
    dragState.current = null;
    setDraggingId(null);
    setDropTargetId(null);
    if (!drag?.target || drag.target === drag.id) return;
    const idsOf = (list: TodoTask[]) => list.map((t) => t.id);
    const section = idsOf(drag.section === "inProgress" ? progressTasks : todoTasks);
    if (!section.includes(drag.id) || !section.includes(drag.target)) return;
    // Pull the dragged id out first, then look up the target's index — doing
    // it the other way round is off by one whenever it moves downwards.
    const [moved] = section.splice(section.indexOf(drag.id), 1);
    section.splice(section.indexOf(drag.target), 0, moved);
    // The whole day goes back, In Progress ahead of Todo, so the numbering
    // keeps the sections in that order. Done tasks aren't draggable but still
    // hold positions in the day, so they ride along on the end rather than
    // being dropped from the order.
    const ids =
      drag.section === "inProgress"
        ? [...section, ...idsOf(todoTasks)]
        : [...idsOf(progressTasks), ...section];
    ids.push(...idsOf(doneTasks));
    // Reflect the new order locally so the rows settle before the round trip
    setTasks((current) =>
      current.map((t) => (ids.includes(t.id) ? { ...t, order: ids.indexOf(t.id) } : t)),
    );
    const targetDate = date;
    void write(async () => {
      const realIds = await Promise.all(ids.map(resolveId));
      return api.reorder(
        targetDate,
        realIds.filter((id): id is string => id !== null),
      );
    });
  }, [api, progressTasks, todoTasks, date, doneTasks, write, resolveId]);

  const moveDrag = (absoluteY: number) => {
    const drag = dragState.current;
    if (!drag) return;
    const inViewport = absoluteY - viewport.current.y;
    const y = inViewport + scrollY.current - listY.current;
    for (const [id, box] of rowLayouts.current) {
      // A row in the other section isn't a place this one can go
      if (y >= box.y && y < box.y + box.height && sectionOf.get(id) === drag.section) {
        drag.target = id;
      }
    }
    setDropTargetId(drag.target);
    if (inViewport < DRAG_SCROLL_EDGE) {
      scrollRef.current?.scrollTo({ y: Math.max(0, scrollY.current - DRAG_SCROLL_STEP), animated: false });
    } else if (inViewport > viewport.current.height - DRAG_SCROLL_EDGE) {
      scrollRef.current?.scrollTo({ y: scrollY.current + DRAG_SCROLL_STEP, animated: false });
    }
  };

  // The grip's drag, as the row hands it over: pressed, moved, let go
  const startDrag = (task: TodoTask) => {
    dragState.current = { id: task.id, section: task.status, target: null };
    setDraggingId(task.id);
    scrollContainer.current?.measureInWindow((_, y, __, height) => {
      viewport.current = { y, height };
    });
  };

  const endDrag = (completed: boolean) => {
    if (!completed && dragState.current) dragState.current.target = null;
    finishDrag();
  };

  // --- calendar --------------------------------------------------------------

  if (view === "calendar") {
    return (
      <TodoCalendar
        api={api}
        selectedDate={date}
        onPickDay={(picked) => {
          if (picked !== date) goToDay(picked, picked < date ? "prev" : "next");
          setView("list");
        }}
        onClose={() => setView("list")}
      />
    );
  }

  if (view === "stats") {
    return (
      <TodoStats
        api={api}
        onPickDay={(picked) => {
          if (picked !== date) goToDay(picked, picked < date ? "prev" : "next");
          setView("list");
        }}
        onClose={() => setView("list")}
      />
    );
  }

  // --- list ------------------------------------------------------------------

  // On the device there's nothing to sync with or refresh from
  const syncing = inFlight > 0 || reading > 0;
  const hairline = mix(palette.border, 45);

  // One flat list for both open sections, so a row moving between them is the
  // same view travelling, not a new one appearing. A filtered list can't be
  // reordered: a drop between two matches says nothing about where the hidden
  // rows should go.
  // A closed section keeps its heading, and the heading its count.
  const openItems: ({ head: TaskStatus; count: number } | { task: TodoTask })[] = [];
  for (const [section, shown] of [
    ["inProgress", shownProgress],
    ["todo", shownTodo],
  ] as const) {
    if (shown.length === 0) continue;
    openItems.push({ head: section, count: shown.length });
    if (sections[section]) openItems.push(...shown.map((task) => ({ task })));
  }

  // A section's heading is its toggle: a caret, the name, the count
  const sectionHead = (section: TaskStatus, count: number, first: boolean) => (
    <Animated.View
      key={`head-${section}`}
      layout={rowLayout}
      entering={rowEntering}
      exiting={rowExiting}
      style={
        first
          ? styles.sectionHeadFirst
          : {
              marginTop: space["2xs"],
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: hairline,
            }
      }
    >
      <Pressable
        onPress={() => toggleSection(section)}
        accessibilityRole="button"
        accessibilityState={{ expanded: sections[section] }}
        style={[styles.sectionToggle, first && { paddingTop: 0 }]}
      >
        <Caret open={sections[section]} color={palette.textSecondary} />
        <Text style={[styles.sectionText, { color: palette.textSecondary }]}>
          {SECTION_LABEL[section]}
        </Text>
        <Text style={[styles.count, figure, { color: palette.textMuted }]}>{count}</Text>
      </Pressable>
    </Animated.View>
  );

  const renderRow = (task: TodoTask, reorderable: boolean, divided: boolean, measured: boolean) => {
    const key = rowKeys.get(task.id) ?? task.id;
    return (
      <Animated.View
        key={key}
        layout={rowLayout}
        entering={
          enteringIds.includes(task.id) || revealed === task.status ? rowEntering : undefined
        }
        exiting={rowExiting}
        onLayout={
          measured ? (e) => rowLayouts.current.set(task.id, e.nativeEvent.layout) : undefined
        }
      >
        <TaskRow
          task={task}
          dissolving={dissolvingId === task.id}
          reorderable={reorderable}
          onToggle={() =>
            NEXT_STATUS[task.status] === "done"
              ? setConfirming({ action: "done", task })
              : void handleStatus(task, NEXT_STATUS[task.status])
          }
          onBack={task.status === "inProgress" ? () => void handleStatus(task, "todo") : undefined}
          onRename={(text) => void handleRename(task, text)}
          onDefer={task.done ? undefined : () => void moveOff(task, shiftDateKey(task.date, 1))}
          onSchedule={task.done ? undefined : (toDate) => void moveOff(task, toDate)}
          onDelete={() => setConfirming({ action: "delete", task })}
          onDragStart={() => startDrag(task)}
          onDragMove={moveDrag}
          onDragEnd={endDrag}
          dragging={draggingId === task.id}
          dropTarget={dropTargetId === task.id && draggingId !== task.id}
          divided={divided}
        />
      </Animated.View>
    );
  };

  return (
    <View style={[styles.page, { backgroundColor: palette.surface }]}>
      {/* --- The head. Day, composer, progress — pinned, so adding a task never
          costs a scroll no matter how long the list gets. --- */}
      <View style={[styles.head, { paddingTop: insets.top + space.xs }]}>
        <View style={styles.measure}>
          <View style={styles.header}>
            <View style={styles.titleBlock}>
              <Text style={[styles.day, { color: palette.textPrimary }]} accessibilityRole="header">
                {formatDayLabel(date)}
              </Text>
              <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
                {formatFullDate(date)}
                {ordered.length > 0 && (
                  <>
                    {" · "}
                    <Text style={figure}>
                      {doneCount}/{ordered.length}
                    </Text>{" "}
                    done
                  </>
                )}
              </Text>
            </View>

            <View style={styles.chrome}>
              {date !== todayKey() && (
                <Pill
                  palette={palette}
                  accent
                  onPress={() => goToDay(todayKey(), date < todayKey() ? "next" : "prev")}
                >
                  Today
                </Pill>
              )}
              {mode === "notion" && (
                <SyncPill
                  palette={palette}
                  syncing={syncing}
                  label={
                    inFlight > 0
                      ? "Saving to Notion"
                      : reading > 0
                        ? "Checking Notion for changes"
                        : "Saved to Notion — tap to refresh"
                  }
                  onPress={() => void loadDay(date, true)}
                />
              )}
              <ChromeButton
                icon="chevronLeft"
                size={20}
                label="Previous day"
                palette={palette}
                onPress={() => goToDay(shiftDateKey(date, -1), "prev")}
              />
              <ChromeButton
                icon="chevronRight"
                size={20}
                label="Next day"
                palette={palette}
                onPress={() => goToDay(shiftDateKey(date, 1), "next")}
              />
              <ChromeButton
                icon="search"
                label="Search tasks"
                palette={palette}
                active={searchOpen}
                onPress={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
              />
              <ChromeButton
                icon="calendarMonth"
                label="Calendar"
                palette={palette}
                onPress={() => setView("calendar")}
              />
              <ChromeButton
                icon="insights"
                label="Progress"
                palette={palette}
                onPress={() => setView("stats")}
              />
              {mode === "notion" && (
                <ChromeButton
                  icon="refresh"
                  label="Refresh from Notion"
                  palette={palette}
                  spinning={refreshing}
                  onPress={() => void loadDay(date, true)}
                />
              )}
              <View ref={settingsRef} collapsable={false}>
                <ChromeButton
                  icon="settings"
                  label="Settings"
                  palette={palette}
                  onPress={() => setMenuOpen(true)}
                />
              </View>
            </View>
          </View>

          {/* The composer. First thing under the day, before the list, so a new
              task is always one tap away. */}
          <View
            style={[
              styles.composer,
              {
                backgroundColor: mix(palette.panel, 70, palette.surface),
                borderColor: mix(palette.border, 55),
              },
            ]}
          >
            <Icon name="add" size={18} color={palette.textMuted} />
            <TextInput
              ref={composerRef}
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={handleCreate}
              // Stays open for the next task, like the web's composer
              submitBehavior="submit"
              placeholder={ordered.length === 0 ? "What needs doing today?" : "Add a task"}
              placeholderTextColor={palette.textMuted}
              accessibilityLabel="Add a task"
              returnKeyType="done"
              maxLength={500}
              style={[styles.composerInput, { color: palette.textPrimary }]}
            />
            <Pressable
              onPress={handleCreate}
              disabled={draft.trim().length === 0}
              accessibilityRole="button"
              accessibilityLabel="Add task"
              style={({ pressed }) => [
                styles.addButton,
                { backgroundColor: palette.accent },
                draft.trim().length === 0 && { opacity: 0.35 },
                pressed && { transform: [{ translateY: 0.5 }] },
              ]}
            >
              <Text style={[styles.addText, { color: palette.surface }]}>Add</Text>
            </Pressable>
          </View>

          {searchOpen && (
            <View style={[styles.search, { borderColor: mix(palette.border, 55) }]}>
              <Icon name="search" size={16} color={palette.textMuted} />
              <TextInput
                value={query}
                onChangeText={changeQuery}
                autoFocus
                placeholder="Search this day's tasks"
                placeholderTextColor={palette.textMuted}
                accessibilityLabel="Search tasks"
                returnKeyType="search"
                autoCorrect={false}
                style={[styles.searchInput, { color: palette.textPrimary }]}
              />
              {filtering && (
                <Text
                  style={[styles.searchCount, figure, { color: palette.textMuted }]}
                  accessibilityLiveRegion="polite"
                >
                  {shownCount} of {ordered.length}
                </Text>
              )}
              <ChromeButton
                icon="close"
                size={14}
                label="Close search"
                palette={palette}
                onPress={closeSearch}
                small
              />
            </View>
          )}
        </View>

        {/* The head's bottom edge doubles as the day's progress: done in full
            accent, and what's in progress after it in a tint, so the bar moves
            the moment something is picked up. */}
        <ProgressTrack palette={palette} done={progress} started={started} />
      </View>

      {/* --- The list. Scrolls under the head. --- */}
      <View ref={scrollContainer} style={styles.scrollContainer} collapsable={false}>
        <ScrollView
          ref={scrollRef}
          scrollEnabled={draggingId === null}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onScroll={(e) => {
            scrollY.current = e.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Math.max(space["2xl"], insets.bottom) },
          ]}
        >
          {error && (
            <View
              style={[
                styles.measure,
                styles.error,
                {
                  borderColor: mix(palette.danger, 35),
                  backgroundColor: mix(palette.danger, 7),
                },
              ]}
            >
              <Text style={[styles.errorText, { color: palette.danger }]}>{error}</Text>
              <Pressable onPress={() => setError(null)} accessibilityRole="button" hitSlop={8}>
                <Text style={[styles.dismiss, { color: palette.textPrimary }]}>Dismiss</Text>
              </Pressable>
            </View>
          )}

          <Animated.View
            key={date}
            entering={slide === "next" ? slideNext : slide === "prev" ? slidePrev : undefined}
            style={styles.measure}
            onLayout={(e) => {
              listY.current = e.nativeEvent.layout.y;
            }}
          >
            {openItems.map((item, i) => {
              if ("head" in item) return sectionHead(item.head, item.count, i === 0);
              const previous = openItems[i - 1];
              return renderRow(item.task, !filtering, !!previous && "task" in previous, true);
            })}

            {filtering && shownCount === 0 && (
              <Text style={[styles.empty, { color: palette.textMuted }]}>
                No tasks match “{query.trim()}”.
              </Text>
            )}

            {!filtering && openCount === 0 && (
              <Text style={[styles.empty, { color: palette.textMuted }]}>
                {!loaded
                  ? "Loading…"
                  : ordered.length === 0
                    ? "Nothing on the list."
                    : "Everything's done."}
              </Text>
            )}

            {/* Finished work is filed, not crossed out — a struck-through label
                is still a full row of text to read past. */}
            {shownDone.length > 0 && (
              <Animated.View layout={rowLayout}>
                {sectionHead("done", shownDone.length, false)}
                {sections.done && (
                  <Animated.View entering={FadeIn.duration(duration.short)}>
                    {shownDone.map((task, i) => renderRow(task, false, i > 0, false))}
                  </Animated.View>
                )}
              </Animated.View>
            )}
          </Animated.View>
        </ScrollView>
      </View>

      {menuOpen && (
        <SettingsMenu
          anchor={settingsRef}
          palette={palette}
          onClose={() => setMenuOpen(false)}
          items={[
            ...(mode === "notion" && databaseUrl
              ? [
                  {
                    label: "View database in Notion",
                    onPress: () => void Linking.openURL(databaseUrl),
                  },
                ]
              : []),
            {
              label: mode === "notion" ? "Disconnect Notion" : "Connect Notion…",
              onPress: mode === "notion" ? onDisconnectNotion : onConnectNotion,
            },
          ]}
        />
      )}

      {confirming && (
        <ConfirmDialog
          title={confirming.action === "done" ? "Mark this task as done?" : "Delete this task?"}
          confirmLabel={confirming.action === "done" ? "Mark as done" : "Delete"}
          destructive={confirming.action === "delete"}
          onConfirm={() => {
            const { action, task } = confirming;
            setConfirming(null);
            if (action === "done") void handleStatus(task, "done");
            else void handleDelete(task);
          }}
          onCancel={() => setConfirming(null)}
        >
          <ConfirmTask>{confirming.task.text}</ConfirmTask>
          {confirming.action === "delete" && (
            <ConfirmNote>
              {mode === "notion"
                ? "Its page goes to the trash in Notion."
                : "This can't be undone."}
            </ConfirmNote>
          )}
        </ConfirmDialog>
      )}
    </View>
  );
}

// --- Chrome ------------------------------------------------------------------

function SyncPill({
  palette,
  syncing,
  label,
  onPress,
}: {
  palette: Palette;
  syncing: boolean;
  label: string;
  onPress: () => void;
}) {
  const reduce = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (syncing && !reduce) {
      pulse.set(withRepeat(
        withSequence(withTiming(0.4, { duration: 700 }), withTiming(1, { duration: 700 })),
        -1,
      ));
    } else {
      pulse.set(withTiming(1, { duration: duration.micro }));
    }
  }, [syncing, reduce, pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.get() }));
  return (
    <Animated.View style={style}>
      <Pill palette={palette} onPress={onPress} label={label}>
        {syncing ? "Syncing" : "Synced"}
      </Pill>
    </Animated.View>
  );
}

function ProgressTrack({
  palette,
  done,
  started,
}: {
  palette: Palette;
  done: number;
  started: number;
}) {
  const [width, setWidth] = useState(0);
  const reduce = useReducedMotion();
  const doneWidth = useSharedValue(0);
  const startedWidth = useSharedValue(0);
  useEffect(() => {
    const to = (value: number) =>
      reduce ? value : withTiming(value, { duration: duration.long, easing: easeOut });
    doneWidth.set(to(done * width));
    startedWidth.set(to(started * width));
  }, [done, started, width, reduce, doneWidth, startedWidth]);
  const doneStyle = useAnimatedStyle(() => ({ width: doneWidth.get() }));
  const startedStyle = useAnimatedStyle(() => ({ width: startedWidth.get() }));
  return (
    <View
      style={[styles.track, { backgroundColor: mix(palette.border, 55) }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(done * 100) }}
    >
      <Animated.View
        style={[
          styles.trackFill,
          { backgroundColor: done === 1 ? palette.success : palette.accent },
          doneStyle,
        ]}
      />
      {/* In progress: the same accent, tinted, right after the done share */}
      <Animated.View
        style={[styles.trackFill, { backgroundColor: mix(palette.accent, 40) }, startedStyle]}
      />
    </View>
  );
}

// Points right when closed, down when open
function Caret({ open, color }: { open: boolean; color: string }) {
  const reduce = useReducedMotion();
  const turn = useSharedValue(open ? 0 : -90);
  useEffect(() => {
    turn.set(reduce
      ? open
        ? 0
        : -90
      : withTiming(open ? 0 : -90, { duration: duration.short, easing: easeOut }));
  }, [open, reduce, turn]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get()}deg` }] }));
  return (
    <Animated.View style={style}>
      <Icon name="expandMore" size={18} color={color} />
    </Animated.View>
  );
}

// The settings menu, hung off its button
function SettingsMenu({
  anchor,
  palette,
  items,
  onClose,
}: {
  anchor: React.RefObject<View | null>;
  palette: Palette;
  items: { label: string; onPress: () => void }[];
  onClose: () => void;
}) {
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    anchor.current?.measureInWindow((x, y, width, height) => {
      setPosition({ top: y + height + 4, right: x + width });
    });
  }, [anchor]);
  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close menu" />
      {position && (
        <MenuPanel palette={palette} position={position}>
          <ThemeSwitch />
          {items.map((item) => (
            <Pressable
              key={item.label}
              onPress={() => {
                onClose();
                item.onPress();
              }}
              accessibilityRole="menuitem"
              style={({ pressed }) => [
                styles.menuItem,
                pressed && { backgroundColor: palette.sidebarHover },
              ]}
            >
              <Text style={[styles.menuText, { color: palette.textPrimary }]}>{item.label}</Text>
            </Pressable>
          ))}
        </MenuPanel>
      )}
    </Modal>
  );
}

function MenuPanel({
  palette,
  position,
  children,
}: {
  palette: Palette;
  position: { top: number; right: number };
  children: ReactNode;
}) {
  const [width, setWidth] = useState(0);
  return (
    <Animated.View
      entering={FadeIn.duration(duration.short)}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="menu"
      style={[
        styles.menu,
        {
          top: position.top,
          left: Math.max(space.xs, position.right - width),
          opacity: width ? 1 : 0,
          backgroundColor: palette.contextBg,
          borderColor: palette.border,
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  measure: {
    width: "100%",
    maxWidth: 620,
    alignSelf: "center",
  },
  head: {
    paddingHorizontal: space.md,
  },
  header: {
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
  day: {
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
    flexWrap: "wrap",
    gap: space["3xs"],
  },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    marginBottom: space.md,
    borderWidth: 1,
    borderRadius: 8,
  },
  composerInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: space["2xs"],
    // 16 keeps the phone's text at a size it doesn't want to zoom
    fontSize: 16,
  },
  addButton: {
    paddingVertical: space["3xs"] + 1,
    paddingHorizontal: space.sm,
    borderRadius: 999,
  },
  addText: {
    fontSize: text.sm,
    fontWeight: "600",
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    paddingVertical: space["3xs"],
    paddingLeft: space.sm,
    paddingRight: space["2xs"],
    marginTop: -space.md / 2,
    marginBottom: space.md,
    borderWidth: 1,
    borderRadius: 8,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: space["2xs"],
    fontSize: 16,
  },
  searchCount: {
    fontSize: text["2xs"],
  },
  track: {
    flexDirection: "row",
    height: 2,
    marginHorizontal: -space.md,
  },
  trackFill: {
    height: "100%",
  },
  scrollContainer: {
    flex: 1,
  },
  scroll: {
    paddingTop: space.sm,
    paddingHorizontal: space.md,
  },
  error: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    marginBottom: space.sm,
    borderWidth: 1,
    borderRadius: 8,
  },
  errorText: {
    flex: 1,
    fontSize: text.sm,
    lineHeight: text.sm * 1.5,
  },
  dismiss: {
    fontSize: text.xs,
    fontWeight: "600",
  },
  sectionToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: space["2xs"],
    padding: space.sm,
  },
  // At the top of the list there's nothing above to separate it from
  sectionHeadFirst: {
    marginTop: 0,
  },
  sectionText: {
    fontSize: text.sm,
  },
  count: {
    fontSize: text["2xs"],
  },
  empty: {
    padding: space.sm,
    fontSize: text.sm,
  },
  menu: {
    position: "absolute",
    minWidth: 230,
    paddingVertical: 4,
    borderWidth: 1,
    borderRadius: 8,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  menuItem: {
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
  },
  menuText: {
    fontSize: text.md,
  },
});
