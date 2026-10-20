import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Env } from "../worker/env";
import { DONE_KEEP_MS, TRASH_KEEP_MS, sweep } from "../worker/lifecycle";
import { call, login, task } from "./helpers";

const E = env as unknown as Env;
const DAY = 86_400_000;
const put = (id: string, body: unknown, cookie: string) =>
  call(`/api/tasks/${id}`, { method: "PUT", cookie, body: JSON.stringify(body) });
const list = async (cookie: string) => ((await (await call("/api/tasks", { cookie })).json()) as any).tasks as any[];
const byId = async (cookie: string, id: string) => (await list(cookie)).find((t) => t.id === id);
const fakeAI = { run: async () => ({ response: "要約" }), toMarkdown: async () => ({ format: "error" }) } as unknown as Ai;
const upload = (taskId: string, cookie: string) =>
  call(`/api/tasks/${taskId}/attachments`, {
    method: "POST",
    cookie,
    body: "メモ",
    headers: { "content-type": "text/plain", "x-file-name": "a.txt" },
    env: { AI: fakeAI },
  });

describe("lifecycle fields", () => {
  it("keeps done_at and trashed_at, and old clients keep stored values", async () => {
    const cookie = await login("lf1");
    await put("lf1-a", task({ status: "done", doneAt: 5000, trashedAt: null, updatedAt: 10 }), cookie);
    expect(await byId(cookie, "lf1-a")).toMatchObject({ status: "done", doneAt: 5000, trashedAt: null });

    await put("lf1-a", task({ status: "done", trashedAt: 7000, updatedAt: 20 }), cookie);
    // an old client sends neither field: both stay as stored
    const old: Record<string, unknown> = task({ status: "done", title: "改名", updatedAt: 30 });
    delete old.doneAt;
    delete old.trashedAt;
    await put("lf1-a", old, cookie);
    expect(await byId(cookie, "lf1-a")).toMatchObject({ title: "改名", doneAt: 5000, trashedAt: 7000 });
  });

  it("done_at follows the status", async () => {
    const cookie = await login("lf2");
    await put("lf2-a", task({ status: "done", updatedAt: 100 }), cookie);
    expect((await byId(cookie, "lf2-a")).doneAt).toBe(100);
    await put("lf2-a", task({ status: "doing", doneAt: 100, updatedAt: 200 }), cookie);
    expect((await byId(cookie, "lf2-a")).doneAt).toBeNull();
  });

  it("returns archived and trashed tasks", async () => {
    const cookie = await login("lf3");
    await put("lf3-a", task({ status: "done", archivedAt: 1 }), cookie);
    await put("lf3-b", task({ trashedAt: 2 }), cookie);
    const tasks = await list(cookie);
    expect(tasks.find((t) => t.id === "lf3-a").archivedAt).toBe(1);
    expect(tasks.find((t) => t.id === "lf3-b").trashedAt).toBe(2);
  });
});

describe("daily sweep", () => {
  it("moves done tasks older than 7 days to the trash with their subtasks; archived ones stay", async () => {
    const cookie = await login("sw1");
    const now = Date.now() + 1000 * DAY; // far ahead so other tests' rows do not interfere with counts
    await put("sw1-old", task({ status: "done", doneAt: now - DONE_KEEP_MS - 1 }), cookie);
    await put("sw1-old-sub", task({ parentId: "sw1-old", status: "done", doneAt: now - DONE_KEEP_MS - 1 }), cookie);
    await put("sw1-new", task({ status: "done", doneAt: now - DONE_KEEP_MS + DAY }), cookie);
    await put("sw1-kept", task({ status: "done", doneAt: now - 30 * DAY, archivedAt: now - 29 * DAY }), cookie);
    await put("sw1-todo", task({ status: "todo" }), cookie);
    await sweep(E, now);
    const tasks = await list(cookie);
    const get = (id: string) => tasks.find((t) => t.id === id);
    expect(get("sw1-old").trashedAt).toBe(now);
    expect(get("sw1-old-sub").trashedAt).toBe(now);
    expect(get("sw1-new").trashedAt).toBeNull();
    expect(get("sw1-kept").trashedAt).toBeNull();
    expect(get("sw1-todo").trashedAt).toBeNull();
    // clients must see the change: updated_at moved forward
    expect(get("sw1-old").updatedAt).toBeGreaterThanOrEqual(now);
  });

  it("purges the trash after 30 days, with attachments, and the id cannot come back", async () => {
    const cookie = await login("sw2");
    const now = Date.now() + 2000 * DAY;
    await put("sw2-a", task({ trashedAt: now - TRASH_KEEP_MS - 1 }), cookie);
    await put("sw2-b", task({ trashedAt: now - TRASH_KEEP_MS + DAY }), cookie);
    const { attachment } = (await (await upload("sw2-a", cookie)).json()) as any;
    await sweep(E, now);
    const ids = (await list(cookie)).map((t) => t.id);
    expect(ids).not.toContain("sw2-a");
    expect(ids).toContain("sw2-b");
    expect(await E.FILES.get(attachment.id)).toBeNull();
    expect(await E.DB.prepare("SELECT 1 FROM attachments WHERE id = ?").bind(attachment.id).first()).toBeNull();
    // a stale outbox on another device
    expect((await put("sw2-a", task({ updatedAt: now + 5 }), cookie)).status).toBe(410);
  });
});

describe("delete for good", () => {
  it("only removes the caller's own trashed tasks", async () => {
    const alice = await login("pd1a");
    const mallory = await login("pd1m");
    await put("pd1-live", task(), alice);
    await put("pd1-trash", task({ trashedAt: 1 }), alice);
    await put("pd1-sub", task({ parentId: "pd1-trash", trashedAt: 1 }), alice);
    expect((await call("/api/tasks/pd1-live", { method: "DELETE", cookie: alice })).status).toBe(404);
    expect((await call("/api/tasks/pd1-trash", { method: "DELETE", cookie: mallory })).status).toBe(404);
    const res = await call("/api/tasks/pd1-trash", { method: "DELETE", cookie: alice });
    expect(await res.json()).toEqual({ deleted: 2 });
    expect((await list(alice)).map((t) => t.id)).toEqual(["pd1-live"]);
  });

  it("empty trash removes only the caller's trash", async () => {
    const alice = await login("pd2a");
    const bob = await login("pd2b");
    await put("pd2-a1", task({ trashedAt: 1 }), alice);
    await put("pd2-a2", task({ trashedAt: 1 }), alice);
    await put("pd2-a3", task(), alice);
    await put("pd2-b1", task({ trashedAt: 1 }), bob);
    expect(await (await call("/api/tasks/trash/empty", { method: "POST", cookie: alice })).json()).toEqual({ deleted: 2 });
    expect((await list(alice)).map((t) => t.id)).toEqual(["pd2-a3"]);
    expect((await list(bob)).map((t) => t.id)).toEqual(["pd2-b1"]);
  });
});
