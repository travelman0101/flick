import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { open, seal } from "../worker/crypto";
import { call, login, task } from "./helpers";

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const secrets = { GOOGLE_CLIENT_SECRET: "s", DRIVE_TOKEN_KEY: KEY };

const put = (id: string, cookie: string) => call(`/api/tasks/${id}`, { method: "PUT", cookie, body: JSON.stringify(task()) });
const link = (taskId: string, cookie: string, body: unknown) =>
  call(`/api/tasks/${taskId}/links`, { method: "POST", cookie, body: JSON.stringify(body) });

describe("token encryption", () => {
  it("round-trips and never stores the plain token", async () => {
    const sealed = await seal("1//refresh-token", KEY);
    expect(sealed).not.toContain("refresh");
    expect(await open(sealed, KEY)).toBe("1//refresh-token");
    // a fresh IV every time
    expect(await seal("1//refresh-token", KEY)).not.toBe(sealed);
  });
});

describe("drive connection", () => {
  it("starts OAuth for the signed-in account with drive.file only", async () => {
    const cookie = await login("g1");
    const res = await call("/api/drive/connect", { cookie, env: secrets });
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get("location")!);
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("scope")!.split(" ")).toContain("https://www.googleapis.com/auth/drive.file");
    expect(url.searchParams.get("scope")).not.toMatch(/auth\/drive(\s|$)/); // never full drive access
    expect(url.searchParams.get("login_hint")).toBe("g1@example.test");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost/api/drive/callback");
    expect(res.headers.get("set-cookie")).toContain("flick_drive=");
  });

  it("rejects a callback with the wrong state", async () => {
    const cookie = await login("g2");
    const res = await call("/api/drive/callback?code=x&state=bad", {
      cookie: `${cookie}; flick_drive=good.verifier`,
      env: secrets,
    });
    expect(res.status).toBe(400);
  });

  it("reports not connected and refuses a token", async () => {
    const cookie = await login("g3");
    expect(await (await call("/api/drive/status", { cookie, env: secrets })).json()).toEqual({ connected: false });
    expect((await call("/api/drive/token", { cookie, env: secrets })).status).toBe(409);
  });

  it("disconnect forgets the stored token", async () => {
    const cookie = await login("g4");
    const me = ((await (await call("/api/me", { cookie })).json()) as any).user;
    const db = (env as unknown as { DB: D1Database }).DB;
    await db
      .prepare("INSERT INTO drive_tokens (user_id, refresh_enc, created_at) VALUES (?, ?, ?)")
      .bind(me.id, await seal("1//r", KEY), Date.now())
      .run();
    expect(await (await call("/api/drive/status", { cookie, env: secrets })).json()).toEqual({ connected: true });
    // revoking at Google is best effort; forgetting the token here must not depend on it
    expect((await call("/api/drive/disconnect", { method: "POST", cookie, env: { ...secrets, DRIVE_REVOKE: "0" } })).status).toBe(200);
    expect(await (await call("/api/drive/status", { cookie, env: secrets })).json()).toEqual({ connected: false });
  });

  it("requires login", async () => {
    expect((await call("/api/drive/status")).status).toBe(401);
  });
});

describe("drive link attachments", () => {
  const doc = {
    name: "旅程表",
    mimeType: "application/vnd.google-apps.document",
    url: "https://docs.google.com/document/d/abc123/edit?usp=drive_web",
  };

  it("attaches a Drive link without storing bytes", async () => {
    const cookie = await login("l1");
    await put("lt1", cookie);
    const res = await link("lt1", cookie, doc);
    expect(res.status).toBe(200);
    const { attachment } = (await res.json()) as any;
    expect(attachment).toMatchObject({ kind: "drive", name: "旅程表", url: doc.url, size: 0 });

    const list = ((await (await call("/api/tasks/lt1/attachments", { cookie })).json()) as any).attachments;
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe("drive");
    const tasks = ((await (await call("/api/tasks", { cookie })).json()) as any).tasks;
    expect(tasks[0].attachmentCount).toBe(1);

    expect((await call(`/api/attachments/${attachment.id}`, { method: "DELETE", cookie })).status).toBe(200);
  });

  it("only accepts https Google Drive / Docs URLs", async () => {
    const cookie = await login("l2");
    await put("lt2", cookie);
    for (const url of [
      "http://drive.google.com/file/d/x/view",
      "https://evil.example/drive.google.com",
      "https://drive.google.com.evil.example/x",
      "javascript:alert(1)",
    ]) {
      expect((await link("lt2", cookie, { ...doc, url })).status).toBe(400);
    }
    expect((await link("lt2", cookie, { ...doc, url: "https://drive.google.com/file/d/x/view" })).status).toBe(200);
  });

  it("keeps other users out", async () => {
    const alice = await login("l3a");
    const mallory = await login("l3m");
    await put("lt3", alice);
    expect((await link("lt3", mallory, doc)).status).toBe(404);
  });
});
