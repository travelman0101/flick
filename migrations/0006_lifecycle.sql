-- done -> (7 days) -> trash -> (30 days) -> purged; archive keeps done tasks forever
ALTER TABLE tasks ADD COLUMN done_at INTEGER;
ALTER TABLE tasks ADD COLUMN trashed_at INTEGER;

-- existing done tasks start their 7 days now, so nothing vanishes right after the update
UPDATE tasks SET done_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000, updated_at = MAX(updated_at + 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
  WHERE status = 'done';

-- until now "archive" meant delete (left flick, subtask x): those go to the trash, restorable for 30 days
UPDATE tasks SET trashed_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000, archived_at = NULL,
  updated_at = MAX(updated_at + 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
  WHERE archived_at IS NOT NULL;

CREATE INDEX tasks_done ON tasks(status, done_at);
CREATE INDEX tasks_trash ON tasks(trashed_at);

-- ids removed for good: a stale outbox on another device must not bring them back
CREATE TABLE deleted_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  deleted_at INTEGER NOT NULL
);
