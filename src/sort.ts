import type { Task } from "../shared/types";

/**
 * Display order for task lists (morning pick, タスク tab). Pure: never changes the tasks.
 * Days are counted from the app's day (it starts at 04:00 local time).
 */
export type SortMode = "recommended" | "due" | "added";
export const SORT_MODES: SortMode[] = ["recommended", "due", "added"];
export const SORT_LABEL: Record<SortMode, string> = { recommended: "おすすめ順", due: "期限順", added: "追加順" };

const toUtc = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
/** Whole days from day to due: 0 = today, -1 = yesterday (overdue), 3 = three days later. */
export const daysUntil = (due: string, day: string) => Math.round((toUtc(due) - toUtc(day)) / 86_400_000);

/** Same order for equal keys every time: newer first, then by id. */
const tie = (a: Task, b: Task) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** Due dates ascending (YYYY-MM-DD compares as text), no due date last. */
const byDue = (a: Task, b: Task) => (a.due === b.due ? 0 : a.due === null ? 1 : b.due === null ? -1 : a.due < b.due ? -1 : 1);

export interface SortContext {
  day: string;
  /** at least one subtask done */
  started: (t: Task) => boolean;
}

/**
 * おすすめ順 groups:
 * 1 due within 3 days (overdue first, oldest first) · 2 started · 3 due in 4–7 days · 4 the rest (with a due date first).
 */
function group(t: Task, ctx: SortContext) {
  const d = t.due === null ? null : daysUntil(t.due, ctx.day);
  if (d !== null && d <= 3) return 1;
  if (ctx.started(t)) return 2;
  if (d !== null && d <= 7) return 3;
  return 4;
}

export function sortTasks(list: Task[], mode: SortMode, ctx: SortContext): Task[] {
  const out = [...list];
  if (mode === "added") return out.sort(tie);
  if (mode === "due") return out.sort((a, b) => byDue(a, b) || tie(a, b));
  const g = new Map(out.map((t) => [t.id, group(t, ctx)]));
  return out.sort((a, b) => g.get(a.id)! - g.get(b.id)! || byDue(a, b) || tie(a, b));
}

/** Lowercase and fold full-width letters and digits (ＫＩＳＣ → kisc) so search ignores case and width. */
export const normalize = (s: string) => s.normalize("NFKC").toLowerCase();

/** Substring match on the title or the note. An empty query matches everything. */
export function matches(t: Task, query: string) {
  const q = normalize(query.trim());
  if (!q) return true;
  return normalize(t.title).includes(q) || normalize(t.note).includes(q);
}
