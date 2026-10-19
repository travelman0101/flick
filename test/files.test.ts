import { describe, expect, it } from "vitest";
import { call, login, task } from "./helpers";

const put = (id: string, body: unknown, cookie: string) =>
  call(`/api/tasks/${id}`, { method: "PUT", cookie, body: JSON.stringify(body) });

const upload = (taskId: string, cookie: string, bytes: Uint8Array, name = "写真.png", type = "image/png", env = {}) =>
  call(`/api/tasks/${taskId}/attachments`, {
    method: "POST",
    cookie,
    body: bytes as unknown as BodyInit,
    headers: { "content-type": type, "x-file-name": encodeURIComponent(name) },
    env,
  });

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

describe("task notes", () => {
  it("stores and returns a note, defaulting to empty", async () => {
    const cookie = await login("n1");
    await put("m1", task(), cookie);
    let list = ((await (await call("/api/tasks", { cookie })).json()) as any).tasks;
    expect(list[0].note).toBe("");
    await put("m1", task({ note: "持ち物: パスポート\n集合 7:00", updatedAt: Date.now() + 1 }), cookie);
    list = ((await (await call("/api/tasks", { cookie })).json()) as any).tasks;
    expect(list[0].note).toBe("持ち物: パスポート\n集合 7:00");
  });

  it("rejects a note that is too long", async () => {
    const cookie = await login("n2");
    expect((await put("m2", task({ note: "あ".repeat(10_001) }), cookie)).status).toBe(400);
  });
});

describe("attachments", () => {
  it("uploads, lists, downloads and deletes a file", async () => {
    const cookie = await login("f1");
    await put("t1", task(), cookie);
    const res = await upload("t1", cookie, png);
    expect(res.status).toBe(200);
    const { attachment } = (await res.json()) as any;
    expect(attachment).toMatchObject({ taskId: "t1", name: "写真.png", type: "image/png", size: png.length });

    const list = ((await (await call("/api/tasks/t1/attachments", { cookie })).json()) as any).attachments;
    expect(list).toHaveLength(1);
    const tasks = ((await (await call("/api/tasks", { cookie })).json()) as any).tasks;
    expect(tasks[0].attachmentCount).toBe(1);

    const file = await call(`/api/attachments/${attachment.id}`, { cookie });
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(png);

    expect((await call(`/api/attachments/${attachment.id}`, { method: "DELETE", cookie })).status).toBe(200);
    expect((await call(`/api/attachments/${attachment.id}`, { cookie })).status).toBe(404);
  });

  it("serves risky types as sandboxed downloads", async () => {
    const cookie = await login("f2");
    await put("t2", task(), cookie);
    const html = new TextEncoder().encode("<script>alert(1)</script>");
    const { attachment } = (await (await upload("t2", cookie, html, "x.html", "text/html")).json()) as any;
    const file = await call(`/api/attachments/${attachment.id}`, { cookie });
    expect(file.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(file.headers.get("content-security-policy")).toContain("sandbox");
    expect(file.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("keeps other users out", async () => {
    const alice = await login("f3a");
    const mallory = await login("f3m");
    await put("t3", task(), alice);
    const { attachment } = (await (await upload("t3", alice, png)).json()) as any;
    expect((await call(`/api/attachments/${attachment.id}`, { cookie: mallory })).status).toBe(404);
    expect((await call(`/api/attachments/${attachment.id}`, { method: "DELETE", cookie: mallory })).status).toBe(404);
    expect((await call("/api/tasks/t3/attachments", { cookie: mallory })).status).toBe(404);
    expect((await upload("t3", mallory, png)).status).toBe(404);
  });

  it("enforces the per-file size limit and the per-user quota", async () => {
    const cookie = await login("f4");
    await put("t4", task(), cookie);
    expect((await upload("t4", cookie, new Uint8Array(20), "a.bin", "application/octet-stream", { FILE_MAX_BYTES: "10" })).status).toBe(413);
    const env = { USER_QUOTA_BYTES: "30" };
    expect((await upload("t4", cookie, new Uint8Array(20), "a.bin", "application/octet-stream", env)).status).toBe(200);
    expect((await upload("t4", cookie, new Uint8Array(20), "b.bin", "application/octet-stream", env)).status).toBe(507);
  });

  it("requires login and same-origin writes", async () => {
    expect((await call("/api/attachments/x")).status).toBe(401);
    const cookie = await login("f5");
    await put("t5", task(), cookie);
    const res = await call("/api/tasks/t5/attachments", {
      method: "POST",
      cookie,
      body: png as unknown as BodyInit,
      headers: { origin: "https://evil.example", "x-file-name": "a.png", "content-type": "image/png" },
    });
    expect(res.status).toBe(403);
  });
});
