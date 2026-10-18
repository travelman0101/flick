import { addMemo, card, cards, expect, memo, test } from "./fixtures";

test("memo field is focused the moment the app opens", async ({ app }) => {
  await app.goto("/");
  await expect(memo(app)).toBeFocused();
});

test("adds memos with Enter, newest first", async ({ app }) => {
  await addMemo(app, "牛乳を買う");
  await addMemo(app, "企画書を書く");
  await expect(cards(app).first()).toContainText("企画書を書く");
  await expect(app.getByTestId("count-todo")).toHaveText("2");
  await expect(memo(app)).toHaveValue("");
  await expect(memo(app)).toBeFocused();
});

test("multi-line memo becomes one task per line", async ({ app }) => {
  await memo(app).fill("洗濯\n掃除\n買い物");
  await app.getByTestId("send").click();
  await expect(cards(app)).toHaveCount(3);
  // same order as written, even though all three were added in the same millisecond
  await expect(cards(app).locator(".card-title")).toHaveText(["洗濯", "掃除", "買い物"]);
});

test("unsent draft survives a reload", async ({ app }) => {
  await memo(app).pressSequentially("書きかけ");
  await app.reload();
  await expect(memo(app)).toHaveValue("書きかけ");
  await expect(memo(app)).toBeFocused();
});

test("tasks are saved to the server", async ({ app }) => {
  await addMemo(app, "サーバーに保存");
  await expect.poll(async () => (await (await app.request.get("/api/tasks")).json()).tasks.length).toBe(1);
  // wipe the local cache: the list must come back from the API
  await app.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("flick:v1:tasks")).forEach((k) => localStorage.removeItem(k)));
  await app.reload();
  await expect(card(app, "サーバーに保存")).toBeVisible();
});

test("memo typed before the app bundle loads is kept", async ({ app }) => {
  // Block the app bundle to simulate a slow network on open.
  await app.route(/\/assets\/.*\.js$/, (r) => r.abort());
  await app.goto("/");
  await expect(memo(app)).toBeFocused();
  await memo(app).pressSequentially("読み込み前のメモ");
  await memo(app).press("Enter");
  await expect(memo(app)).toHaveValue("");
  await app.unroute(/\/assets\/.*\.js$/);
  await app.reload();
  await expect(card(app, "読み込み前のメモ")).toBeVisible();
});

test("memo sent while the list is still loading is kept", async ({ app }) => {
  await app.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("flick:v1:tasks")).forEach((k) => localStorage.removeItem(k)));
  await app.route("**/api/tasks", async (r) => {
    await new Promise((res) => setTimeout(res, 1500));
    await r.continue();
  });
  await app.goto("/");
  await expect(app.locator(".skeleton-screen")).toBeVisible();
  await memo(app).pressSequentially("ロード中のメモ");
  await memo(app).press("Enter");
  await expect(card(app, "ロード中のメモ")).toBeVisible();
});
