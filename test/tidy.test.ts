import { describe, expect, it } from "vitest";
import { call, login, task } from "./helpers";

type Run = (model: string, input: any) => Promise<unknown>;
const fakeAI = (run: Run, toMarkdown?: (doc: { name: string; blob: Blob }) => Promise<unknown>) =>
  ({ run, toMarkdown: toMarkdown ?? (async () => ({ format: "error", error: "unsupported" })) }) as unknown as Ai;

const put = (id: string, cookie: string) => call(`/api/tasks/${id}`, { method: "PUT", cookie, body: JSON.stringify(task()) });
const upload = (taskId: string, cookie: string, body: string | Uint8Array, name: string, type: string, ai: Ai) =>
  call(`/api/tasks/${taskId}/attachments`, {
    method: "POST",
    cookie,
    body: body as unknown as BodyInit,
    headers: { "content-type": type, "x-file-name": encodeURIComponent(name) },
    env: { AI: ai },
  });
const list = async (taskId: string, cookie: string) =>
  ((await (await call(`/api/tasks/${taskId}/attachments`, { cookie })).json()) as any).attachments;

describe("tidy a dictated note", () => {
  it("returns Markdown without code fences or a trailing rule", async () => {
    const cookie = await login("td1");
    let prompt = "";
    const ai = fakeAI(async (_m, input) => {
      prompt = input.messages[1].content;
      return { response: "```markdown\n## 台湾遠征\n- 集合 7:00\n\n---\n```" };
    });
    const res = await call("/api/ai/tidy", { method: "POST", cookie, body: JSON.stringify({ text: "えーと集合は7時" }), env: { AI: ai } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ markdown: "## 台湾遠征\n- 集合 7:00" });
    expect(prompt).toBe("えーと集合は7時");
  });

  it("needs text and a login", async () => {
    const cookie = await login("td2");
    const ai = fakeAI(async () => ({ response: "x" }));
    expect((await call("/api/ai/tidy", { method: "POST", cookie, body: "{}", env: { AI: ai } })).status).toBe(400);
    expect((await call("/api/ai/tidy", { method: "POST", body: "{}" })).status).toBe(401);
  });
});

describe("attachment summaries", () => {
  it("summarizes a text file once, when it is attached", async () => {
    const cookie = await login("sm1");
    await put("st1", cookie);
    let read = "";
    const ai = fakeAI(async (_m, input) => {
      read = input.messages[1].content;
      return { response: "3泊4日、集合 7:00 中部国際空港" };
    });
    expect((await upload("st1", cookie, "旅程: 3泊4日。集合は 7:00 中部国際空港。", "旅程.txt", "text/plain", ai)).status).toBe(200);
    expect(read).toContain("旅程.txt");
    expect(read).toContain("集合は 7:00");
    expect((await list("st1", cookie))[0].summary).toBe("3泊4日、集合 7:00 中部国際空港");
  });

  it("reads PDFs through toMarkdown", async () => {
    const cookie = await login("sm2");
    await put("st2", cookie);
    const ai = fakeAI(
      async (_m, input) => ({ response: `要約: ${input.messages[1].content.includes("PDF本文") ? "ok" : "ng"}` }),
      async () => ({ format: "markdown", data: "PDF本文", tokens: 3 }),
    );
    await upload("st2", cookie, new Uint8Array([37, 80, 68, 70]), "案内.pdf", "application/pdf", ai);
    expect((await list("st2", cookie))[0].summary).toBe("要約: ok");
  });

  it("keeps the attachment when the file cannot be read", async () => {
    const cookie = await login("sm3");
    await put("st3", cookie);
    const ai = fakeAI(async () => ({ response: "never" }));
    expect((await upload("st3", cookie, new Uint8Array([1, 2, 3]), "謎.bin", "application/octet-stream", ai)).status).toBe(200);
    const [att] = await list("st3", cookie);
    expect(att.name).toBe("謎.bin");
    expect(att.summary).toBeNull();
  });

  it("subtask ideas read the summaries, never the files", async () => {
    const cookie = await login("sm4");
    await put("st4", cookie);
    await upload("st4", cookie, "持ち物: 雨具", "持ち物.txt", "text/plain", fakeAI(async () => ({ response: "雨具が必要" })));
    let prompt = "";
    const ai = fakeAI(async (_m, input) => {
      prompt = input.messages[1].content;
      return { response: { subtasks: ["雨具を買う"] } };
    });
    const res = await call("/api/ai/subtasks", {
      method: "POST",
      cookie,
      body: JSON.stringify({ title: "旅行の準備", note: "台湾", taskId: "st4" }),
      env: { AI: ai },
    });
    expect(res.status).toBe(200);
    expect(prompt).toContain("メモ:\n台湾");
    expect(prompt).toContain("添付ファイル:\n- 持ち物.txt: 雨具が必要");
  });

  it("does not leak another user's attachments into ideas", async () => {
    const alice = await login("sm5a");
    const mallory = await login("sm5m");
    await put("st5", alice);
    await upload("st5", alice, "秘密", "秘密.txt", "text/plain", fakeAI(async () => ({ response: "秘密の要約" })));
    let prompt = "";
    const ai = fakeAI(async (_m, input) => {
      prompt = input.messages[1].content;
      return { response: { subtasks: ["x"] } };
    });
    await call("/api/ai/subtasks", { method: "POST", cookie: mallory, body: JSON.stringify({ title: "t", taskId: "st5" }), env: { AI: ai } });
    expect(prompt).not.toContain("秘密");
  });
});
