import type { Page } from "@playwright/test";
import { addMemo, card, expect, test } from "./fixtures";

const DOC = {
  id: "abc123",
  name: "旅程表",
  mimeType: "application/vnd.google-apps.document",
  url: "https://docs.google.com/document/d/abc123/edit",
};

/** Stand-ins for Google: a connected Drive token and a picker that returns DOC. */
async function fakeGoogle(page: Page) {
  await page.route("**/api/drive/token", (r) =>
    r.fulfill({ json: { accessToken: "ya29.test", apiKey: "test-key", appId: "123" } }),
  );
  await page.addInitScript((doc) => {
    window.__flickDrivePicker = async () => [doc];
  }, DOC);
  await page.context().route("https://docs.google.com/**", (r) => r.fulfill({ body: "drive" }));
}

test("attach a Google Drive file as a link that opens Drive", async ({ app }) => {
  await fakeGoogle(app);
  await app.reload();
  await addMemo(app, "台湾遠征の準備");
  await card(app, "台湾遠征の準備").click();
  const sheet = app.getByTestId("detail-sheet");

  await sheet.getByTestId("attach-drive").click();
  const linkTile = sheet.getByTestId("drive-link");
  await expect(linkTile).toContainText("旅程表");
  await expect(linkTile).toContainText("ドライブ");

  const [popup] = await Promise.all([app.waitForEvent("popup"), linkTile.click()]);
  expect(popup.url()).toBe(DOC.url);
  await popup.close();

  await sheet.getByRole("button", { name: "閉じる" }).click();
  await expect(card(app, "台湾遠征の準備").getByTestId("has-files")).toHaveText("1");
  // stored on the server, no bytes uploaded
  await app.reload();
  await card(app, "台湾遠征の準備").click();
  await expect(app.getByTestId("detail-sheet").getByTestId("drive-link")).toContainText("旅程表");
});

test("first use sends you to connect Drive for your Flick account", async ({ app }) => {
  await app.route("**/api/drive/connect", (r) => r.fulfill({ body: "connect" }));
  await addMemo(app, "資料");
  await card(app, "資料").click();
  await app.getByTestId("detail-sheet").getByTestId("attach-drive").click();
  await app.waitForURL("**/api/drive/connect");
});

test("after connecting, the task reopens with the picker", async ({ app }) => {
  await addMemo(app, "見積もり");
  const id = await card(app, "見積もり").getAttribute("data-id");
  await fakeGoogle(app);
  await app.evaluate((taskId) => sessionStorage.setItem("flick:v1:drive-return", taskId!), id);
  await app.goto("/?drive=connected");
  await expect(app.getByTestId("toast")).toContainText("ドライブと連携しました");
  const sheet = app.getByTestId("detail-sheet");
  await expect(sheet.getByTestId("drive-link")).toContainText("旅程表");
  await expect(app).toHaveURL(/\/$/);
});
