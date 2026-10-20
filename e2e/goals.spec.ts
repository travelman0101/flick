import type { Locator, Page } from "@playwright/test";
import { addMemo, card, expect, flick, test } from "./fixtures";

const sheetOf = (app: Page) => app.getByTestId("detail-sheet");
const close = (app: Page) => sheetOf(app).getByRole("button", { name: "閉じる" }).click();

async function addSubs(sheet: Locator, titles: string[]) {
  const input = sheet.getByPlaceholder("サブタスク");
  for (const t of titles) {
    await input.fill(t);
    await input.press("Enter");
  }
  await expect(sheet.getByTestId("subtask")).toHaveCount(titles.length);
}
const sub = (sheet: Locator, title: string) => sheet.getByTestId("subtask").filter({ hasText: title });
const tick = (sheet: Locator, title: string) => sub(sheet, title).getByRole("button", { name: /完了にする|未完了に戻す/ }).click();
const dot = (app: Page, title: string) => card(app, title).getByTestId("status-dot");

test("report with 4 subtasks: today's goal is 2 of them, so finishing those is done for today at 50%", async ({ app }) => {
  // the app opens on Today: a memo here is picked for today
  await addMemo(app, "レポート作成");
  await card(app, "レポート作成").click();
  const sheet = sheetOf(app);
  await addSubs(sheet, ["資料収集", "構成作成", "本文執筆", "推敲"]);
  await expect(sheet.getByTestId("goal-hint")).toHaveText("今日やる分をタップ");

  await sub(sheet, "資料収集").getByTestId("goal-toggle").click();
  await sub(sheet, "構成作成").getByTestId("goal-toggle").click();
  await expect(sub(sheet, "資料収集").getByTestId("goal-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect(sheet.getByTestId("goal-progress")).toHaveText("今日 0/2");
  await expect(sheet.getByTestId("goal-hint")).toHaveCount(0);

  await tick(sheet, "資料収集");
  await tick(sheet, "構成作成");
  await expect(sheet.getByTestId("goal-progress")).toHaveText("今日 2/2");
  await expect(sheet.getByTestId("sub-progress")).toHaveText("全体 2/4");
  await close(app);

  const report = card(app, "レポート作成");
  // still 未完了 as a whole: there is no "doing" status any more
  await expect(report).toHaveAttribute("data-status", "todo");
  await expect(report.getByTestId("goal-chip")).toHaveText("今日分 完了");
  await expect(dot(app, "レポート作成")).toHaveAttribute("data-progress", "50");
  await expect(app.getByTestId("today-progress")).toHaveText("1 / 1 達成");
  await expect(app.getByTestId("count-today")).toHaveText("0");

  // goals can change later: adding one more makes today unfinished again
  await report.click();
  await sub(sheet, "本文執筆").getByTestId("goal-toggle").click();
  await expect(sheet.getByTestId("goal-progress")).toHaveText("今日 2/3");
  await close(app);
  await expect(report.getByTestId("goal-chip")).toHaveText("今日 2/3");
  await expect(app.getByTestId("today-progress")).toHaveText("0 / 1 達成");

  // and they are saved: subtasks carry today's date
  await expect
    .poll(async () => {
      const { tasks } = await (await app.request.get("/api/tasks")).json();
      return tasks.filter((t: { parentId: string | null; today: string | null }) => t.parentId && t.today).length;
    })
    .toBe(3);
});

test("the progress icon fills with done subtasks and recalculates on undo and delete", async ({ app }) => {
  await app.getByTestId("tab-todo").click();
  await addMemo(app, "引っ越し");
  await card(app, "引っ越し").click();
  const sheet = sheetOf(app);
  await addSubs(sheet, ["段ボール", "荷造り", "住所変更", "掃除"]);
  await close(app);
  await expect(dot(app, "引っ越し")).toHaveAttribute("data-progress", "0");
  await card(app, "引っ越し").click();
  await tick(sheet, "段ボール");
  await close(app);
  await expect(dot(app, "引っ越し")).toHaveAttribute("data-progress", "25");
  await expect(card(app, "引っ越し")).toHaveAttribute("data-status", "todo");
  await card(app, "引っ越し").click();
  await tick(sheet, "荷造り");
  await close(app);
  await expect(dot(app, "引っ越し")).toHaveAttribute("data-progress", "50");

  await card(app, "引っ越し").click();
  await tick(sheet, "荷造り"); // undo
  await sub(sheet, "掃除").getByRole("button", { name: "削除" }).click();
  await expect(sheet.getByTestId("sub-progress")).toHaveText("全体 1/3");
  await close(app);
  await expect(dot(app, "引っ越し")).toHaveAttribute("data-progress", "33");
  await expect(card(app, "引っ越し")).toContainText("1/3");
});

test("finishing subtasks or setting a due date never changes the status by itself", async ({ app }) => {
  await app.getByTestId("tab-todo").click();
  await addMemo(app, "願書を出す");
  await card(app, "願書を出す").click();
  const sheet = sheetOf(app);
  await sheet.getByLabel("期限").fill("2026-12-01");
  // a tap right after the date picker closes must not change the status (iPhone)
  await sheet.getByRole("radio", { name: "完了", exact: true }).click();
  await expect(sheet.getByRole("radio", { name: "未完了" })).toHaveAttribute("aria-checked", "true");
  await close(app);
  await expect(card(app, "願書を出す")).toHaveAttribute("data-status", "todo");

  await card(app, "願書を出す").click();
  await addSubs(sheet, ["写真を撮る"]);
  await tick(sheet, "写真を撮る");
  await expect(app.getByTestId("toast").filter({ hasText: "すべて完了。タスクも完了にする？" })).toBeVisible();
  await expect(sheet.getByRole("radio", { name: "未完了" })).toHaveAttribute("aria-checked", "true");
  // accepting the offer finishes the whole task
  await app.getByTestId("toast").filter({ hasText: "すべて完了" }).getByRole("button", { name: "完了にする" }).click();
  await expect(sheet.getByTestId("to-todo")).toBeVisible();
  await close(app);
  await app.getByTestId("tab-done").click();
  await expect(card(app, "願書を出す")).toBeVisible();
});

test("postpone keeps progress, and undo brings back today and its goals", async ({ app }) => {
  await addMemo(app, "部屋の片づけ");
  await card(app, "部屋の片づけ").click();
  const sheet = sheetOf(app);
  await addSubs(sheet, ["机", "本棚"]);
  await sub(sheet, "机").getByTestId("goal-toggle").click();
  await sub(sheet, "本棚").getByTestId("goal-toggle").click();
  await tick(sheet, "机");
  await expect(sheet.getByTestId("goal-progress")).toHaveText("今日 1/2");

  const toggle = sheet.getByTestId("today-toggle");
  await expect(toggle).toHaveText("明日以降に延期");
  await toggle.click();
  // the previous toast may still be fading out
  const postponed = app.getByTestId("toast").filter({ hasText: "延期しました" });
  await expect(postponed).toBeVisible();
  await expect(toggle).toHaveText("今日やるに追加");
  await expect(sheet.getByTestId("goal-toggle")).toHaveCount(0);
  await expect(sheet.getByTestId("sub-progress")).toHaveText("全体 1/2");
  await expect(sheet.getByRole("radio", { name: "未完了" })).toHaveAttribute("aria-checked", "true");

  await postponed.getByRole("button", { name: "元に戻す" }).click();
  await expect(toggle).toHaveText("明日以降に延期");
  await expect(sheet.getByTestId("goal-progress")).toHaveText("今日 1/2");
});

test("done list: right flick keeps it in the archive, left returns it to 未完了", async ({ app }) => {
  await app.getByTestId("tab-todo").click();
  for (const t of ["発表資料", "見積もり"]) {
    await addMemo(app, t);
    await card(app, t).click();
    await sheetOf(app).getByRole("radio", { name: "完了", exact: true }).click();
    // a done task offers exactly these two
    await expect(sheetOf(app).getByTestId("to-todo")).toHaveText("未完了に戻す");
    await expect(sheetOf(app).getByTestId("to-archive")).toHaveText("アーカイブに保存");
    await expect(sheetOf(app).getByRole("radio")).toHaveCount(0);
    await close(app);
  }
  await app.getByTestId("tab-done").click();
  await expect(app.getByTestId("count-done")).toHaveText("2");

  await flick(app, card(app, "発表資料"), 220);
  await expect(app.getByTestId("toast")).toContainText("アーカイブに保存しました");
  await expect(card(app, "発表資料")).toHaveCount(0);

  await flick(app, card(app, "見積もり"), -220);
  await expect(card(app, "見積もり")).toHaveCount(0);
  await app.getByTestId("tab-todo").click();
  await expect(card(app, "見積もり")).toBeVisible();
  await expect(app.getByTestId("count-done")).toHaveText("0");
});

test("the morning pick can set today's goals", async ({ app }) => {
  await app.getByTestId("tab-todo").click();
  await addMemo(app, "大掃除");
  await card(app, "大掃除").click();
  await addSubs(sheetOf(app), ["窓", "床", "換気扇"]);
  await close(app);

  await app.getByTestId("today").click();
  const plan = app.getByTestId("plan");
  await plan.getByTestId("plan-item").filter({ hasText: "大掃除" }).click();
  await expect(plan.getByTestId("plan-goal")).toHaveText(["窓", "床", "換気扇"]);
  await plan.getByTestId("plan-goal").filter({ hasText: "窓" }).click();
  await plan.getByTestId("plan-goal").filter({ hasText: "床" }).click();
  await expect(plan.getByTestId("plan-goal").filter({ hasText: "窓" })).toHaveAttribute("aria-pressed", "true");
  await plan.getByTestId("plan-start").click();

  await expect(card(app, "大掃除").getByTestId("goal-chip")).toHaveText("今日 0/2");
  await card(app, "大掃除").click();
  await expect(sub(sheetOf(app), "窓")).toHaveClass(/goal/);
  await expect(sub(sheetOf(app), "換気扇")).not.toHaveClass(/goal/);
});
