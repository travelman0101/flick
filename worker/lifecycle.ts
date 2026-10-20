import type { Env } from "./env";

/**
 * Done tasks go to the trash after 7 days unless archived; the trash is purged after 30 days.
 * Runs daily from the Cron trigger (04:00 JST, when Flick's day starts).
 */
export const DONE_KEEP_MS = 7 * 86_400_000;
export const TRASH_KEEP_MS = 30 * 86_400_000;

/** D1 caps bound parameters per statement; stay well below. */
const CHUNK = 50;
const chunks = <T,>(xs: T[]) => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK));
const marks = (n: number) => Array(n).fill("?").join(", ");

/** Remove tasks for good: the rows, their subtasks, attachments (D1 + KV), and leave tombstones. */
export async function purgeTasks(env: Env, userId: string, ids: string[], now = Date.now()): Promise<number> {
  if (!ids.length) return 0;
  let deleted = 0;
  for (const part of chunks(ids)) {
    const { results: rows } = await env.DB.prepare(
      `SELECT id FROM tasks WHERE user_id = ? AND (id IN (${marks(part.length)}) OR parent_id IN (${marks(part.length)}))`,
    )
      .bind(userId, ...part, ...part)
      .all<{ id: string }>();
    const all = rows.map((r) => r.id);
    for (const group of chunks(all)) {
      const { results: files } = await env.DB.prepare(
        `SELECT id, kind FROM attachments WHERE user_id = ? AND task_id IN (${marks(group.length)})`,
      )
        .bind(userId, ...group)
        .all<{ id: string; kind: string }>();
      await Promise.all(files.filter((f) => f.kind === "file").map((f) => env.FILES.delete(f.id)));
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM attachments WHERE user_id = ? AND task_id IN (${marks(group.length)})`).bind(userId, ...group),
        env.DB.prepare(`DELETE FROM tasks WHERE user_id = ? AND id IN (${marks(group.length)})`).bind(userId, ...group),
        ...group.map((id) =>
          env.DB.prepare("INSERT OR REPLACE INTO deleted_tasks (id, user_id, deleted_at) VALUES (?, ?, ?)").bind(id, userId, now),
        ),
      ]);
      deleted += group.length;
    }
  }
  return deleted;
}

export async function sweep(env: Env, now = Date.now()): Promise<{ trashed: number; purged: number }> {
  // done for 7 days and not kept: to the trash with their subtasks (same timestamp, so they restore together)
  const { results: stale } = await env.DB.prepare(
    `SELECT id, user_id FROM tasks
     WHERE status = 'done' AND parent_id IS NULL AND done_at IS NOT NULL AND done_at <= ?
       AND archived_at IS NULL AND trashed_at IS NULL`,
  )
    .bind(now - DONE_KEEP_MS)
    .all<{ id: string; user_id: string }>();
  for (const part of chunks(stale.map((r) => r.id))) {
    await env.DB.prepare(
      `UPDATE tasks SET trashed_at = ?, updated_at = MAX(updated_at + 1, ?)
       WHERE trashed_at IS NULL AND archived_at IS NULL AND (id IN (${marks(part.length)}) OR parent_id IN (${marks(part.length)}))`,
    )
      .bind(now, now, ...part, ...part)
      .run();
  }

  // in the trash for 30 days: gone
  const { results: old } = await env.DB.prepare(
    "SELECT id, user_id FROM tasks WHERE trashed_at IS NOT NULL AND trashed_at <= ?",
  )
    .bind(now - TRASH_KEEP_MS)
    .all<{ id: string; user_id: string }>();
  const byUser = new Map<string, string[]>();
  for (const r of old) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r.id]);
  let purged = 0;
  for (const [userId, ids] of byUser) purged += await purgeTasks(env, userId, ids, now);
  return { trashed: stale.length, purged };
}
