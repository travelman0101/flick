ALTER TABLE tasks ADD COLUMN note TEXT NOT NULL DEFAULT '';

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX attachments_task ON attachments(task_id);
CREATE INDEX attachments_user ON attachments(user_id);
