import type { User } from "../shared/types";

export interface Env {
  DB: D1Database;
  AI: Ai;
  /** attachment bytes, key = attachment id */
  FILES: KVNamespace;
  FILE_MAX_BYTES: string;
  USER_QUOTA_BYTES: string;
  ASSETS: Fetcher;
  /** accurate model: organize (relative dates) */
  AI_MODEL: string;
  /** fast model: subtasks, today */
  AI_MODEL_FAST: string;
  AI_DAILY_LIMIT: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** browser key for the Google Picker, restricted by referrer (public) */
  GOOGLE_API_KEY?: string;
  /** Google Cloud project number, needed by the picker for drive.file access */
  GOOGLE_APP_ID?: string;
  /** base64 AES-256 key that encrypts Drive refresh tokens (secret) */
  DRIVE_TOKEN_KEY?: string;
  /** "0" skips revoking at Google on disconnect (tests only) */
  DRIVE_REVOKE?: string;
  /** "1" enables /api/auth/dev-login. Local development and tests only. */
  DEV_AUTH?: string;
  /** "1" returns canned AI responses. Local development and E2E only. */
  AI_MOCK?: string;
}

export type AppEnv = { Bindings: Env; Variables: { user: User } };
