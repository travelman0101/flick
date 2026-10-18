import type { OrganizeResult, SubtasksResult, Task, TodayResult, User } from "../shared/types";

export class HttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: init.body ? { "content-type": "application/json", ...init.headers } : init.headers,
  });
  if (!res.ok) throw new HttpError(res.status);
  return res.json() as Promise<T>;
}

export const api = {
  me: () => request<{ user: User }>("/api/me"),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  tasks: () => request<{ tasks: Task[] }>("/api/tasks"),
  putTask: ({ id, ...t }: Task) => request<{ task: Task }>(`/api/tasks/${id}`, { method: "PUT", body: JSON.stringify(t) }),
  organize: (text: string) => request<OrganizeResult>("/api/ai/organize", { method: "POST", body: JSON.stringify({ text, today: today() }) }),
  subtasks: (title: string) => request<SubtasksResult>("/api/ai/subtasks", { method: "POST", body: JSON.stringify({ title }) }),
  today: () => request<TodayResult>("/api/ai/today", { method: "POST", body: JSON.stringify({ today: today() }) }),
};

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
