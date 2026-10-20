import { Hono } from "hono";
import type { Attachment } from "../shared/types";
import type { AppEnv } from "./env";
import { ID, ownedTask } from "./tasks";

interface Row {
  id: string;
  task_id: string;
  kind: "file" | "drive";
  url: string | null;
  name: string;
  type: string;
  size: number;
  created_at: number;
}

const toAttachment = (r: Row): Attachment => ({
  id: r.id,
  taskId: r.task_id,
  kind: r.kind,
  url: r.url,
  name: r.name,
  type: r.type,
  size: r.size,
  createdAt: r.created_at,
});

/** Types the browser may render inline. Everything else is downloaded in a sandbox. */
const INLINE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "application/pdf"]);
const TYPE = /^[a-z]+\/[a-z0-9.+-]+$/i;

function cleanName(raw: string | undefined) {
  let name = "file";
  try {
    name = decodeURIComponent(raw ?? "") || name;
  } catch {
    /* keep default */
  }
  // no paths or control characters
  return name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 200);
}

/** /api/tasks/:id/attachments */
export const taskFiles = new Hono<AppEnv>();

taskFiles.get("/:id/attachments", async (c) => {
  const userId = c.get("user").id;
  if (!(await ownedTask(c.env.DB, c.req.param("id"), userId))) return c.json({ error: "not found" }, 404);
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM attachments WHERE task_id = ? AND user_id = ? ORDER BY created_at",
  )
    .bind(c.req.param("id"), userId)
    .all<Row>();
  return c.json({ attachments: results.map(toAttachment) });
});

taskFiles.post("/:id/attachments", async (c) => {
  const userId = c.get("user").id;
  const taskId = c.req.param("id");
  if (!ID.test(taskId) || !(await ownedTask(c.env.DB, taskId, userId))) return c.json({ error: "not found" }, 404);

  const max = Number(c.env.FILE_MAX_BYTES || 10 * 1024 * 1024);
  const declared = Number(c.req.header("content-length") || 0);
  if (declared > max) return c.json({ error: "file too large" }, 413);
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: "empty file" }, 400);
  if (body.byteLength > max) return c.json({ error: "file too large" }, 413);

  const used = await c.env.DB.prepare("SELECT COALESCE(SUM(size), 0) AS used FROM attachments WHERE user_id = ?")
    .bind(userId)
    .first<{ used: number }>();
  if ((used?.used ?? 0) + body.byteLength > Number(c.env.USER_QUOTA_BYTES || 100 * 1024 * 1024)) {
    return c.json({ error: "storage full" }, 507);
  }

  const rawType = (c.req.header("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const att: Attachment = {
    id: crypto.randomUUID(),
    taskId,
    kind: "file",
    url: null,
    name: cleanName(c.req.header("x-file-name")),
    type: TYPE.test(rawType) ? rawType : "application/octet-stream",
    size: body.byteLength,
    createdAt: Date.now(),
  };
  // Bytes first: a row without bytes would be a broken attachment.
  await c.env.FILES.put(att.id, body);
  await c.env.DB.prepare(
    "INSERT INTO attachments (id, user_id, task_id, name, type, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(att.id, userId, att.taskId, att.name, att.type, att.size, att.createdAt)
    .run();
  return c.json({ attachment: att });
});

/** Only links that open Google Drive or Docs. */
function driveUrl(raw: unknown) {
  try {
    const u = new URL(String(raw));
    return u.protocol === "https:" && (u.hostname === "drive.google.com" || u.hostname === "docs.google.com") ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Attach a Google Drive file as a link: no bytes stored, any size. */
taskFiles.post("/:id/links", async (c) => {
  const userId = c.get("user").id;
  const taskId = c.req.param("id");
  if (!ID.test(taskId) || !(await ownedTask(c.env.DB, taskId, userId))) return c.json({ error: "not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const url = driveUrl(body.url);
  if (!url) return c.json({ error: "invalid link" }, 400);
  const rawType = String(body.mimeType ?? "").toLowerCase();
  const att: Attachment = {
    id: crypto.randomUUID(),
    taskId,
    kind: "drive",
    url,
    name: cleanName(encodeURIComponent(String(body.name ?? ""))),
    type: TYPE.test(rawType) ? rawType : "application/octet-stream",
    size: 0,
    createdAt: Date.now(),
  };
  await c.env.DB.prepare(
    "INSERT INTO attachments (id, user_id, task_id, name, type, size, created_at, kind, url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(att.id, userId, att.taskId, att.name, att.type, att.size, att.createdAt, att.kind, att.url)
    .run();
  return c.json({ attachment: att });
});

/** /api/attachments/:id */
export const files = new Hono<AppEnv>();

const findOwned = (c: { env: AppEnv["Bindings"] }, id: string, userId: string) =>
  c.env.DB.prepare("SELECT * FROM attachments WHERE id = ? AND user_id = ?").bind(id, userId).first<Row>();

files.get("/:id", async (c) => {
  const row = await findOwned(c, c.req.param("id"), c.get("user").id);
  if (!row) return c.json({ error: "not found" }, 404);
  if (row.kind === "drive" && row.url) return c.redirect(row.url, 302);
  const bytes = await c.env.FILES.get(row.id, "arrayBuffer");
  if (!bytes) return c.json({ error: "not found" }, 404);

  const inline = INLINE.has(row.type);
  const headers = new Headers({
    "Content-Type": inline ? row.type : "application/octet-stream",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    "X-Content-Type-Options": "nosniff",
    // ids never change, so the browser may keep the file
    "Cache-Control": "private, max-age=31536000, immutable",
  });
  // A sandbox breaks Chrome's PDF viewer, and images cannot run script anyway.
  if (!inline) headers.set("Content-Security-Policy", "sandbox; default-src 'none'");
  return new Response(bytes, { headers });
});

files.delete("/:id", async (c) => {
  const row = await findOwned(c, c.req.param("id"), c.get("user").id);
  if (!row) return c.json({ error: "not found" }, 404);
  await c.env.DB.prepare("DELETE FROM attachments WHERE id = ?").bind(row.id).run();
  if (row.kind === "file") await c.env.FILES.delete(row.id);
  return c.json({ ok: true });
});
