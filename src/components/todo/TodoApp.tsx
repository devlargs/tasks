import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  MdAdd,
  MdChevronLeft,
  MdChevronRight,
  MdClose,
  MdExpandMore,
  MdInsights,
  MdOutlineCalendarMonth,
  MdOutlineSettings,
  MdRefresh,
  MdSearch,
} from "react-icons/md";
import type { TaskBackend } from "../../lib/api";
import { changeStatus, restoreTask } from "../../lib/tasksLogic";
import { carryTrackingSince, pickupTrackingSince } from "../../lib/tracking";
import type { TaskStatus, TodoTask } from "../../lib/types";
import { dissolveDurationMs } from "./dissolve";
import ConfirmDialog from "./ConfirmDialog";
import { matchesSearch, searchTerms } from "./search";
import TaskRow from "./TaskRow";
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
import "./todo.css";

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
// Refresh button and a page load bypass that). Kept in localStorage, so a
// reload shows the last known list straight away while the fresh read runs.
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
    const raw = localStorage.getItem(CACHE_STORAGE_KEY);
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
  try {
    localStorage.removeItem(CACHE_STORAGE_KEY);
  } catch {
    // Nothing stored, nothing to clear
  }
}

function persistCache(): void {
  try {
    const entries = [...dayCache]
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, CACHE_MAX_DAYS)
      // A row still waiting on its create isn't in Notion yet; after a reload
      // it would never get its page id
      .map(([day, { tasks, at }]): [string, CachedDay] => [
        day,
        { tasks: tasks.filter((t) => !t.id.startsWith(TEMP_PREFIX)), at },
      ]);
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Full or blocked storage just means no instant list next time
  }
}

// Created on screen, not yet in Notion — the row needs a key before the page id
// comes back.
const TEMP_PREFIX = "temp-";

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const byOrder = (tasks: TodoTask[]): TodoTask[] => [...tasks].sort((a, b) => a.order - b.order);

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Which way the checkbox moves a task
const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  todo: "inProgress",
  inProgress: "done",
  done: "inProgress",
};

// Near the top or bottom of the list, a drag scrolls it along
const DRAG_SCROLL_EDGE = 48;
const DRAG_SCROLL_STEP = 12;

export default function TodoApp({
  api,
  mode,
  databaseUrl,
  onConnectNotion,
  onDisconnectNotion,
}: TodoAppProps) {
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
  const [showDone, setShowDone] = useState(false);
  // The search field is tucked away until asked for; the query outlives a day
  // change, so the same search can be run down the days
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Done matches show open during a search, without touching the list's own
  // Done toggle; a new query opens them again
  const [searchDoneOpen, setSearchDoneOpen] = useState(true);
  // Finishing and deleting a task each ask first — both are one stray click
  // from the row's other buttons
  const [confirming, setConfirming] = useState<{
    action: "done" | "delete";
    task: TodoTask;
  } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  // A row whose checkbox had focus when its task changed section; the focus
  // follows it to where it lands
  const refocusId = useRef<string | null>(null);

  const composerRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const prevRects = useRef(new Map<string, DOMRect>());
  const dateRef = useRef(date);
  dateRef.current = date;
  // Temp id -> the page id Notion gave it, once the create has landed
  const createdIds = useRef(new Map<string, Promise<string | null>>());
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
  // A match among the done tasks shouldn't hide behind the collapsed section
  const doneExpanded = filtering ? searchDoneOpen : showDone;
  const toggleDone = () =>
    filtering ? setSearchDoneOpen(!doneExpanded) : setShowDone(!doneExpanded);

  useEffect(() => {
    setSearchDoneOpen(true);
  }, [query]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery("");
  }, []);

  // "/" jumps to the search from anywhere on the list, unless you're typing
  useEffect(() => {
    if (view !== "list") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      e.preventDefault();
      setSearchOpen(true);
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

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

  // A page load always asks Notion, however fresh the stored copy looks — the
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

  // A phone tab sits in the background for hours; coming back to it should
  // show what the desktop app did in the meantime.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") loadIfStale(dateRef.current);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadIfStale]);

  // Left open overnight the page would still be showing the old day under the
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
  }, []);

  // The composer is the point of the page, so it holds the caret from the
  // start — on a desktop. On a phone that would throw the keyboard over the
  // list before you've seen it.
  useEffect(() => {
    if (view === "list" && window.matchMedia("(pointer: fine)").matches) {
      composerRef.current?.focus();
    }
  }, [view]);

  // --- animation helpers -----------------------------------------------------

  // FLIP: rows that moved (a task picked up and rising into In Progress, one
  // put back, neighbours closing a gap) slide from where they were instead of
  // jumping.
  useLayoutEffect(() => {
    const refocus = refocusId.current;
    if (refocus) {
      refocusId.current = null;
      rowRefs.current.get(refocus)?.querySelector<HTMLElement>(".todo-check")?.focus();
    }
    const reduce = prefersReducedMotion();
    const seen = new Set<string>();
    for (const [id, el] of rowRefs.current) {
      seen.add(id);
      const next = el.getBoundingClientRect();
      const prev = prevRects.current.get(id);
      if (prev && !reduce && Math.abs(prev.top - next.top) > 1) {
        el.animate(
          [{ transform: `translateY(${prev.top - next.top}px)` }, { transform: "translateY(0)" }],
          { duration: 260, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
        );
      }
      prevRects.current.set(id, next);
    }
    for (const id of [...prevRects.current.keys()]) {
      if (!seen.has(id)) prevRects.current.delete(id);
    }
  }, [shownProgress, shownTodo, shownDone, doneExpanded]);

  // Collapse a row to nothing before it leaves the list, so the gap closes
  // instead of snapping shut.
  const collapseRow = useCallback(async (taskId: string) => {
    const el = rowRefs.current.get(taskId);
    if (!el || prefersReducedMotion()) return;
    const { height } = el.getBoundingClientRect();
    await el
      .animate(
        [
          { height: `${height}px`, opacity: 1 },
          { height: "0px", opacity: 0 },
        ],
        { duration: 200, easing: "cubic-bezier(0.7, 0, 0.84, 0)", fill: "forwards" },
      )
      .finished.catch(() => undefined);
  }, []);

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
    const tempId = `${TEMP_PREFIX}${crypto.randomUUID()}`;
    const targetDate = date;
    // Newest first, matching the order the server will store
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
    composerRef.current?.focus();

    let settle: (id: string | null) => void = () => undefined;
    createdIds.current.set(tempId, new Promise((resolve) => (settle = resolve)));
    void write(() => api.create(targetDate, text)).then((res) => {
      settle(res.ok ? res.task.id : null);
      if (!res.ok) {
        setTasks((current) => current.filter((t) => t.id !== tempId));
        return;
      }
      // Keep the edits made while it was in flight (a tick, a rename); only
      // the id and Notion's timestamp are news.
      setTasks((current) =>
        current.map((t) =>
          t.id === tempId ? { ...t, id: res.task.id, editedAt: res.task.editedAt } : t,
        ),
      );
    });
  }, [api, draft, date, tasks, write]);

  // Todo → In Progress → Done, and back. The clock and the task's place in
  // the day follow the same rules the backends apply (changeStatus), so the
  // row lands where the saved copy will put it.
  const handleStatus = useCallback(
    async (task: TodoTask, status: TaskStatus) => {
      // The write goes out first — the animation is presentation, and a task
      // must never be lost because a frame was dropped.
      const request = withId(task.id, (id) => api.update(id, { status }));
      // Finishing a task dissolves its letters, then closes the gap it leaves.
      // Every other change is a move: the row travels to its new section.
      if (status === "done") {
        if (!prefersReducedMotion()) {
          setDissolvingId(task.id);
          await wait(dissolveDurationMs([...task.text].length));
          await collapseRow(task.id);
          setDissolvingId(null);
        }
      } else if (rowRefs.current.get(task.id)?.contains(document.activeElement)) {
        refocusId.current = task.id;
      }
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
    [api, withId, collapseRow],
  );

  const handleRename = useCallback(
    async (task: TodoTask, text: string) => {
      setTasks((current) => current.map((t) => (t.id === task.id ? { ...t, text } : t)));
      await withId(task.id, (id) => api.update(id, { text }));
    },
    [api, withId],
  );

  // Moves a task off this day: the row collapses out and lands at the end of
  // the chosen day, exactly where the overnight carry-over would have put it.
  // Shared by defer (tomorrow) and schedule (a picked day).
  const moveOff = useCallback(
    async (task: TodoTask, toDate: string) => {
      if (toDate === task.date) return;
      const request = withId(task.id, (id) => api.move(id, toDate));
      await collapseRow(task.id);
      setTasks((current) => current.filter((t) => t.id !== task.id));
      const res = await request;
      if (res.ok) applyTask(task.id, res.task);
    },
    [api, withId, collapseRow, applyTask],
  );

  const handleDelete = useCallback(
    async (task: TodoTask) => {
      const request = withId(task.id, (id) => api.remove(id));
      await collapseRow(task.id);
      setTasks((current) => current.filter((t) => t.id !== task.id));
      await request;
    },
    [api, withId, collapseRow],
  );

  // --- drag to reorder -------------------------------------------------------

  // A drag stays inside its own section: the buttons, not a drop, are how a
  // task changes state.
  const dragState = useRef<{ id: string; section: TaskStatus; target: string | null } | null>(null);

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
  }, [api, progressTasks, todoTasks, doneTasks, date, write, resolveId]);

  const startDrag = useCallback((task: TodoTask, e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragState.current = { id: task.id, section: task.status, target: null };
    setDraggingId(task.id);

    const onMove = (ev: PointerEvent) => {
      const drag = dragState.current;
      if (!drag) return;
      const row = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest<HTMLElement>("[data-drop-id]");
      // A row in the other section isn't a place this one can go
      if (row && row.dataset.dropSection === drag.section) {
        drag.target = row.dataset.dropId ?? drag.target;
      }
      setDropTargetId(drag.target);
      const scroller = scrollRef.current;
      if (scroller) {
        const box = scroller.getBoundingClientRect();
        if (ev.clientY < box.top + DRAG_SCROLL_EDGE) scroller.scrollBy(0, -DRAG_SCROLL_STEP);
        else if (ev.clientY > box.bottom - DRAG_SCROLL_EDGE) {
          scroller.scrollBy(0, DRAG_SCROLL_STEP);
        }
      }
    };
    const onEnd = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      if (ev.type === "pointercancel" && dragState.current) dragState.current.target = null;
      finishDragRef.current();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  }, []);

  // The listeners above outlive a render; they always call the latest drop
  const finishDragRef = useRef(finishDrag);
  finishDragRef.current = finishDrag;

  const goToDay = useCallback((next: string, direction: "next" | "prev") => {
    setSlide(direction);
    setDate(next);
    setError(null);
    const cached = dayCache.get(next);
    setTasks(cached?.tasks ?? []);
    setLoaded(!!cached);
  }, []);

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

  const chromeButton = {
    width: 30,
    height: 30,
    color: "var(--text-muted)",
    background: "transparent",
    border: "none",
  } as const;

  // Shared by every row of the settings menu, so a second entry can't drift
  // away from the first.
  const menuItem = {
    padding: "var(--space-xs) var(--space-sm)",
    fontSize: "var(--text-sm)",
    color: "var(--text-primary)",
    background: "transparent",
    border: "none",
    textDecoration: "none",
  } as const;

  // On the device there's nothing to sync with or refresh from
  const syncing = inFlight > 0 || reading > 0;
  const syncPill = mode === "notion" && (
    <button
      onClick={() => void loadDay(date, true)}
      title={
        inFlight > 0
          ? "Saving to Notion"
          : reading > 0
            ? "Checking Notion for changes"
            : "Saved to Notion — tap to refresh"
      }
      className={`rounded-full cursor-pointer ${syncing ? "todo-pill-syncing" : ""}`}
      style={{
        padding: "var(--space-3xs) var(--space-xs)",
        fontSize: "var(--text-2xs)",
        whiteSpace: "nowrap",
        color: "var(--text-secondary)",
        background: "transparent",
        border: `1px solid color-mix(in srgb, var(--border) 70%, transparent)`,
      }}
    >
      {syncing ? "Syncing" : "Synced"}
    </button>
  );

  const renderRow = (task: TodoTask, reorderable: boolean) => (
    <div
      key={task.id}
      ref={(el) => {
        if (el) rowRefs.current.set(task.id, el);
        else rowRefs.current.delete(task.id);
      }}
      className={`todo-row-wrap ${enteringIds.includes(task.id) ? "todo-row-entering" : ""}`}
      onAnimationEnd={() => setEnteringIds((ids) => ids.filter((id) => id !== task.id))}
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
        onDragStart={(e) => startDrag(task, e)}
        dragging={draggingId === task.id}
        dropTarget={dropTargetId === task.id && draggingId !== task.id}
      />
    </div>
  );

  return (
    <div className="todo-page h-full flex flex-col" style={{ background: "var(--surface)" }}>
      {/* --- The head. Day, composer, progress — pinned, so adding a task never
          costs a scroll no matter how long the list gets. --- */}
      <div className="todo-head shrink-0">
        <div className="todo-measure">
          <header
            className="flex items-start justify-between flex-wrap"
            style={{ gap: "var(--space-sm)", marginBottom: "var(--space-md)" }}
          >
            <div className="min-w-0">
              <h1 className="todo-day" style={{ color: "var(--text-primary)" }}>
                {formatDayLabel(date)}
              </h1>
              <p
                style={{
                  marginTop: "var(--space-3xs)",
                  fontSize: "var(--text-xs)",
                  color: "var(--text-secondary)",
                }}
              >
                {formatFullDate(date)}
                {ordered.length > 0 && (
                  <>
                    {" · "}
                    <span className="todo-figure">
                      {doneCount}/{ordered.length}
                    </span>{" "}
                    done
                  </>
                )}
              </p>
            </div>

            <div className="flex items-center shrink-0" style={{ gap: "var(--space-3xs)" }}>
              {date !== todayKey() && (
                <button
                  onClick={() => goToDay(todayKey(), date < todayKey() ? "next" : "prev")}
                  className="rounded-full cursor-pointer"
                  style={{
                    padding: "var(--space-3xs) var(--space-xs)",
                    marginRight: "var(--space-2xs)",
                    fontSize: "var(--text-2xs)",
                    whiteSpace: "nowrap",
                    color: "var(--accent)",
                    background: "transparent",
                    border: "1px solid color-mix(in srgb, var(--accent) 45%, transparent)",
                  }}
                >
                  Today
                </button>
              )}
              {syncPill}
              <button
                onClick={() => goToDay(shiftDateKey(date, -1), "prev")}
                className="todo-daynav flex items-center justify-center rounded-full cursor-pointer hover:bg-sidebar-hover"
                style={chromeButton}
                title="Previous day"
                aria-label="Previous day"
              >
                <MdChevronLeft size={18} />
              </button>
              <button
                onClick={() => goToDay(shiftDateKey(date, 1), "next")}
                className="todo-daynav flex items-center justify-center rounded-full cursor-pointer hover:bg-sidebar-hover"
                style={chromeButton}
                title="Next day"
                aria-label="Next day"
              >
                <MdChevronRight size={18} />
              </button>
              <button
                onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
                className="todo-daynav flex items-center justify-center rounded-full cursor-pointer hover:bg-sidebar-hover"
                style={{ ...chromeButton, color: searchOpen ? "var(--accent)" : undefined }}
                title="Search tasks (/)"
                aria-label="Search tasks"
                aria-expanded={searchOpen}
              >
                <MdSearch size={16} />
              </button>
              <button
                onClick={() => setView("calendar")}
                className="todo-daynav flex items-center justify-center rounded-full cursor-pointer hover:bg-sidebar-hover"
                style={chromeButton}
                title="Calendar"
                aria-label="Calendar"
              >
                <MdOutlineCalendarMonth size={15} />
              </button>
              <button
                onClick={() => setView("stats")}
                className="todo-daynav flex items-center justify-center rounded-full cursor-pointer hover:bg-sidebar-hover"
                style={chromeButton}
                title="Progress"
                aria-label="Progress"
              >
                <MdInsights size={15} />
              </button>
              {mode === "notion" && (
                <button
                  onClick={() => void loadDay(date, true)}
                  title="Refresh from Notion"
                  aria-label="Refresh from Notion"
                  className="todo-daynav flex items-center justify-center rounded-full cursor-pointer hover:bg-sidebar-hover"
                  style={chromeButton}
                >
                  <MdRefresh size={15} className={refreshing ? "animate-spin" : ""} />
                </button>
              )}
              <div className="relative">
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  title="Settings"
                  aria-label="Settings"
                  aria-expanded={menuOpen}
                  className="todo-daynav flex items-center justify-center rounded-full cursor-pointer hover:bg-sidebar-hover"
                  style={chromeButton}
                >
                  <MdOutlineSettings size={15} />
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onPointerDown={() => setMenuOpen(false)} />
                    <div
                      className="absolute right-0 z-20 rounded-lg"
                      style={{
                        top: 34,
                        minWidth: 230,
                        padding: "4px 0",
                        background: "var(--context-bg)",
                        border: "1px solid var(--border)",
                        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                      }}
                    >
                      {mode === "notion" && databaseUrl && (
                        <a
                          href={databaseUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setMenuOpen(false)}
                          className="block w-full text-left cursor-pointer hover:bg-sidebar-hover"
                          style={menuItem}
                        >
                          View database in Notion
                        </a>
                      )}
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          if (mode === "notion") onDisconnectNotion();
                          else onConnectNotion();
                        }}
                        className="block w-full text-left cursor-pointer hover:bg-sidebar-hover"
                        style={menuItem}
                      >
                        {mode === "notion" ? "Disconnect Notion" : "Connect Notion…"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </header>

          {/* The composer. First thing under the day, before the list, so a new
              task is always one keystroke away. */}
          <form
            className="todo-composer flex items-center rounded-lg"
            onSubmit={(e) => {
              e.preventDefault();
              handleCreate();
            }}
          >
            <MdAdd size={18} className="shrink-0" style={{ color: "var(--text-muted)" }} />
            <input
              ref={composerRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={ordered.length === 0 ? "What needs doing today?" : "Add a task"}
              aria-label="Add a task"
              enterKeyHint="done"
              maxLength={500}
              className="flex-1 min-w-0 outline-none"
              style={{
                fontSize: "var(--text-md)",
                color: "var(--text-primary)",
                background: "transparent",
                border: "none",
              }}
            />
            <span
              className="todo-composer-hint shrink-0"
              aria-hidden={draft.trim().length === 0}
              style={{ fontSize: "var(--text-2xs)", color: "var(--text-muted)" }}
            >
              Enter
            </span>
            {/* Phones have no Enter hint worth trusting — a real button */}
            <button
              type="submit"
              className="todo-composer-submit shrink-0"
              disabled={draft.trim().length === 0}
              aria-label="Add task"
            >
              Add
            </button>
          </form>

          {searchOpen && (
            <div className="todo-search flex items-center rounded-lg" role="search">
              <MdSearch size={16} className="shrink-0" style={{ color: "var(--text-muted)" }} />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    closeSearch();
                  }
                }}
                placeholder="Search this day's tasks"
                aria-label="Search tasks"
                enterKeyHint="search"
                className="flex-1 min-w-0 outline-none"
                style={{
                  fontSize: "var(--text-sm)",
                  color: "var(--text-primary)",
                  background: "transparent",
                  border: "none",
                }}
              />
              {filtering && (
                <span
                  className="todo-figure shrink-0"
                  aria-live="polite"
                  style={{ fontSize: "var(--text-2xs)", color: "var(--text-muted)" }}
                >
                  {shownCount} of {ordered.length}
                </span>
              )}
              <button
                type="button"
                onClick={closeSearch}
                className="todo-daynav shrink-0 flex items-center justify-center rounded-full cursor-pointer hover:bg-sidebar-hover"
                style={{ ...chromeButton, width: 24, height: 24 }}
                title="Close search (Esc)"
                aria-label="Close search"
              >
                <MdClose size={14} />
              </button>
            </div>
          )}
        </div>

        {/* The head's bottom edge doubles as the day's progress: done in full
            accent, and what's in progress after it in a tint, so the bar moves
            the moment something is picked up. */}
        <div className="todo-progress-track">
          <div
            className={`todo-progress-fill ${progress === 1 ? "todo-progress-fill-complete" : ""}`}
            style={{ width: `${progress * 100}%` }}
          />
          <div className="todo-progress-started" style={{ width: `${started * 100}%` }} />
        </div>
      </div>

      {/* --- The list. Scrolls under the head. --- */}
      <div ref={scrollRef} className="todo-scroll flex-1 overflow-y-auto">
        <div className="todo-measure">
          {error && (
            <div
              className="flex items-center rounded-lg"
              style={{
                padding: "var(--space-xs) var(--space-sm)",
                marginBottom: "var(--space-sm)",
                gap: "var(--space-sm)",
                fontSize: "var(--text-sm)",
                color: "var(--danger)",
                border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)",
                background: "color-mix(in srgb, var(--danger) 7%, transparent)",
              }}
            >
              <span className="flex-1" style={{ lineHeight: 1.5 }}>
                {error}
              </span>
              <button
                onClick={() => setError(null)}
                className="cursor-pointer shrink-0"
                style={{
                  fontSize: "var(--text-xs)",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  color: "var(--text-primary)",
                  background: "transparent",
                  border: "none",
                }}
              >
                Dismiss
              </button>
            </div>
          )}

          <div
            key={date}
            className={slide === "next" ? "todo-day-next" : slide === "prev" ? "todo-day-prev" : ""}
          >
            {/* One keyed list for both open sections, so a row moving between
                them is the same element travelling, not a new one appearing */}
            {/* A filtered list can't be reordered: a drop between two matches
                says nothing about where the hidden rows should go. */}
            {[
              shownProgress.length > 0 && (
                <h2 key="head-progress" className="todo-section-head todo-section-head-first">
                  <span>In Progress</span>
                  <span className="todo-figure todo-done-count">{shownProgress.length}</span>
                </h2>
              ),
              ...shownProgress.map((task) => renderRow(task, !filtering)),
              shownProgress.length > 0 && shownTodo.length > 0 && (
                <h2 key="head-todo" className="todo-section-head">
                  <span>Todo</span>
                  <span className="todo-figure todo-done-count">{shownTodo.length}</span>
                </h2>
              ),
              ...shownTodo.map((task) => renderRow(task, !filtering)),
            ]}

            {filtering && shownCount === 0 && (
              <p
                className="todo-empty"
                style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}
              >
                No tasks match “{query.trim()}”.
              </p>
            )}

            {!filtering && openCount === 0 && (
              <p
                className="todo-empty"
                style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}
              >
                {!loaded
                  ? "Loading…"
                  : ordered.length === 0
                    ? "Nothing on the list."
                    : "Everything's done."}
              </p>
            )}

            {/* Finished work is filed, not crossed out — a struck-through label
                is still a full row of text to read past. */}
            {shownDone.length > 0 && (
              <>
                <button
                  onClick={toggleDone}
                  aria-expanded={doneExpanded}
                  className="todo-done-toggle flex items-center w-full cursor-pointer"
                >
                  <MdExpandMore
                    size={17}
                    className={`todo-done-caret shrink-0 ${doneExpanded ? "todo-done-caret-open" : ""}`}
                  />
                  <span>Done tasks</span>
                  <span className="todo-figure todo-done-count">{shownDone.length}</span>
                </button>
                {doneExpanded && (
                  <div className="todo-done-list">
                    {shownDone.map((task) => renderRow(task, false))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

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
          <p className="todo-confirm-task">{confirming.task.text}</p>
          {confirming.action === "delete" && (
            <p>
              {mode === "notion"
                ? "Its page goes to the trash in Notion."
                : "This can't be undone."}
            </p>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
