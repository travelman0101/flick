-- attachments can be links to Google Drive files instead of stored bytes
ALTER TABLE attachments ADD COLUMN kind TEXT NOT NULL DEFAULT 'file';
ALTER TABLE attachments ADD COLUMN url TEXT;

-- Google Drive access for the file picker (drive.file scope). The refresh token is AES-GCM encrypted.
CREATE TABLE drive_tokens (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  refresh_enc TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
