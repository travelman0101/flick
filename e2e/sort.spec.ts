import type { Page } from "@playwright/test";
import { card, cards, expect, test } from "./fixtures";

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** the app's day starts at 04:00 */
const day = (offset: number) => {
  const d = new Date(Date.now() - 4 * 3_600_000);
  d.setDate(d.getDate() + offset);
  return ymd(d);
};

interface Seed {
  title: string;
  note?: string;
  due?: number;
  /** one done subtask: the task is started */
  started?: boolean;
}

/** Tasks made on earlier days, oldest first (createdAt increases down the list). */
async function seed(app: Page, list: Seed[]) {
  const origin = new URL(app.url()).origin;
  const base = Date.now() - 10_000_000;
  for (const [i, s] of list.entries()) {
    const id = `s-${i}-${Math.random().toString(36).slice(2, 8)}`;
    const row = (o: Record<string, unknown>) => ({
      note: "",
      status: "todo",
      parentId: null,
      due: null,
      today: null,
      position: base + i,
      createdAt: base + i * 1000,
      updatedAt: base + i * 1000,
      archivedAt: null,
      ...o,
    });
    const put = async (taskId: string, data: Record<string, unknown>) =>
      expect((await app.request.put(`/api/tasks/${taskId}`, { headers: { origin }, data })).ok()).toBe(true);
    await put(id, row({ title: s.title, note: s.note ?? "", due: s.due === undefined ? null : day(s.due) }));
    if (s.started) await put(`${id}-sub`, row({ title: "下ごしらえ", parentId: id, status: "done" }));
  }
  await app.reload();
}

const planItems = (app: Page) => app.getByTestId("plan").getByTestId("plan-item").locator(".plan-title");
/** the screen on show: during a tab switch the outgoing one is still animating out */
const shown = (app: Page) => app.locator('[data-testid="plan"], [data-testid^="list-"]:not([data-exiting])').last();
const chooseSort = async (app: Page, label: string, scope = shown(app)) => {
  await scope.getByTestId("sort-button").click();
  await scope.getByTestId("sort-option").filter({ hasText: label }).click();
  await expect(scope.getByTestId("sort-button")).toContainText(label);
};

const ORDER_SEED: Seed[] = [
  { title: "期限なし" },
  { title: "来月まで", due: 30 },
  { title: "着手済み", started: true },
  { title: "明日まで", due: 1 },
  { title: "5日後まで", due: 5 },
  { title: "期限切れ", due: -2 },
];

test("morning pick: search by title and memo, ignoring case and width; clear; no match", async ({ app }) => {
  await seed(app, [
    { title: "緑化発表資料作成", note: "来週の会議で使用するスライドを準備" },
    { title: "KISC詳細確認" },
    { title: "牛乳を買う" },
  ]);
  const search = app.getByTestId("plan").getByTestId("search");
  await expect(search).toHaveAttribute("placeholder", "タスク名・メモを検索");
  for (const q of ["緑化", "発表", "会議", "スライド"]) {
    await search.fill(q);
    await expect(planItems(app)).toHaveText(["緑化発表資料作成"]);
  }
  await search.fill("ｋｉｓｃ");
  await expect(planItems(app)).toHaveText(["KISC詳細確認"]);
  await search.fill("予算");
  await expect(app.getByTestId("no-match")).toHaveText("一致するタスクがありません");
  await app.getByTestId("search-clear").click();
  await expect(search).toHaveValue("");
  await expect(planItems(app)).toHaveCount(3);
});

test("morning pick: おすすめ順 by default; 期限順 and 追加順 apply at once and are kept after reload", async ({ app }) => {
  await seed(app, ORDER_SEED);
  await expect(app.getByTestId("sort-button")).toContainText("おすすめ順");
  await expect(planItems(app)).toHaveText(["期限切れ", "明日まで", "着手済み", "5日後まで", "来月まで", "期限なし"]);
  // overdue is due today or earlier: it is in today automatically
  await expect(app.getByTestId("plan-item").filter({ hasText: "期限切れ" }).getByTestId("plan-auto")).toHaveText("自動");

  await chooseSort(app, "期限順");
  await expect(planItems(app)).toHaveText(["期限切れ", "明日まで", "5日後まで", "来月まで", "着手済み", "期限なし"]);
  await chooseSort(app, "追加順");
  await expect(planItems(app)).toHaveText(["期限切れ", "5日後まで", "明日まで", "着手済み", "来月まで", "期限なし"]);

  await app.reload();
  await expect(app.getByTestId("sort-button")).toContainText("追加順");
  await expect(app.getByTestId("sort-option")).toHaveCount(0);
  await app.getByTestId("sort-button").click();
  await expect(app.getByTestId("sort-option").filter({ hasText: "追加順" })).toHaveAttribute("aria-checked", "true");
});

test("morning pick: choices and the search survive sort changes, and tapping never reorders", async ({ app }) => {
  await seed(app, ORDER_SEED);
  await expect(planItems(app)).toHaveCount(ORDER_SEED.length);
  const before = await planItems(app).allTextContents();
  const tomorrow = app.getByTestId("plan-item").filter({ hasText: "明日まで" });
  await tomorrow.click();
  await expect(tomorrow).toHaveAttribute("aria-pressed", "true");
  await expect(planItems(app)).toHaveText(before);

  const search = app.getByTestId("plan").getByTestId("search");
  await search.fill("まで");
  await expect(planItems(app)).toHaveText(["明日まで", "5日後まで", "来月まで"]);
  await chooseSort(app, "追加順");
  await expect(search).toHaveValue("まで");
  await expect(planItems(app)).toHaveText(["5日後まで", "明日まで", "来月まで"]);
  await expect(tomorrow).toHaveAttribute("aria-pressed", "true");

  // the choice made under a search counts when the day starts
  await app.getByTestId("search-clear").click();
  await app.getByTestId("plan-start").click();
  await expect(card(app, "明日まで")).toBeVisible();
});

test("タスク tab: 追加順 by default, search and sort work, and the choice is kept", async ({ app }) => {
  await seed(app, ORDER_SEED);
  await app.getByTestId("tab-todo").click();
  const list = app.getByTestId("list-todo");
  const titles = cards(app).locator(".card-title");
  await expect(list.getByTestId("sort-button")).toContainText("追加順");
  await expect(titles).toHaveText(["期限切れ", "5日後まで", "明日まで", "着手済み", "来月まで", "期限なし"]);

  await chooseSort(app, "おすすめ順", list);
  await expect(titles).toHaveText(["期限切れ", "明日まで", "着手済み", "5日後まで", "来月まで", "期限なし"]);
  await list.getByTestId("search").fill("着手");
  await expect(titles).toHaveText(["着手済み"]);
  await list.getByTestId("search").fill("ない言葉");
  await expect(list.getByTestId("no-match")).toHaveText("一致するタスクがありません");

  await app.reload();
  await app.getByTestId("tab-todo").click();
  await expect(list.getByTestId("sort-button")).toContainText("おすすめ順");
  await expect(list.getByTestId("search")).toHaveValue("");
});
