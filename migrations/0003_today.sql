-- logical day (YYYY-MM-DD, day starts at 04:00 local) the task was picked for "today"
ALTER TABLE tasks ADD COLUMN today TEXT;
