import { Hono } from "hono";
import { ai } from "./ai";
import { auth, requireUser } from "./auth";
import type { AppEnv } from "./env";
import { tasks } from "./tasks";

const app = new Hono<AppEnv>();

app.use("/api/*", async (c, next) => {
  // CSRF: state-changing requests must come from our own origin.
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    if (c.req.header("origin") !== new URL(c.req.url).origin) return c.json({ error: "forbidden" }, 403);
  }
  await next();
  c.header("Cache-Control", "no-store");
});

app.route("/api/auth", auth);
app.use("/api/me", requireUser);
app.get("/api/me", (c) => c.json({ user: c.get("user") }));
app.use("/api/tasks/*", requireUser);
app.use("/api/tasks", requireUser);
app.route("/api/tasks", tasks);
app.use("/api/ai/*", requireUser);
app.route("/api/ai", ai);
app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

export default app;
