import { describe, expect, it } from "vitest";
import { call, login, task } from "./helpers";

const fakeAI = (output: unknown) => ({ run: async () => output }) as unknown as Ai;
const post = (path: string, body: unknown, cookie: string, ai: Ai, extra = {}) =>
  call(path, { method: "POST", cookie, body: JSON.stringify(body), env: { AI: ai, ...extra } });

describe("ai", () => {
  it("organize returns cleaned tasks from an object response", async () => {
    const cookie = await login("ai1");
    const ai = fakeAI({ response: { tasks: [{ title: " 牛乳を買う ", due: "2026-10-19" }, { title: "", due: null }] } });
    const res = await post("/api/ai/organize", { text: "えーと明日牛乳かう", today: "2026-10-18" }, cookie, ai);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tasks: [{ title: "牛乳を買う", due: "2026-10-19" }] });
  });

  it("organize parses JSON embedded in a chat-completion response", async () => {
    const cookie = await login("ai2");
    const fence = "`".repeat(3);
    const content = `はい\n${fence}json\n{"tasks":[{"title":"資料を送る","due":"bad"}]}\n${fence}`;
    const ai = fakeAI({ choices: [{ message: { content } }] });
    const res = await post("/api/ai/organize", { text: "資料送る", today: "2026-10-18" }, cookie, ai);
    expect(await res.json()).toEqual({ tasks: [{ title: "資料を送る", due: null }] });
  });

  it("returns 502 when the model output is unusable", async () => {
    const cookie = await login("ai3");
    const res = await post("/api/ai/organize", { text: "x", today: "2026-10-18" }, cookie, fakeAI({ response: "nope" }));
    expect(res.status).toBe(502);
  });

  it("subtasks returns at most 6 strings", async () => {
    const cookie = await login("ai4");
    const ai = fakeAI({ response: { subtasks: ["a", "b", "c", "d", "e", "f", "g"] } });
    const res = await post("/api/ai/subtasks", { title: "旅行の準備" }, cookie, ai);
    expect(((await res.json()) as any).subtasks).toHaveLength(6);
  });

  it("today only returns ids of the user's open tasks", async () => {
    const cookie = await login("ai5");
    await call("/api/tasks/k1", { method: "PUT", cookie, body: JSON.stringify(task({ title: "A" })) });
    await call("/api/tasks/k2", { method: "PUT", cookie, body: JSON.stringify(task({ title: "B", status: "done" })) });
    const ai = fakeAI({ response: { picks: [{ id: "k1", reason: "急ぎ" }, { id: "k2", reason: "x" }, { id: "zz", reason: "y" }] } });
    const res = await post("/api/ai/today", { today: "2026-10-18" }, cookie, ai);
    expect(await res.json()).toEqual({ picks: [{ id: "k1", reason: "急ぎ" }] });
  });

  it("enforces the daily limit", async () => {
    const cookie = await login("ai6");
    const ai = fakeAI({ response: { subtasks: ["a"] } });
    expect((await post("/api/ai/subtasks", { title: "x" }, cookie, ai, { AI_DAILY_LIMIT: "1" })).status).toBe(200);
    expect((await post("/api/ai/subtasks", { title: "x" }, cookie, ai, { AI_DAILY_LIMIT: "1" })).status).toBe(429);
  });

  it("requires login", async () => {
    const res = await call("/api/ai/subtasks", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });
});
