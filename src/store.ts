import { useSyncExternalStore } from "react";
import { STATUSES, type Status, type Task, type User } from "../shared/types";
import { api, HttpError } from "./api";
import { logicalDay, previousDay } from "./day";

/**
 * Local-first store. Everything renders from localStorage first, every change is
 * written locally and queued in an outbox, and the outbox is flushed to the API
 * in the background. Task ids are client-generated, so resending is idempotent.
 */

const K = {
  user: "flick:v1:user",
  tasks: (uid: string) => `flick:v1:tasks:${uid}`,
  outbox: (uid: string) => `flick:v1:outbox:${uid}`,
  boot: "flick:v1:boot",
  planned: (uid: string) => `flick:v1:planned:${uid}`,
};

type AuthState = "unknown" | "in" | "out";
interface State {
  auth: AuthState;
  user: User | null;
  tasks: Record<string, Task>;
  /** true once tasks are available (from cache or server) */
  ready: boolean;
}

const read = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the server copy still syncs */
  }
};

/** Tasks cached by older versions have no note. */
const readTasks = (uid: string): Record<string, Task> => {
  const tasks = read<Record<string, Task>>(K.tasks(uid), {});
  for (const t of Object.values(tasks)) {
    t.note ??= "";
    t.today ??= null;
    t.doneAt ??= null;
    t.trashedAt ??= null;
  }
  return tasks;
};

const cachedUser = read<User | null>(K.user, null);
let state: State = {
  auth: cachedUser ? "in" : "unknown",
  user: cachedUser,
  tasks: cachedUser ? readTasks(cachedUser.id) : {},
  ready: cachedUser ? localStorage.getItem(K.tasks(cachedUser.id)) !== null : false,
};
let outbox: string[] = cachedUser ? read(K.outbox(cachedUser.id), []) : [];
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  document.documentElement.dataset.auth = state.auth;
  listeners.forEach((l) => l());
}

function persist() {
  if (!state.user) return;
  write(K.tasks(state.user.id), state.tasks);
  write(K.outbox(state.user.id), outbox);
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => select(state),
  );
}
export const getState = () => state;

// ---------- selectors ----------
/** Not in the archive and not in the trash. */
export const isLive = (t: Task) => t.archivedAt === null && t.trashedAt === null;
export const topLevel = (tasks: Record<string, Task>, status: Status) =>
  Object.values(tasks)
    .filter((t) => isLive(t) && t.parentId === null && t.status === status)
    .sort((a, b) => b.position - a.position);
export const childrenOf = (tasks: Record<string, Task>, parentId: string) =>
  Object.values(tasks)
    .filter((t) => isLive(t) && t.parentId === parentId)
    .sort((a, b) => a.position - b.position);
export const counts = (tasks: Record<string, Task>) =>
  Object.fromEntries(STATUSES.map((s) => [s, topLevel(tasks, s).length])) as Record<Status, number>;

/** Whole-task progress from subtasks. ratio is null when there are none. */
export function progressOf(tasks: Record<string, Task>, id: string) {
  const subs = childrenOf(tasks, id);
  const done = subs.filter((s) => s.status === "done").length;
  return { done, total: subs.length, ratio: subs.length ? done / subs.length : null };
}

/** Archive: kept done tasks, newest first. Their subtasks travel with them. */
export const archivedList = (tasks: Record<string, Task>) =>
  Object.values(tasks)
    .filter((t) => t.parentId === null && t.archivedAt !== null && t.trashedAt === null)
    .sort((a, b) => b.archivedAt! - a.archivedAt!);

/** Trash: trashed tasks, plus subtasks deleted on their own (their parent is not in the trash). */
export const trashList = (tasks: Record<string, Task>) =>
  Object.values(tasks)
    .filter((t) => t.trashedAt !== null && (t.parentId === null || !tasks[t.parentId] || tasks[t.parentId].trashedAt === null))
    .sort((a, b) => b.trashedAt! - a.trashedAt!);

// ---------- today ----------
const open = (t: Task) => isLive(t) && t.parentId === null;
/** Due today or overdue and not finished: always part of today. */
export const isDueNow = (t: Task, day: string) => t.due !== null && t.due <= day && t.status !== "done";
export const isPicked = (t: Task, day: string) => t.today === day;
/** In today's list, either picked or due. */
export const inToday = (t: Task, day: string) => isPicked(t, day) || isDueNow(t, day);

/**
 * Today's goal for a task: the subtasks marked for today. With none marked, the goal is the whole task.
 * achieved does not need the whole task done, so a big task can be "done for today".
 */
export function goalOf(tasks: Record<string, Task>, t: Task, day: string) {
  const goals = childrenOf(tasks, t.id).filter((s) => s.today === day);
  const done = goals.filter((s) => s.status === "done").length;
  return { done, total: goals.length, achieved: t.status === "done" || (goals.length > 0 && done === goals.length) };
}

/** Today's list: picked tasks plus anything due now. Unfinished first (newest on top), done for today last. */
export function todayList(tasks: Record<string, Task>, day: string) {
  const list = Object.values(tasks).filter((t) => open(t) && inToday(t, day));
  const rank = (t: Task) => (goalOf(tasks, t, day).achieved ? 1 : 0);
  return list.sort((a, b) => rank(a) - rank(b) || b.position - a.position);
}

/** Candidates for the morning pick, grouped. Already-picked tasks come first so they read as chosen. */
export function planCandidates(tasks: Record<string, Task>, day: string) {
  const yesterday = previousDay(day);
  const pool = Object.values(tasks)
    .filter((t) => open(t) && t.status !== "done")
    .sort((a, b) => b.position - a.position);
  return {
    picked: pool.filter((t) => isPicked(t, day)),
    leftover: pool.filter((t) => !isPicked(t, day) && t.today !== null && t.today >= yesterday && t.today < day),
    due: pool.filter((t) => !isPicked(t, day) && !(t.today !== null && t.today >= yesterday && t.today < day) && isDueNow(t, day)),
    rest: pool.filter(
      (t) => !isPicked(t, day) && !(t.today !== null && t.today >= yesterday && t.today < day) && !isDueNow(t, day),
    ),
  };
}

export function isPlanned(day: string) {
  if (!state.user) return true;
  return read<string | null>(K.planned(state.user.id), null) === day;
}

/**
 * Commit the morning pick: chosen tasks become today's, the rest stay where they are.
 * goals: subtask ids that are today's goal (only under chosen tasks).
 */
export function startDay(ids: string[], day = logicalDay(), goals: string[] = []) {
  const chosen = new Set(ids);
  const goal = new Set(goals);
  for (const t of Object.values(state.tasks)) {
    if (!open(t)) continue;
    if (chosen.has(t.id) && t.today !== day) save({ ...t, today: day });
    else if (!chosen.has(t.id) && t.today === day) save({ ...t, today: null });
    const keep = chosen.has(t.id) || isDueNow(t, day);
    for (const s of childrenOf(state.tasks, t.id)) {
      const on = keep && goal.has(s.id);
      if ((s.today === day) !== on) save({ ...s, today: on ? day : null });
    }
  }
  if (state.user) write(K.planned(state.user.id), day);
  set({});
}

export function setToday(id: string, on: boolean, day = logicalDay()) {
  const t = state.tasks[id];
  if (t && (t.today === day) !== on) save({ ...t, today: on ? day : null });
}

/** Mark a subtask as today's goal, or not. */
export function setGoal(subId: string, on: boolean, day = logicalDay()) {
  setToday(subId, on, day);
}

/**
 * Take a task (and its goals) out of today. Status and progress stay exactly as they are.
 * Returns an undo that puts back today and the same goals.
 */
export function postpone(id: string, day = logicalDay()): () => void {
  const t = state.tasks[id];
  if (!t) return () => {};
  const wasPicked = t.today === day;
  const goals = childrenOf(state.tasks, id).filter((s) => s.today === day).map((s) => s.id);
  setToday(id, false, day);
  goals.forEach((g) => setToday(g, false, day));
  return () => {
    if (wasPicked) setToday(id, true, day);
    goals.forEach((g) => setToday(g, true, day));
  };
}

// ---------- mutations ----------
/** A position above every task, so the newest action always lands on top in order. */
export function topPosition() {
  let max = Date.now();
  for (const t of Object.values(state.tasks)) if (t.parentId === null && t.position >= max) max = t.position + 1;
  return max;
}

function save(task: Task) {
  const prev = state.tasks[task.id];
  // updatedAt must strictly increase so the server's last-write-wins accepts it.
  const updatedAt = Math.max(Date.now(), (prev?.updatedAt ?? 0) + 1);
  // doneAt follows the status: it starts the 7 days before a done task goes to the trash
  const doneAt = task.status !== "done" ? null : (task.doneAt ?? updatedAt);
  const next = { ...task, updatedAt, doneAt };
  set({ tasks: { ...state.tasks, [task.id]: next } });
  if (!outbox.includes(task.id)) outbox.push(task.id);
  persist();
  void flush();
  return next;
}

export function addTask(
  title: string,
  opts: { due?: string | null; parentId?: string | null; status?: Status; today?: string | null } = {},
) {
  const now = Date.now();
  const siblings = opts.parentId ? childrenOf(state.tasks, opts.parentId) : [];
  return save({
    id: crypto.randomUUID(),
    title: title.trim().slice(0, 500),
    note: "",
    status: opts.status ?? "todo",
    parentId: opts.parentId ?? null,
    due: opts.due ?? null,
    today: opts.today ?? null,
    // top-level: newest first; subtasks: in insertion order
    position: opts.parentId ? (siblings.at(-1)?.position ?? 0) + 1 : topPosition(),
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    doneAt: null,
    trashedAt: null,
  });
}

export function updateTask(id: string, patch: Partial<Omit<Task, "id">>) {
  const t = state.tasks[id];
  if (t) save({ ...t, ...patch });
}

/**
 * keepPlace: Today keeps cards where they are instead of lifting them to the top.
 * Left of todo goes to the trash; right of done keeps it in the archive.
 */
export function moveTask(id: string, dir: 1 | -1, keepPlace = false): "moved" | "trashed" | "archived" | null {
  const t = state.tasks[id];
  if (!t) return null;
  const i = STATUSES.indexOf(t.status) + dir;
  if (i < 0) {
    trashTask(id);
    return "trashed";
  }
  if (i >= STATUSES.length) {
    archiveDone(id);
    return "archived";
  }
  // Arrive at the top of the destination list.
  save({ ...t, status: STATUSES[i], position: keepPlace ? t.position : topPosition() });
  return "moved";
}

/**
 * Tick a subtask. The first finished subtask means work has started, so a todo parent becomes doing
 * (in place: Today keeps its order). Unticking never moves the parent back.
 */
export function toggleSub(subId: string): { started: boolean; allDone: boolean } {
  const s = state.tasks[subId];
  if (!s) return { started: false, allDone: false };
  const done = s.status !== "done";
  save({ ...s, status: done ? "done" : "todo" });
  const parent = s.parentId ? state.tasks[s.parentId] : undefined;
  if (!parent || !done) return { started: false, allDone: false };
  const started = parent.status === "todo";
  if (started) save({ ...parent, status: "doing" });
  const { done: d, total } = progressOf(state.tasks, parent.id);
  return { started, allDone: total > 0 && d === total && parent.status !== "done" };
}

/** Attachment counts are server-owned: update locally without queueing a write. */
export function setAttachmentCount(id: string, attachmentCount: number) {
  const t = state.tasks[id];
  if (!t) return;
  set({ tasks: { ...state.tasks, [id]: { ...t, attachmentCount } } });
  persist();
}

/** To the trash, with its subtasks (same time, so they come back together). */
export function trashTask(id: string) {
  const t = state.tasks[id];
  if (!t) return;
  const now = Date.now();
  save({ ...t, trashedAt: now });
  Object.values(state.tasks)
    .filter((c) => c.parentId === id && c.trashedAt === null)
    .forEach((c) => save({ ...c, trashedAt: now }));
}

/** Back from the trash to where it was (the archive, or its list). A done task gets a fresh 7 days. */
export function restoreFromTrash(id: string) {
  const t = state.tasks[id];
  if (!t || t.trashedAt === null) return;
  const at = t.trashedAt;
  const fresh = t.status === "done" && t.archivedAt === null;
  save({ ...t, trashedAt: null, ...(fresh ? { doneAt: Date.now() } : {}) });
  Object.values(state.tasks)
    .filter((c) => c.parentId === id && c.trashedAt === at)
    .forEach((c) => save({ ...c, trashedAt: null }));
}

/** Keep a done task in the archive (never cleaned up automatically). */
export function archiveDone(id: string) {
  const t = state.tasks[id];
  if (t) save({ ...t, archivedAt: Date.now() });
}

/** Undo for archiveDone. */
export function unarchiveInPlace(id: string) {
  const t = state.tasks[id];
  if (t) save({ ...t, archivedAt: null });
}

/** From the archive back to doing. */
export function unarchive(id: string) {
  const t = state.tasks[id];
  if (t) save({ ...t, archivedAt: null, status: "doing", position: topPosition() });
}

function forget(ids: Set<string>) {
  const tasks = { ...state.tasks };
  for (const t of Object.values(tasks)) if (ids.has(t.id) || (t.parentId && ids.has(t.parentId))) delete tasks[t.id];
  outbox = outbox.filter((id) => tasks[id]);
  set({ tasks });
  persist();
}

/** Delete for good (from the trash only). */
export async function purgeTask(id: string) {
  await flush();
  try {
    await api.deleteTask(id);
  } catch (e) {
    // never reached the server (made offline and trashed): nothing to delete there
    if (!(e instanceof HttpError && e.status === 404)) throw e;
  }
  forget(new Set([id]));
}

export async function emptyTrash() {
  await flush();
  await api.emptyTrash();
  forget(new Set(trashList(state.tasks).map((t) => t.id)));
}

// ---------- sync ----------
let flushing = false;
let retry: ReturnType<typeof setTimeout> | undefined;

export async function flush() {
  if (flushing || !state.user) return;
  flushing = true;
  try {
    while (outbox.length) {
      const id = outbox[0];
      const local = state.tasks[id];
      if (local) {
        const { task } = await api.putTask(local);
        // Changed again while the request was in flight: keep it queued and send again.
        if (state.tasks[id]?.updatedAt !== local.updatedAt) continue;
        set({ tasks: { ...state.tasks, [id]: task } });
      }
      outbox.shift();
      persist();
    }
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) signedOut();
    else if (e instanceof HttpError && e.status === 410) {
      // deleted for good on another device: forget it here too
      forget(new Set([outbox[0]]));
    } else if (e instanceof HttpError && e.status >= 400 && e.status < 500) {
      // The server rejected this change permanently; drop it so the queue keeps moving.
      outbox.shift();
      persist();
    }
    clearTimeout(retry);
    retry = setTimeout(flush, 4000);
  } finally {
    flushing = false;
  }
}

async function pull() {
  const { tasks: remote } = await api.tasks();
  const pending = new Set(outbox);
  const merged: Record<string, Task> = {};
  for (const t of remote) {
    const local = state.tasks[t.id];
    merged[t.id] = local && pending.has(t.id) && local.updatedAt > t.updatedAt ? local : t;
  }
  // Keep local changes the server has not seen yet (new tasks, archives awaiting sync).
  for (const id of pending) if (state.tasks[id]) merged[id] = state.tasks[id];
  set({ tasks: merged, ready: true });
  persist();
}

function signedIn(user: User) {
  const switched = state.user?.id !== user.id;
  if (switched) {
    outbox = read(K.outbox(user.id), []);
    set({ user, auth: "in", tasks: readTasks(user.id), ready: localStorage.getItem(K.tasks(user.id)) !== null });
  } else set({ user, auth: "in" });
  write(K.user, user);
}

function signedOut() {
  try {
    localStorage.removeItem(K.user);
  } catch {
    /* ignore */
  }
  outbox = [];
  set({ auth: "out", user: null, tasks: {}, ready: true });
}

/** Turn memos typed before the bundle loaded into tasks. */
export function drainBootQueue() {
  const q = read<{ text: string }[]>(K.boot, []);
  if (!q.length || state.auth !== "in") return;
  try {
    localStorage.removeItem(K.boot);
  } catch {
    /* ignore */
  }
  // the app opens on Today, so memos typed at launch belong to today
  q.forEach((m) => addTask(m.text, { today: logicalDay() }));
}

export async function start() {
  try {
    const { user } = await api.me();
    signedIn(user);
    drainBootQueue();
    await pull();
    void flush();
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) signedOut();
    else if (state.auth === "unknown") {
      // Offline with no cached session: we can't know, show login.
      set({ auth: "out", ready: true });
    }
  }
}

export async function logout() {
  try {
    await api.logout();
  } finally {
    if (state.user) {
      try {
        localStorage.removeItem(K.tasks(state.user.id));
        localStorage.removeItem(K.outbox(state.user.id));
        localStorage.removeItem("flick:v1:draft");
        const memo = document.getElementById("memo") as HTMLTextAreaElement | null;
        if (memo) memo.value = "";
      } catch {
        /* ignore */
      }
    }
    signedOut();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.auth === "in") void pull().catch(() => {});
  });
}
