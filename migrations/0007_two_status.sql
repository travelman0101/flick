-- "doing" is gone: tasks are 未完了 (todo) or 完了 (done). Progress shows on the icon from subtasks instead.
-- Only the status changes; updated_at moves forward so every device picks it up.
UPDATE tasks SET status = 'todo', updated_at = MAX(updated_at + 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
  WHERE status = 'doing';
