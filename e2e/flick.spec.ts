import { addMemo, card, expect, flick, test } from "./fixtures";

test("flick right moves a task forward, left moves it back", async ({ app }) => {
  await addMemo(app, "資料を作る");

  await flick(app, card(app, "資料を作る"), 220);
  await expect(app.getByTestId("count-todo")).toHaveText("0");
  await expect(app.getByTestId("count-doing")).toHaveText("1");
  await expect(app.getByTestId("detail-sheet")).toHaveCount(0);

  await app.getByTestId("tab-doing").click();
  await expect(card(app, "資料を作る")).toHaveAttribute("data-status", "doing");
  await flick(app, card(app, "資料を作る"), 220);
  await expect(app.getByTestId("count-done")).toHaveText("1");

  await app.getByTestId("tab-done").click();
  await flick(app, card(app, "資料を作る"), -220);
  await expect(app.getByTestId("count-doing")).toHaveText("1");
  await expect(app.getByTestId("count-done")).toHaveText("0");
});

test("a short drag snaps back without changing status", async ({ app }) => {
  await addMemo(app, "ちょっとだけ");
  await flick(app, card(app, "ちょっとだけ"), 40);
  await expect(app.getByTestId("count-todo")).toHaveText("1");
  await expect(card(app, "ちょっとだけ")).toBeVisible();
});

test("flick left on a todo moves it to the trash and undo restores it", async ({ app }) => {
  await addMemo(app, "いらないタスク");
  await app.getByTestId("tab-todo").click();
  await flick(app, card(app, "いらないタスク"), -220);
  await expect(card(app, "いらないタスク")).toHaveCount(0);
  const toast = app.getByTestId("toast");
  await expect(toast).toContainText("ゴミ箱に移動しました");
  await toast.getByRole("button", { name: "元に戻す" }).click();
  await expect(card(app, "いらないタスク")).toBeVisible();
});

test("status change persists after reload", async ({ app }) => {
  await addMemo(app, "永続化");
  await flick(app, card(app, "永続化"), 220);
  await expect(app.getByTestId("count-doing")).toHaveText("1");
  await expect
    .poll(async () => (await (await app.request.get("/api/tasks")).json()).tasks[0]?.status)
    .toBe("doing");
});
