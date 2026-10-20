import { addMemo, card, clickSettled, expect, test } from "./fixtures";

// 1x1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("a note is saved as you type and survives a reload", async ({ app }) => {
  await addMemo(app, "台湾遠征の準備");
  await card(app, "台湾遠征の準備").click();
  const sheet = app.getByTestId("detail-sheet");
  await sheet.getByTestId("note-toggle").click();
  await sheet.getByTestId("note").fill("集合 7:00 中部国際空港\nパスポート忘れない");
  await sheet.getByRole("button", { name: "閉じる" }).click();
  await expect(card(app, "台湾遠征の準備").getByTestId("has-note")).toBeVisible();

  await expect
    .poll(async () => (await (await app.request.get("/api/tasks")).json()).tasks[0]?.note)
    .toBe("集合 7:00 中部国際空港\nパスポート忘れない");
  await app.reload();
  await card(app, "台湾遠征の準備").click();
  // folded by default: only the heading and the first line
  await expect(app.getByTestId("detail-sheet").getByTestId("note")).toHaveCount(0);
  await expect(app.getByTestId("detail-sheet").getByTestId("note-peek")).toHaveText("集合 7:00 中部国際空港");
  await app.getByTestId("detail-sheet").getByTestId("note-toggle").click();
  // opens as a formatted read view; tap to edit
  await app.getByTestId("detail-sheet").getByTestId("note-view").click();
  await expect(app.getByTestId("detail-sheet").getByTestId("note")).toHaveValue("集合 7:00 中部国際空港\nパスポート忘れない");
});

test("AI tidies a dictated note: preview first, replace, then undo", async ({ app }) => {
  await addMemo(app, "合宿の連絡");
  await card(app, "合宿の連絡").click();
  const sheet = app.getByTestId("detail-sheet");
  await sheet.getByTestId("note-toggle").click();
  const raw = "えーと集合は7時。パスポートを忘れない";
  await sheet.getByTestId("note").fill(raw);
  const savedNote = async () =>
    (await (await app.request.get("/api/tasks")).json()).tasks.find((t: { title: string }) => t.title === "合宿の連絡")?.note;

  await clickSettled(sheet.getByTestId("tidy"));
  const preview = sheet.getByTestId("tidy-preview");
  await expect(preview.getByRole("heading", { name: "整理したメモ" })).toBeVisible();
  // nothing changes until confirmed
  await expect(sheet.getByTestId("note")).toHaveValue(raw);

  // cancelling keeps the original
  await preview.getByTestId("tidy-cancel").click();
  await expect(preview).toHaveCount(0);
  await expect(sheet.getByTestId("note")).toHaveValue(raw);

  await clickSettled(sheet.getByTestId("tidy"));
  await sheet.getByTestId("tidy-apply").click();
  const view = sheet.getByTestId("note-view");
  await expect(view.getByRole("heading", { name: "整理したメモ" })).toBeVisible();
  await expect(view.getByRole("listitem")).toHaveText(["えーと集合は7時", "パスポートを忘れない"]);
  await expect.poll(savedNote).toContain("## 整理したメモ");

  // folded peek shows plain text, not Markdown symbols
  await sheet.getByTestId("note-toggle").click();
  await expect(sheet.getByTestId("note-peek")).toHaveText("整理したメモ");

  await app.getByTestId("toast").getByRole("button", { name: "元に戻す" }).click();
  await expect(sheet.getByTestId("note-peek")).toHaveText(raw);
  await expect.poll(savedNote).toBe(raw);
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

  // Esc closes the photo but keeps the sheet open
  await img.click();
  await expect(app.getByTestId("lightbox")).toBeVisible();
  await app.keyboard.press("Escape");
  await expect(app.getByTestId("lightbox")).toHaveCount(0);
  await expect(sheet).toBeVisible();

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

test("a long note stays folded so subtasks are visible right away", async ({ app }) => {
  await addMemo(app, "長いメモのタスク");
  await card(app, "長いメモのタスク").click();
  const sheet = app.getByTestId("detail-sheet");
  await sheet.getByTestId("note-toggle").click();
  await sheet.getByTestId("note").fill(Array.from({ length: 40 }, (_, i) => `${i + 1} 行目のメモ`).join("\n"));
  await sheet.getByPlaceholder("サブタスク").fill("最初の一歩");
  await sheet.getByPlaceholder("サブタスク").press("Enter");
  await sheet.getByRole("button", { name: "閉じる" }).click();

  await card(app, "長いメモのタスク").click();
  await expect(sheet.getByTestId("note-toggle")).toHaveAttribute("aria-expanded", "false");
  await expect(sheet.getByTestId("note-toggle")).toContainText("字");
  await expect(sheet.getByTestId("subtask").first()).toBeInViewport();
});
