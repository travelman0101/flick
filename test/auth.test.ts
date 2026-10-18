import { describe, expect, it } from "vitest";
import { call, login } from "./helpers";

describe("auth", () => {
  it("rejects unauthenticated access", async () => {
    expect((await call("/api/tasks")).status).toBe(401);
    expect((await call("/api/me")).status).toBe(401);
  });

  it("dev-login creates a session usable for /api/me", async () => {
    const cookie = await login("alice");
    expect(cookie).toMatch(/^flick_session=/);
    const res = await call("/api/me", { cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user: { name: "alice" } });
  });

  it("dev-login is unavailable when DEV_AUTH is not 1", async () => {
    const res = await call("/api/auth/dev-login?name=x&json=1", { env: { DEV_AUTH: undefined } });
    expect(res.status).toBe(404);
  });

  it("logout invalidates the session", async () => {
    const cookie = await login("bob");
    expect((await call("/api/auth/logout", { method: "POST", cookie })).status).toBe(200);
    expect((await call("/api/me", { cookie })).status).toBe(401);
  });

  it("google start redirects with state and PKCE", async () => {
    const res = await call("/api/auth/google", { env: { GOOGLE_CLIENT_SECRET: "s" } });
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get("location")!);
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost/api/auth/callback");
    expect(res.headers.get("set-cookie")).toContain("flick_oauth=");
  });

  it("callback rejects a mismatched state", async () => {
    const res = await call("/api/auth/callback?code=c&state=bad", {
      cookie: "flick_oauth=good.verifier",
      env: { GOOGLE_CLIENT_SECRET: "s" },
    });
    expect(res.status).toBe(400);
  });

  it("blocks cross-origin writes", async () => {
    const cookie = await login("carol");
    const res = await call("/api/auth/logout", { method: "POST", cookie, headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });
});
