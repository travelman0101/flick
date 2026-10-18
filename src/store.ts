import { useSyncExternalStore } from "react";
import { STATUSES, type Status, type Task, type User } from "../shared/types";
import { api, HttpError } from "./api";

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

const cachedUser = read<User | null>(K.user, null);
let state: State = {
  auth: cachedUser ? "in" : "unknown",
  user: cachedUser,
  tasks: cachedUser ? read(K.tasks(cachedUser.id), {}) : {},
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
const visible = (t: Task) => t.archivedAt === null;
export const topLevel = (tasks: Record<string, Task>, status: Status) =>
  Object.values(tasks)
    .filter((t) => visible(t) && t.parentId === null && t.status === status)
    .sort((a, b) => b.position - a.position);
export const childrenOf = (tasks: Record<string, Task>, parentId: string) =>
  Object.values(tasks)
    .filter((t) => visible(t) && t.parentId === parentId)
    .sort((a, b) => a.position - b.position);
export const counts = (tasks: Record<string, Task>) =>
  Object.fromEntries(STATUSES.map((s) => [s, topLevel(tasks, s).length])) as Record<Status, number>;

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
  const next = { ...task, updatedAt };
  set({ tasks: { ...state.tasks, [task.id]: next } });
  if (!outbox.includes(task.id)) outbox.push(task.id);
  persist();
  void flush();
  return next;
}

export function addTask(title: string, opts: { due?: string | null; parentId?: string | null; status?: Status } = {}) {
  const now = Date.now();
  const siblings = opts.parentId ? childrenOf(state.tasks, opts.parentId) : [];
  return save({
    id: crypto.randomUUID(),
    title: title.trim().slice(0, 500),
    status: opts.status ?? "todo",
    parentId: opts.parentId ?? null,
    due: opts.due ?? null,
    // top-level: newest first; subtasks: in insertion order
    position: opts.parentId ? (siblings.at(-1)?.position ?? 0) + 1 : topPosition(),
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  });
}

export function updateTask(id: string, patch: Partial<Omit<Task, "id">>) {
  const t = state.tasks[id];
  if (t) save({ ...t, ...patch });
}

export function moveTask(id: string, dir: 1 | -1): "moved" | "archived" | null {
  const t = state.tasks[id];
  if (!t) return null;
  const i = STATUSES.indexOf(t.status) + dir;
  if (i < 0) {
    archiveTask(id);
    return "archived";
  }
  if (i >= STATUSES.length) return null;
  // Arrive at the top of the destination list.
  save({ ...t, status: STATUSES[i], position: topPosition() });
  return "moved";
}

export function archiveTask(id: string) {
  const t = state.tasks[id];
  if (!t) return;
  const now = Date.now();
  save({ ...t, archivedAt: now });
  childrenOf(state.tasks, id).forEach((c) => save({ ...c, archivedAt: now }));
}

export function restoreTask(id: string) {
  const t = state.tasks[id];
  if (!t) return;
  const at = t.archivedAt;
  save({ ...t, archivedAt: null });
  Object.values(state.tasks)
    .filter((c) => c.parentId === id && c.archivedAt === at)
    .forEach((c) => save({ ...c, archivedAt: null }));
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
    else if (e instanceof HttpError && e.status >= 400 && e.status < 500) {
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
    set({ user, auth: "in", tasks: read(K.tasks(user.id), {}), ready: localStorage.getItem(K.tasks(user.id)) !== null });
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
  q.forEach((m) => addTask(m.text));
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
