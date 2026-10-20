import { env } from "cloudflare:workers";
import { app } from "../worker/index";
import type { Env } from "../worker/env";

export const ORIGIN = "http://localhost";

/** Tests never reach the real Workers AI: unless a test passes its own, every AI call fails like an outage. */
const noAI = {
  run: async () => {
    throw new Error("no AI in tests");
  },
  toMarkdown: async () => {
    throw new Error("no AI in tests");
  },
} as unknown as Ai;

export function call(path: string, init: RequestInit & { cookie?: string; env?: Partial<Env> } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.method && init.method !== "GET" && !headers.has("origin")) headers.set("origin", ORIGIN);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return app.request(`${ORIGIN}${path}`, { ...init, headers }, { ...(env as unknown as Env), AI: noAI, ...init.env });
}

export async function login(name: string) {
  const res = await call(`/api/auth/dev-login?name=${name}&json=1`);
  if (res.status !== 200) throw new Error(`dev-login failed: ${res.status}`);
  return res.headers.get("set-cookie")!.split(";")[0];
}

export function task(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    title: "牛乳を買う",
    status: "todo",
    parentId: null,
    due: null,
    position: now,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    ...overrides,
  };
}
