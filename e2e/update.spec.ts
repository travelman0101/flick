import type { Page } from "@playwright/test";
import { addMemo, card, expect, test } from "./fixtures";

/** Make sure the service worker controls the page, as on every launch after the first. */
async function controlled(app: Page) {
  await app.evaluate(() => navigator.serviceWorker.ready);
  // a page that was open before the worker claimed it counts as a first install: start a fresh launch
  await app.reload();
  await expect.poll(() => app.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(app.getByTestId("tab-todo")).toBeVisible();
}
/** What the browser does when a new version's service worker takes over. */
const newVersion = (app: Page) => app.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event("controllerchange")));
const mark = (app: Page) => app.evaluate(() => ((window as unknown as { oldPage: boolean }).oldPage = true));
const isOldPage = (app: Page) => app.evaluate(() => (window as unknown as { oldPage?: boolean }).oldPage === true);

test("a new version reloads the open app by itself", async ({ app }) => {
  await controlled(app);
  await mark(app);
  await newVersion(app);
  await expect.poll(() => isOldPage(app).catch(() => true)).toBe(false);
  await expect(app.getByTestId("tab-todo")).toBeVisible();
});

test("it waits while a title is being typed, then reloads without losing it", async ({ app }) => {
  await controlled(app);
  await addMemo(app, "旧タイトル");
  await card(app, "旧タイトル").click();
  const title = app.getByTestId("detail-sheet").getByLabel("タイトル");
  await title.fill("新しいタイトル");
  await mark(app);
  await newVersion(app);
  await app.waitForTimeout(800);
  expect(await isOldPage(app)).toBe(true);

  // done typing: the title saves on blur, then the new version loads
  await title.blur();
  await expect.poll(() => isOldPage(app).catch(() => true)).toBe(false);
  await app.getByTestId("tab-todo").click();
  await expect(card(app, "新しいタイトル")).toBeVisible();
});
