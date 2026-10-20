import { describe, expect, it } from "vitest";
import type { Task } from "../shared/types";
import { daysUntil, matches, sortTasks } from "../src/sort";

const DAY = "2026-10-21";
let n = 0;
const t = (title: string, o: Partial<Task> = {}): Task => ({
  id: `id-${title}`,
  title,
  note: "",
  status: "todo",
  parentId: null,
  due: null,
  today: null,
  position: 0,
  createdAt: 1000 + n++,
  updatedAt: 0,
  archivedAt: null,
  doneAt: null,
  trashedAt: null,
  ...o,
});
const titles = (list: Task[]) => list.map((x) => x.title);
const ctx = (started: string[] = []) => ({ day: DAY, started: (x: Task) => started.includes(x.title) });

describe("daysUntil", () => {
  it("counts whole days from the app's day", () => {
    expect(daysUntil("2026-10-21", DAY)).toBe(0);
    expect(daysUntil("2026-10-20", DAY)).toBe(-1);
    expect(daysUntil("2026-11-01", DAY)).toBe(11);
  });
});

describe("おすすめ順", () => {
  it("due within 3 days comes first: overdue (oldest first), today, tomorrow, +2, +3", () => {
    const list = [
      t("+3", { due: "2026-10-24" }),
      t("今日", { due: "2026-10-21" }),
      t("昨日まで", { due: "2026-10-20" }),
      t("先週まで", { due: "2026-10-14" }),
      t("明日", { due: "2026-10-22" }),
      t("+2", { due: "2026-10-23" }),
      t("期限なし"),
    ];
    expect(titles(sortTasks(list, "recommended", ctx()))).toEqual(["先週まで", "昨日まで", "今日", "明日", "+2", "+3", "期限なし"]);
  });

  it("started tasks come next, before 4–7 days; but due within 3 days beats started", () => {
    const list = [
      t("4日後", { due: "2026-10-25" }),
      t("着手・期限なし"),
      t("着手・10日後", { due: "2026-10-31" }),
      t("着手・明日", { due: "2026-10-22" }),
      t("着手・5日後", { due: "2026-10-26" }),
    ];
    const order = sortTasks(list, "recommended", ctx(["着手・期限なし", "着手・10日後", "着手・明日", "着手・5日後"]));
    expect(titles(order)).toEqual(["着手・明日", "着手・5日後", "着手・10日後", "着手・期限なし", "4日後"]);
  });

  it("4–7 days before the rest; in the rest, due dates (nearest first) before no due date", () => {
    const list = [
      t("期限なしA"),
      t("8日後", { due: "2026-10-29" }),
      t("7日後", { due: "2026-10-28" }),
      t("30日後", { due: "2026-11-20" }),
      t("4日後", { due: "2026-10-25" }),
      t("期限なしB"),
    ];
    expect(titles(sortTasks(list, "recommended", ctx()))).toEqual(["4日後", "7日後", "8日後", "30日後", "期限なしB", "期限なしA"]);
  });
});

describe("期限順 and 追加順", () => {
  it("期限順: overdue (oldest first), today, later, no due date; progress ignored", () => {
    const list = [t("期限なし"), t("明後日", { due: "2026-10-23" }), t("今日", { due: "2026-10-21" }), t("期限切れ", { due: "2026-10-01" })];
    expect(titles(sortTasks(list, "due", ctx(["期限なし"])))).toEqual(["期限切れ", "今日", "明後日", "期限なし"]);
  });

  it("追加順: newest first, ignoring due dates", () => {
    const list = [t("古い", { due: "2026-10-21" }), t("中"), t("新しい", { due: "2026-12-01" })];
    expect(titles(sortTasks(list, "added", ctx()))).toEqual(["新しい", "中", "古い"]);
  });

  it("ties: newer first, then by id, every time", () => {
    const a = t("a", { due: "2026-10-22", createdAt: 5 });
    const b = t("b", { due: "2026-10-22", createdAt: 9 });
    const c = t("c", { due: "2026-10-22", createdAt: 9, id: "id-0c" });
    for (const mode of ["recommended", "due", "added"] as const) {
      expect(titles(sortTasks([a, b, c], mode, ctx()))).toEqual(["c", "b", "a"]);
      expect(titles(sortTasks([c, a, b], mode, ctx()))).toEqual(["c", "b", "a"]);
    }
  });

  it("does not change the list it was given", () => {
    const list = [t("x"), t("y")];
    const before = titles(list);
    sortTasks(list, "added", ctx());
    expect(titles(list)).toEqual(before);
  });
});

describe("search", () => {
  const task = t("緑化発表資料作成", { note: "来週の会議で使用するスライドを準備。KISC 向け" });
  it("matches the title or the memo, by part", () => {
    for (const q of ["緑化", "発表", "会議", "スライド"]) expect(matches(task, q)).toBe(true);
    expect(matches(task, "予算")).toBe(false);
  });
  it("ignores case and full/half width of letters", () => {
    expect(matches(task, "kisc")).toBe(true);
    expect(matches(task, "ＫＩＳＣ")).toBe(true);
    expect(matches(t("Report"), "rEPO")).toBe(true);
  });
  it("an empty or blank query matches everything", () => {
    expect(matches(task, "")).toBe(true);
    expect(matches(task, "  ")).toBe(true);
  });
});
