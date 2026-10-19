import { addMemo, card, expect, test } from "./fixtures";

// 1x1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("a note is saved as you type and survives a reload", async ({ app }) => {
  await addMemo(app, "台湾遠征の準備");
  await card(app, "台湾遠征の準備").click();
  const sheet = app.getByTestId("detail-sheet");
  await sheet.getByTestId("note").fill("集合 7:00 中部国際空港\nパスポート忘れない");
  await sheet.getByRole("button", { name: "閉じる" }).click();
  await expect(card(app, "台湾遠征の準備").getByTestId("has-note")).toBeVisible();

  await expect
    .poll(async () => (await (await app.request.get("/api/tasks")).json()).tasks[0]?.note)
    .toBe("集合 7:00 中部国際空港\nパスポート忘れない");
  await app.reload();
  await card(app, "台湾遠征の準備").click();
  await expect(app.getByTestId("detail-sheet").getByTestId("note")).toHaveValue("集合 7:00 中部国際空港\nパスポート忘れない");
});

test("attach a photo and a file, view, then delete with two taps", async ({ app }) => {
  await addMemo(app, "資料をまとめる");
  await card(app, "資料をまとめる").click();
  const sheet = app.getByTestId("detail-sheet");

  await sheet.getByTestId("attach-input").setInputFiles([
    { name: "photo.png", mimeType: "image/png", buffer: PNG },
    { name: "メモ.txt", mimeType: "text/plain", buffer: Buffer.from("hello") },
  ]);
  await expect(sheet.getByTestId("attachment")).toHaveCount(2);
  await expect(sheet.getByTestId("attachment-uploading")).toHaveCount(0);
  await expect(sheet.getByText("メモ.txt")).toBeVisible();

  // the photo really loads from the server
  const img = sheet.getByTestId("attachment").locator("img");
  await expect(img).toHaveJSProperty("complete", true);
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);

  await img.click();
  await expect(app.getByTestId("lightbox")).toBeVisible();
  await app.getByTestId("lightbox").click();
  await expect(app.getByTestId("lightbox")).toHaveCount(0);

  await sheet.getByRole("button", { name: "閉じる" }).click();
  await expect(card(app, "資料をまとめる").getByTestId("has-files")).toHaveText("2");

  await card(app, "資料をまとめる").click();
  const del = app.getByTestId("detail-sheet").getByTestId("attachment-delete").first();
  await del.click();
  await expect(del).toHaveText("削除");
  await del.click();
  await expect(app.getByTestId("detail-sheet").getByTestId("attachment")).toHaveCount(1);

  // survives a reload: the server agrees
  await app.reload();
  await expect(card(app, "資料をまとめる").getByTestId("has-files")).toHaveText("1");
});
