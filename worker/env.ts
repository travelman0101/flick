import type { User } from "../shared/types";

export interface Env {
  DB: D1Database;
  AI: Ai;
  ASSETS: Fetcher;
  /** accurate model: organize (relative dates) */
  AI_MODEL: string;
  /** fast model: subtasks, today */
  AI_MODEL_FAST: string;
  AI_DAILY_LIMIT: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** "1" enables /api/auth/dev-login. Local development and tests only. */
  DEV_AUTH?: string;
  /** "1" returns canned AI responses. Local development and E2E only. */
  AI_MOCK?: string;
}

export type AppEnv = { Bindings: Env; Variables: { user: User } };
