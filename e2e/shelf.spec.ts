import type { Page } from "@playwright/test";
import { addMemo, card, expect, flick, test } from "./fixtures";

const openShelf = async (app: Page, kind: "archive" | "trash") => {
  await app.getByRole("button", { name: "アカウント" }).click();
  await app.getByTestId(`menu-${kind}`).click();
  const shelf = app.getByTestId(`shelf-${kind}`);
  await expect(shelf).toBeVisible();
  return shelf;
};
const closeShelf = (app: Page, kind: "archive" | "trash") =>
  app.getByTestId(`shelf-${kind}`).getByRole("button", { name: "閉じる" }).click();
const serverTitles = async (app: Page) =>
  ((await (await app.request.get("/api/tasks")).json()).tasks as { title: string }[]).map((t) => t.title);

async function makeDone(app: Page, title: string) {
  await app.getByTestId("tab-todo").click();
  await addMemo(app, title);
  await card(app, title).click();
  await app.getByTestId("detail-sheet").getByRole("radio", { name: "完了" }).click();
}

test("done → archive → trash → restore puts it back in the archive; archive → doing", async ({ app }) => {
  await makeDone(app, "卒論の提出");
  await app.getByTestId("detail-sheet").getByTestId("to-archive").click();
  await expect(app.getByTestId("detail-sheet")).toHaveCount(0);

  let shelf = await openShelf(app, "archive");
  await expect(shelf.getByTestId("shelf-item")).toHaveText([/卒論の提出/]);
  await shelf.getByTestId("shelf-to-trash").click();
  await expect(shelf.getByTestId("shelf-item")).toHaveCount(0);
  await closeShelf(app, "archive");

  shelf = await openShelf(app, "trash");
  await expect(shelf).toContainText("30 日で自動的に完全削除されます");
  await shelf.getByTestId("shelf-restore").click();
  await expect(shelf.getByTestId("shelf-empty")).toBeVisible();
  await closeShelf(app, "trash");

  shelf = await openShelf(app, "archive");
  await shelf.getByTestId("shelf-to-doing").click();
  await expect(shelf.getByTestId("shelf-item")).toHaveCount(0);
  await closeShelf(app, "archive");
  await app.getByTestId("tab-doing").click();
  await expect(card(app, "卒論の提出")).toBeVisible();
});

test("delete for good needs two taps and removes it on the server", async ({ app }) => {
  await app.getByTestId("tab-todo").click();
  await addMemo(app, "いらないメモ");
  await flick(app, card(app, "いらないメモ"), -220);
  await expect(app.getByTestId("toast")).toContainText("ゴミ箱に移動しました");

  const shelf = await openShelf(app, "trash");
  const purge = shelf.getByTestId("shelf-purge");
  await purge.click();
  await expect(purge).toHaveText("もう一度で削除");
  await purge.click();
  await expect(shelf.getByTestId("shelf-empty")).toBeVisible();
  await expect.poll(() => serverTitles(app)).not.toContain("いらないメモ");
  // and it stays gone after a reload
  await app.reload();
  await expect(app.getByTestId("tab-todo")).toBeVisible();
  await expect(await serverTitles(app)).not.toContain("いらないメモ");
});

test("empty the trash", async ({ app }) => {
  await app.getByTestId("tab-todo").click();
  for (const t of ["ごみ1", "ごみ2"]) {
    await addMemo(app, t);
    await flick(app, card(app, t), -220);
    await expect(card(app, t)).toHaveCount(0);
  }
  await addMemo(app, "残すもの");
  const shelf = await openShelf(app, "trash");
  await expect(shelf.getByTestId("shelf-item")).toHaveCount(2);
  await shelf.getByTestId("shelf-empty-trash").click();
  await shelf.getByTestId("shelf-empty-trash").click();
  await expect(shelf.getByTestId("shelf-empty")).toBeVisible();
  await expect.poll(() => serverTitles(app)).toEqual(["残すもの"]);
});

test("a deleted subtask shows under its parent's name and restores under it", async ({ app }) => {
  await app.getByTestId("tab-todo").click();
  await addMemo(app, "旅行");
  await card(app, "旅行").click();
  const sheet = app.getByTestId("detail-sheet");
  await sheet.getByPlaceholder("サブタスク").fill("宿を取る");
  await sheet.getByPlaceholder("サブタスク").press("Enter");
  await sheet.getByTestId("subtask").getByRole("button", { name: "削除" }).click();
  await expect(sheet.getByTestId("subtask")).toHaveCount(0);
  await sheet.getByRole("button", { name: "閉じる" }).click();

  const shelf = await openShelf(app, "trash");
  await expect(shelf.getByTestId("shelf-item")).toContainText("旅行 › 宿を取る");
  await shelf.getByTestId("shelf-restore").click();
  await closeShelf(app, "trash");
  await card(app, "旅行").click();
  await expect(sheet.getByTestId("subtask")).toHaveText([/宿を取る/]);
});
