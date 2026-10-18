import { describe, expect, it } from "vitest";
import { call, login, task } from "./helpers";

const put = (id: string, body: unknown, cookie: string) =>
  call(`/api/tasks/${id}`, { method: "PUT", cookie, body: JSON.stringify(body) });
const list = async (cookie: string) => ((await (await call("/api/tasks", { cookie })).json()) as any).tasks;

describe("tasks", () => {
  it("creates and lists tasks", async () => {
    const cookie = await login("t1");
    expect((await put("a1", task(), cookie)).status).toBe(200);
    const tasks = await list(cookie);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ id: "a1", title: "牛乳を買う", status: "todo" });
  });

  it("applies newer updates and ignores stale ones", async () => {
    const cookie = await login("t2");
    await put("b1", task({ updatedAt: 1000 }), cookie);
    await put("b1", task({ status: "doing", updatedAt: 2000 }), cookie);
    const stale = await put("b1", task({ status: "todo", updatedAt: 1500 }), cookie);
    expect(((await stale.json()) as any).task.status).toBe("doing");
  });

  it("hides archived tasks from the list", async () => {
    const cookie = await login("t3");
    await put("c1", task(), cookie);
    await put("c1", task({ archivedAt: Date.now(), updatedAt: Date.now() + 1 }), cookie);
    expect(await list(cookie)).toHaveLength(0);
  });

  it("isolates users from each other", async () => {
    const alice = await login("t4a");
    const mallory = await login("t4m");
    await put("d1", task({ title: "秘密" }), alice);
    expect(await list(mallory)).toHaveLength(0);
    const hijack = await put("d1", task({ title: "乗っ取り", updatedAt: Date.now() + 10_000 }), mallory);
    expect(hijack.status).toBe(404);
    expect((await list(alice))[0].title).toBe("秘密");
  });

  it("validates input", async () => {
    const cookie = await login("t5");
    expect((await put("e1", task({ status: "later" }), cookie)).status).toBe(400);
    expect((await put("e2", task({ title: "" }), cookie)).status).toBe(400);
    expect((await put("e3", task({ due: "tomorrow" }), cookie)).status).toBe(400);
    expect((await put("x".repeat(80), task(), cookie)).status).toBe(400);
  });
});
