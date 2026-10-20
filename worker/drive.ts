import { Google, decodeIdToken, generateCodeVerifier, generateState } from "arctic";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "./env";
import { open, seal } from "./crypto";

/**
 * Google Drive access for the file picker.
 * Only the drive.file scope: Flick can see the files the user picks, nothing else.
 * Uses the same Google account as the Flick login (login_hint + account check in the callback).
 */
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/drive.file"];
const COOKIE = "flick_drive";

function client(c: Context<AppEnv>) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = c.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !c.env.DRIVE_TOKEN_KEY) return null;
  return new Google(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, new URL("/api/drive/callback", c.req.url).toString());
}

const secure = (c: Context) => new URL(c.req.url).protocol === "https:";

export const drive = new Hono<AppEnv>();

drive.get("/status", async (c) => {
  const row = await c.env.DB.prepare("SELECT 1 AS ok FROM drive_tokens WHERE user_id = ?").bind(c.get("user").id).first();
  return c.json({ connected: !!row });
});

drive.get("/connect", (c) => {
  const g = client(c);
  if (!g) return c.json({ error: "drive is not configured" }, 503);
  const state = generateState();
  const verifier = generateCodeVerifier();
  const url = g.createAuthorizationURL(state, verifier, SCOPES);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("login_hint", c.get("user").email);
  setCookie(c, COOKIE, `${state}.${verifier}`, { httpOnly: true, secure: secure(c), sameSite: "Lax", path: "/api/drive", maxAge: 600 });
  return c.redirect(url.toString(), 302);
});

drive.get("/callback", async (c) => {
  const g = client(c);
  if (!g) return c.json({ error: "drive is not configured" }, 503);
  const [saved, verifier] = (getCookie(c, COOKIE) ?? "").split(".");
  deleteCookie(c, COOKIE, { path: "/api/drive" });
  const { code, state, error } = c.req.query();
  if (error) return c.redirect("/?drive=cancelled", 302);
  if (!code || !state || !saved || !verifier || state !== saved) return c.text("Invalid request", 400);

  let refresh: string;
  let sub: string;
  try {
    const tokens = await g.validateAuthorizationCode(code, verifier);
    refresh = tokens.refreshToken();
    sub = String((decodeIdToken(tokens.idToken()) as Record<string, unknown>).sub);
  } catch {
    return c.redirect("/?drive=failed", 302);
  }
  // Drive must belong to the same Google account as the Flick login.
  const me = await c.env.DB.prepare("SELECT google_sub FROM users WHERE id = ?").bind(c.get("user").id).first<{ google_sub: string }>();
  if (me?.google_sub !== sub) return c.redirect("/?drive=wrong-account", 302);

  await c.env.DB.prepare(
    `INSERT INTO drive_tokens (user_id, refresh_enc, created_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET refresh_enc = excluded.refresh_enc, created_at = excluded.created_at`,
  )
    .bind(c.get("user").id, await seal(refresh, c.env.DRIVE_TOKEN_KEY!), Date.now())
    .run();
  return c.redirect("/?drive=connected", 302);
});

/** A short-lived access token for the picker, plus the public picker settings. */
drive.get("/token", async (c) => {
  const row = await c.env.DB.prepare("SELECT refresh_enc FROM drive_tokens WHERE user_id = ?").bind(c.get("user").id).first<{ refresh_enc: string }>();
  if (!row) return c.json({ error: "not connected" }, 409);
  const g = client(c);
  if (!g) return c.json({ error: "drive is not configured" }, 503);
  try {
    const tokens = await g.refreshAccessToken(await open(row.refresh_enc, c.env.DRIVE_TOKEN_KEY!));
    return c.json({
      accessToken: tokens.accessToken(),
      expiresAt: tokens.accessTokenExpiresAt().getTime(),
      apiKey: c.env.GOOGLE_API_KEY,
      appId: c.env.GOOGLE_APP_ID,
    });
  } catch {
    // revoked or expired at Google: ask the user to connect again
    await c.env.DB.prepare("DELETE FROM drive_tokens WHERE user_id = ?").bind(c.get("user").id).run();
    return c.json({ error: "not connected" }, 409);
  }
});

drive.post("/disconnect", async (c) => {
  const userId = c.get("user").id;
  const row = await c.env.DB.prepare("SELECT refresh_enc FROM drive_tokens WHERE user_id = ?").bind(userId).first<{ refresh_enc: string }>();
  await c.env.DB.prepare("DELETE FROM drive_tokens WHERE user_id = ?").bind(userId).run();
  if (row && c.env.DRIVE_REVOKE !== "0" && c.env.DRIVE_TOKEN_KEY) {
    try {
      const token = await open(row.refresh_enc, c.env.DRIVE_TOKEN_KEY);
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      /* best effort: the token is already forgotten here */
    }
  }
  return c.json({ ok: true });
});
