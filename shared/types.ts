export const STATUSES = ["todo", "doing", "done"] as const;
export type Status = (typeof STATUSES)[number];

export interface Task {
  id: string;
  title: string;
  /** free-form memo, up to 10,000 chars */
  note: string;
  status: Status;
  parentId: string | null;
  due: string | null; // YYYY-MM-DD
  /** logical day (see src/day.ts) this task was picked for "today" */
  today: string | null;
  position: number; // larger = higher in the list
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  /** server-computed, read-only */
  attachmentCount?: number;
}

export interface Attachment {
  id: string;
  taskId: string;
  /** "file": bytes stored by Flick; "drive": a link to a Google Drive file */
  kind: "file" | "drive";
  url: string | null;
  name: string;
  type: string;
  size: number;
  createdAt: number;
}

export interface User {
  id: string;
  email: string;
  name: string;
  picture: string | null;
}

export interface OrganizeResult {
  tasks: { title: string; due: string | null }[];
}
export interface SubtasksResult {
  subtasks: string[];
}
export interface TodayResult {
  picks: { id: string; reason: string }[];
}
