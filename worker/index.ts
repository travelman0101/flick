import { Hono } from "hono";
import { ai } from "./ai";
import { auth, requireUser } from "./auth";
import type { AppEnv, Env } from "./env";
import { sweep } from "./lifecycle";
import { drive } from "./drive";
import { files, taskFiles } from "./files";
import { tasks } from "./tasks";

export const app = new Hono<AppEnv>();

app.use("/api/*", async (c, next) => {
  // CSRF: state-changing requests must come from our own origin.
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    if (c.req.header("origin") !== new URL(c.req.url).origin) return c.json({ error: "forbidden" }, 403);
  }
  await next();
  if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
});

app.route("/api/auth", auth);
app.use("/api/me", requireUser);
app.get("/api/me", (c) => c.json({ user: c.get("user") }));
app.use("/api/tasks/*", requireUser);
app.use("/api/tasks", requireUser);
app.route("/api/tasks", tasks);
app.route("/api/tasks", taskFiles);
app.use("/api/attachments/*", requireUser);
app.route("/api/attachments", files);
app.use("/api/drive/*", requireUser);
app.route("/api/drive", drive);
app.use("/api/ai/*", requireUser);
app.route("/api/ai", ai);
app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

export default {
  fetch: app.fetch,
  // daily at 04:00 JST: done tasks older than 7 days to the trash, trash older than 30 days purged
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(sweep(env));
  },
} satisfies ExportedHandler<Env>;
