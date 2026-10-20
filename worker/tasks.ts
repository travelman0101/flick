import { Hono } from "hono";
import { STATUSES, type Status, type Task } from "../shared/types";
import type { AppEnv } from "./env";
import { purgeTasks } from "./lifecycle";

interface Row {
  id: string;
  title: string;
  note: string;
  status: Status;
  parent_id: string | null;
  due: string | null;
  today: string | null;
  position: number;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  done_at: number | null;
  trashed_at: number | null;
  attachment_count: number;
}

export const toTask = (r: Row): Task => ({
  id: r.id,
  title: r.title,
  note: r.note,
  status: r.status,
  parentId: r.parent_id,
  due: r.due,
  today: r.today,
  position: r.position,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  archivedAt: r.archived_at,
  doneAt: r.done_at,
  trashedAt: r.trashed_at,
  attachmentCount: r.attachment_count,
});

const SELECT = `SELECT t.*, (SELECT COUNT(*) FROM attachments a WHERE a.task_id = t.id) AS attachment_count FROM tasks t`;

export const ID = /^[A-Za-z0-9-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NOTE_MAX = 10_000;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const optNum = (v: unknown) => v === undefined || v === null || isNum(v);

type Parsed = Omit<Task, "id" | "attachmentCount" | "doneAt" | "trashedAt"> & {
  /** undefined: an older client that does not know the field; keep what is stored */
  doneAt: number | null | undefined;
  trashedAt: number | null | undefined;
};

function parseTask(id: string, b: any): Parsed | null {
  if (!ID.test(id) || !b || typeof b !== "object") return null;
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title || title.length > 500) return null;
  // older clients do not send a note
  const note = b.note === undefined ? "" : b.note;
  if (typeof note !== "string" || note.length > NOTE_MAX) return null;
  // "doing" was removed: older clients may still send it, and it means not done
  if (b.status === "doing") b.status = "todo";
  if (!STATUSES.includes(b.status)) return null;
  if (b.parentId !== null && !(typeof b.parentId === "string" && ID.test(b.parentId))) return null;
  if (b.due !== null && !(typeof b.due === "string" && DATE.test(b.due))) return null;
  // older clients do not send today
  const today = b.today === undefined ? null : b.today;
  if (today !== null && !(typeof today === "string" && DATE.test(today))) return null;
  if (!isNum(b.position) || !isNum(b.createdAt) || !isNum(b.updatedAt)) return null;
  if (b.archivedAt !== null && !isNum(b.archivedAt)) return null;
  if (!optNum(b.doneAt) || !optNum(b.trashedAt)) return null;
  return {
    title,
    note,
    status: b.status,
    parentId: b.parentId,
    due: b.due,
    today,
    position: b.position,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    archivedAt: b.archivedAt,
    doneAt: b.doneAt,
    trashedAt: b.trashedAt,
  };
}

/** The task if it exists and belongs to the user. */
export const ownedTask = (db: D1Database, id: string, userId: string) =>
  db.prepare("SELECT id FROM tasks WHERE id = ? AND user_id = ?").bind(id, userId).first<{ id: string }>();

export const tasks = new Hono<AppEnv>();

// archived and trashed tasks come too: the client sorts them into the archive and trash sheets
tasks.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(`${SELECT} WHERE t.user_id = ? ORDER BY t.position DESC LIMIT 2000`)
    .bind(c.get("user").id)
    .all<Row>();
  return c.json({ tasks: results.map(toTask) });
});

tasks.post("/trash/empty", async (c) => {
  const userId = c.get("user").id;
  const { results } = await c.env.DB.prepare("SELECT id FROM tasks WHERE user_id = ? AND trashed_at IS NOT NULL")
    .bind(userId)
    .all<{ id: string }>();
  return c.json({ deleted: await purgeTasks(c.env, userId, results.map((r) => r.id)) });
});

tasks.put("/:id", async (c) => {
  const id = c.req.param("id");
  const t = parseTask(id, await c.req.json().catch(() => null));
  if (!t) return c.json({ error: "invalid task" }, 400);
  const userId = c.get("user").id;
  // removed for good: an old outbox must not bring it back
  if (await c.env.DB.prepare("SELECT 1 FROM deleted_tasks WHERE id = ?").bind(id).first()) return c.json({ error: "deleted" }, 410);
  // done_at follows the status, whoever sends it
  const doneAt = t.status !== "done" ? null : (t.doneAt ?? null);
  const keepDone = t.status === "done" && t.doneAt === undefined ? 1 : 0;
  const keepTrash = t.trashedAt === undefined ? 1 : 0;
  // Last write wins; a row owned by someone else is never touched.
  await c.env.DB.prepare(
    `INSERT INTO tasks (id, user_id, title, note, status, parent_id, due, today, position, created_at, updated_at, archived_at, done_at, trashed_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, CASE WHEN ?5 = 'done' THEN COALESCE(?13, ?11) END, ?14)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, note = excluded.note, status = excluded.status, parent_id = excluded.parent_id,
       due = excluded.due, today = excluded.today, position = excluded.position, updated_at = excluded.updated_at,
       archived_at = excluded.archived_at,
       done_at = CASE WHEN excluded.status != 'done' THEN NULL
                      WHEN ?15 = 1 THEN COALESCE(CASE WHEN tasks.status = 'done' THEN tasks.done_at END, excluded.updated_at)
                      ELSE COALESCE(?13, excluded.updated_at) END,
       trashed_at = CASE WHEN ?16 = 1 THEN tasks.trashed_at ELSE excluded.trashed_at END
     WHERE tasks.user_id = excluded.user_id AND tasks.updated_at < excluded.updated_at`,
  )
    .bind(id, userId, t.title, t.note, t.status, t.parentId, t.due, t.today, t.position, t.createdAt, t.updatedAt, t.archivedAt, doneAt, t.trashedAt ?? null, keepDone, keepTrash)
    .run();
  const row = await c.env.DB.prepare(`${SELECT} WHERE t.id = ? AND t.user_id = ?`).bind(id, userId).first<Row>();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ task: toTask(row) });
});

/** Delete for good, from the trash only. Subtasks and attachments go with it. */
tasks.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const userId = c.get("user").id;
  if (!ID.test(id)) return c.json({ error: "not found" }, 404);
  const row = await c.env.DB.prepare("SELECT id FROM tasks WHERE id = ? AND user_id = ? AND trashed_at IS NOT NULL").bind(id, userId).first();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ deleted: await purgeTasks(c.env, userId, [id]) });
});
