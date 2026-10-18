export const STATUSES = ["todo", "doing", "done"] as const;
export type Status = (typeof STATUSES)[number];

export interface Task {
  id: string;
  title: string;
  status: Status;
  parentId: string | null;
  due: string | null; // YYYY-MM-DD
  position: number; // larger = higher in the list
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
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
