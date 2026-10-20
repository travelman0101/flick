import type { Page } from "@playwright/test";
import { addMemo, card, cards, expect, flick, test } from "./fixtures";

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** logical day as the app computes it: the day starts at 04:00 */
const logical = (offsetDays = 0) => {
  const d = new Date(Date.now() - 4 * 3_600_000);
  d.setDate(d.getDate() + offsetDays);
  return ymd(d);
};

/** Create tasks straight through the API, as if they were made on earlier days. */
async function seed(app: Page, tasks: { title: string; today?: string | null; due?: string | null; status?: string }[]) {
  const base = Date.now() - 100_000;
  for (const [i, t] of tasks.entries()) {
    const res = await app.request.put(`/api/tasks/seed-${i}-${Math.random().toString(36).slice(2, 8)}`, {
      headers: { origin: new URL(app.url()).origin },
      data: {
        title: t.title,
        note: "",
        status: t.status ?? "todo",
        parentId: null,
        due: t.due ?? null,
        today: t.today ?? null,
        position: base + i,
        createdAt: base,
        updatedAt: base + i,
        archivedAt: null,
      },
    });
    expect(res.ok()).toBe(true);
  }
  await app.reload();
}

test("the first open of the day asks what to do today", async ({ app }) => {
  await seed(app, [
    { title: "昨日やり残した資料", today: logical(-1) },
    { title: "期限が今日の申請", due: logical() },
    { title: "牛乳を買う" },
    { title: "部屋の大掃除" },
    { title: "旅行の計画" },
  ]);
  const plan = app.getByTestId("plan");
  await expect(plan).toBeVisible();
  await expect(plan.getByRole("heading", { name: "今日やることを選ぶ" })).toBeVisible();

  const item = (t: string) => plan.getByTestId("plan-item").filter({ hasText: t });
  await expect(item("昨日やり残した資料")).toHaveAttribute("aria-pressed", "true"); // carried over
  await expect(item("期限が今日の申請")).toBeDisabled(); // always in today
  await expect(item("牛乳を買う")).toHaveAttribute("aria-pressed", "false");

  await item("牛乳を買う").click();
  await item("旅行の計画").click();
  await item("昨日やり残した資料").click(); // changed my mind
  await expect(plan.getByTestId("plan-start")).toHaveText("3 件で今日を始める");
  await plan.getByTestId("plan-start").click();

  await expect(app.getByTestId("plan")).toHaveCount(0);
  for (const t of ["期限が今日の申請", "牛乳を買う", "旅行の計画"]) await expect(card(app, t)).toBeVisible();
  await expect(card(app, "部屋の大掃除")).toHaveCount(0);
  await expect(card(app, "昨日やり残した資料")).toHaveCount(0);
  await expect(app.getByTestId("count-today")).toHaveText("3");

  // the rest of the day the app opens straight on Today
  await app.reload();
  await expect(app.getByTestId("today-head")).toBeVisible();
  await expect(app.getByTestId("plan")).toHaveCount(0);
  await expect(card(app, "牛乳を買う")).toBeVisible();
});

test("in Today, flicks change status in place and left postpones", async ({ app }) => {
  await addMemo(app, "報告書を書く");
  await addMemo(app, "メールを返す");
  await expect(app.getByTestId("today-progress")).toHaveText("0 / 2 達成");

  await flick(app, card(app, "報告書を書く"), 220);
  await expect(card(app, "報告書を書く")).toHaveAttribute("data-status", "doing");
  // the card comes back to the same place, it does not jump to the top
  await expect(cards(app).locator(".card-title")).toHaveText(["メールを返す", "報告書を書く"]);
  await flick(app, card(app, "報告書を書く"), 220);
  await expect(card(app, "報告書を書く")).toHaveAttribute("data-status", "done");
  await expect(app.getByTestId("today-progress")).toHaveText("1 / 2 達成");
  await expect(app.getByTestId("count-today")).toHaveText("1");
  // finished tasks sink to the bottom
  await expect(cards(app).last()).toContainText("報告書を書く");

  await flick(app, card(app, "メールを返す"), -220);
  await expect(card(app, "メールを返す")).toHaveCount(0);
  await expect(app.getByTestId("toast")).toContainText("延期しました");
  await app.getByTestId("toast").getByRole("button", { name: "元に戻す" }).click();
  await expect(card(app, "メールを返す")).toBeVisible();

  // switching tabs right after a flick must not lose it; removing from today never archives
  await flick(app, card(app, "メールを返す"), -220);
  await app.getByTestId("tab-todo").click();
  await expect(card(app, "メールを返す")).toBeVisible();
  await expect(card(app, "メールを返す").getByTestId("picked-today")).toHaveCount(0);
});

test("add a task to today from its detail sheet", async ({ app }) => {
  await app.getByTestId("tab-todo").click();
  await addMemo(app, "ジムに行く");
  await card(app, "ジムに行く").click();
  const toggle = app.getByTestId("detail-sheet").getByTestId("today-toggle");
  await expect(toggle).toHaveText("今日やるに追加");
  await toggle.click();
  await expect(toggle).toHaveText("明日以降に延期");
  await app.getByTestId("detail-sheet").getByRole("button", { name: "閉じる" }).click();
  await expect(card(app, "ジムに行く").getByTestId("picked-today")).toBeVisible();
  await app.getByTestId("tab-today").click();
  await expect(card(app, "ジムに行く")).toBeVisible();
});

test("the day rolls over at 04:00, not midnight", async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 9, 21, 3, 30) });
  await page.goto(`/api/auth/dev-login?name=clock-${Date.now().toString(36)}`);
  await expect(page.getByTestId("today-head")).toContainText("10/20(火)");
  await page.clock.setFixedTime(new Date(2026, 9, 21, 4, 5));
  await page.reload();
  await expect(page.getByTestId("today-head")).toContainText("10/21(水)");
});
