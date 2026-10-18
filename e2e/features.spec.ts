import { addMemo, card, cards, expect, memo, test } from "./fixtures";

test("login screen shows only the app name and the Google button", async ({ page }) => {
  await page.goto("/");
  const login = page.getByTestId("login");
  await expect(login).toBeVisible();
  await expect(login.getByRole("link", { name: "Google でログイン" })).toHaveAttribute("href", "/api/auth/google");
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
  expect(text).toBe("Flick Google でログイン");
  await expect(page.locator("#composer")).toBeHidden();
});

test("first load shows a full-screen skeleton", async ({ app }) => {
  await app.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("flick:v1:tasks")).forEach((k) => localStorage.removeItem(k)));
  await app.route("**/api/tasks", async (r) => {
    await new Promise((res) => setTimeout(res, 1200));
    await r.continue();
  });
  await app.goto("/");
  const sk = app.locator(".skeleton-screen");
  await expect(sk).toBeVisible();
  expect(await sk.locator(".sk").count()).toBeGreaterThanOrEqual(6);
  await expect(app.getByTestId("tab-todo")).toBeVisible();
  await expect(sk).toHaveCount(0);
});

test("AI organize turns a rambling memo into tasks", async ({ app }) => {
  await memo(app).fill("えーと牛乳を買う、あと企画書を送る");
  await app.getByTestId("organize").click();
  const sheet = app.getByTestId("organize-sheet");
  await expect(sheet.getByTestId("organize-item")).toHaveCount(2);
  await sheet.getByTestId("organize-commit").click();
  await expect(cards(app).locator(".card-title")).toHaveText(["えーと牛乳を買う", "企画書を送る"]);
  await expect(app.getByTestId("toast")).toContainText("2 件追加しました");
});

test("task detail: edit status, AI subtasks, archive", async ({ app }) => {
  await addMemo(app, "旅行の準備");
  await card(app, "旅行の準備").click();
  const sheet = app.getByTestId("detail-sheet");
  await expect(sheet).toBeVisible();

  await sheet.getByTestId("suggest").click();
  await expect(sheet.getByTestId("idea")).toHaveCount(3);
  await sheet.getByTestId("ideas-all").click();
  await expect(sheet.getByTestId("subtask")).toHaveCount(3);
  await sheet.getByTestId("subtask").first().getByRole("button", { name: "完了にする" }).click();

  await sheet.getByRole("radio", { name: "進行中" }).click();
  await sheet.getByRole("button", { name: "閉じる" }).click();
  await expect(sheet).toHaveCount(0);
  await app.getByTestId("tab-doing").click();
  await expect(card(app, "旅行の準備")).toContainText("1/3");

  await card(app, "旅行の準備").click();
  await app.getByTestId("detail-sheet").getByRole("button", { name: "アーカイブ" }).click();
  await expect(card(app, "旅行の準備")).toHaveCount(0);
});

test("today suggestions can start a task", async ({ app }) => {
  await addMemo(app, "メールを返す");
  await app.getByTestId("today").click();
  const sheet = app.getByTestId("today-sheet");
  await expect(sheet.getByTestId("today-item")).toHaveCount(1);
  await sheet.getByRole("button", { name: "始める" }).click();
  await expect(app.getByTestId("count-doing")).toHaveText("1");
});

test("logout returns to the login screen", async ({ app }) => {
  await app.getByRole("button", { name: "アカウント" }).click();
  await app.getByRole("button", { name: "ログアウト" }).click();
  await expect(app.getByTestId("login")).toBeVisible();
  expect((await app.request.get("/api/me")).status()).toBe(401);
});

test("no horizontal overflow at phone width", async ({ app }) => {
  await addMemo(app, "とても長いタスク名".repeat(8));
  const overflow = await app.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
