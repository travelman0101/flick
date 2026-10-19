import { Hono } from "hono";
import { STATUSES, type Status, type Task } from "../shared/types";
import type { AppEnv } from "./env";

interface Row {
  id: string;
  title: string;
  note: string;
  status: Status;
  parent_id: string | null;
  due: string | null;
  position: number;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  attachment_count: number;
}

export const toTask = (r: Row): Task => ({
  id: r.id,
  title: r.title,
  note: r.note,
  status: r.status,
  parentId: r.parent_id,
  due: r.due,
  position: r.position,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  archivedAt: r.archived_at,
  attachmentCount: r.attachment_count,
});

const SELECT = `SELECT t.*, (SELECT COUNT(*) FROM attachments a WHERE a.task_id = t.id) AS attachment_count FROM tasks t`;

export const ID = /^[A-Za-z0-9-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NOTE_MAX = 10_000;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parseTask(id: string, b: any): Omit<Task, "id" | "attachmentCount"> | null {
  if (!ID.test(id) || !b || typeof b !== "object") return null;
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title || title.length > 500) return null;
  // older clients do not send a note
  const note = b.note === undefined ? "" : b.note;
  if (typeof note !== "string" || note.length > NOTE_MAX) return null;
  if (!STATUSES.includes(b.status)) return null;
  if (b.parentId !== null && !(typeof b.parentId === "string" && ID.test(b.parentId))) return null;
  if (b.due !== null && !(typeof b.due === "string" && DATE.test(b.due))) return null;
  if (!isNum(b.position) || !isNum(b.createdAt) || !isNum(b.updatedAt)) return null;
  if (b.archivedAt !== null && !isNum(b.archivedAt)) return null;
  return {
    title,
    note,
    status: b.status,
    parentId: b.parentId,
    due: b.due,
    position: b.position,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    archivedAt: b.archivedAt,
  };
}

/** The task if it exists and belongs to the user. */
export const ownedTask = (db: D1Database, id: string, userId: string) =>
  db.prepare("SELECT id FROM tasks WHERE id = ? AND user_id = ?").bind(id, userId).first<{ id: string }>();

export const tasks = new Hono<AppEnv>();

tasks.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `${SELECT} WHERE t.user_id = ? AND t.archived_at IS NULL ORDER BY t.position DESC LIMIT 1000`,
  )
    .bind(c.get("user").id)
    .all<Row>();
  return c.json({ tasks: results.map(toTask) });
});

tasks.put("/:id", async (c) => {
  const id = c.req.param("id");
  const t = parseTask(id, await c.req.json().catch(() => null));
  if (!t) return c.json({ error: "invalid task" }, 400);
  const userId = c.get("user").id;
  // Last write wins; a row owned by someone else is never touched.
  await c.env.DB.prepare(
    `INSERT INTO tasks (id, user_id, title, note, status, parent_id, due, position, created_at, updated_at, archived_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, note = excluded.note, status = excluded.status, parent_id = excluded.parent_id,
       due = excluded.due, position = excluded.position, updated_at = excluded.updated_at, archived_at = excluded.archived_at
     WHERE tasks.user_id = excluded.user_id AND tasks.updated_at < excluded.updated_at`,
  )
    .bind(id, userId, t.title, t.note, t.status, t.parentId, t.due, t.position, t.createdAt, t.updatedAt, t.archivedAt)
    .run();
  const row = await c.env.DB.prepare(`${SELECT} WHERE t.id = ? AND t.user_id = ?`).bind(id, userId).first<Row>();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ task: toTask(row) });
});
