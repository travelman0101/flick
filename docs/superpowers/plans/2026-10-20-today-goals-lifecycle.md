# Today Goals & Task Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate "today's goal" from whole-task completion, show real progress on the doing icon, replace "unpick" with postpone, start tasks only from real work, and add done → archive → trash → purge.

**Architecture:** Subtasks are task rows, so today's goal = a subtask whose `today` is today (no new column). Lifecycle adds `done_at`, `trashed_at` and a `deleted_tasks` tombstone table; a daily Cron sweeps done (7 d) and trash (30 d). The local-first store gains selectors/mutations; screens read them.

**Tech Stack:** Cloudflare Workers (Hono, D1, KV, Cron Triggers), React 19 + Motion, Vitest (workers pool), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-20-today-goals-lifecycle-design.md`

## Global Constraints
- Status (todo/doing/done) and today/postpone never change each other's fields.
- Progress = done subtasks ÷ subtasks (trashed/archived subtasks excluded); doing with no subtasks shows 50 %.
- Done → trash after 7 days unless archived; trash → purge after 30 days. Cron `0 19 * * *` (04:00 JST).
- Migration: existing `archived_at` rows → trash (`trashed_at` = migration time, `archived_at` = NULL); existing done → `done_at` = migration time; bump `updated_at` on changed rows.
- Old clients omit `doneAt`/`trashedAt`: the server keeps the stored value.
- Copy (exact): 「今日やるに追加」「明日以降に延期」「延期しました」「延期」「進行中に戻す」「アーカイブに保存」「ゴミ箱に移動」「ゴミ箱に移動しました」「元に戻す」「完全に削除」「ゴミ箱を空にする」「30 日で自動的に完全削除されます」「今日分 完了」「すべて完了。タスクも完了にする？」「完了にする」「今日やる分をタップ」.
- Keep existing look; no new screens besides the two menu sheets.

## Review Focus
1. Two devices: a purged task still in the other device's outbox must not come back (PUT → 410, client drops it).
2. A done task restored from trash must not be swept again the same night (`doneAt` reset to now).
3. Postpone then undo restores the parent's and the goals' `today` exactly; progress untouched.
4. A task due today (auto in Today) with goals: achievement uses goals like a picked task.
5. Date input on iPhone: a tap right after changing the date must not hit the status buttons (600 ms guard).

---

### Task 1: Schema, server lifecycle, purge, Cron

**Files:** Create `migrations/0006_lifecycle.sql`, `worker/lifecycle.ts`, `test/lifecycle.test.ts`. Modify `shared/types.ts`, `worker/tasks.ts`, `worker/index.ts`, `worker/ai.ts` (today query: `AND trashed_at IS NULL`), `wrangler.jsonc` (`"triggers": {"crons": ["0 19 * * *"]}`), `test/helpers.ts`, `test/tasks.test.ts`.

**Interfaces — Produces:**
- `Task` gains `doneAt: number | null; trashedAt: number | null`.
- `worker/lifecycle.ts`: `DONE_KEEP_MS = 7 * 86_400_000`, `TRASH_KEEP_MS = 30 * 86_400_000`; `sweep(env: Env, now?: number): Promise<{ trashed: number; purged: number }>`; `purgeTasks(env: Env, userId: string, ids: string[]): Promise<number>` (rows + children + attachments in D1 and KV + tombstones).
- `worker/index.ts`: `export const app` (Hono) and `export default { fetch: app.fetch, scheduled(_e, env, ctx) { ctx.waitUntil(sweep(env)) } }`; helpers import `{ app }`.
- API: `GET /api/tasks` returns archived and trashed too; `PUT /api/tasks/:id` → 410 if tombstoned; server normalizes `done_at` (status done & null → `updatedAt`; not done → null); `DELETE /api/tasks/:id` (404 unless trashed & owned) → `{ deleted: n }`; `POST /api/tasks/trash/empty` → `{ deleted: n }`.

- [ ] Tests (`test/lifecycle.test.ts`): `keeps done_at and trashed_at, and old clients keep stored values`; `done older than 7 days goes to trash with subtasks, archived ones stay`; `trash older than 30 days is purged with attachments and cannot be PUT back (410)`; `DELETE only works on own trashed tasks`; `empty trash removes only the caller's`; `GET returns archived and trashed tasks`. Update `hides archived tasks from the list` → `returns archived tasks with archivedAt set`.
- [ ] Run `npx vitest run` → new tests fail.
- [ ] Implement migration, types, parse/upsert (CASE on a bound "sent" flag for `trashed_at`), lifecycle, routes, Cron.
- [ ] `npx tsc --noEmit -p . && npx vitest run` → all pass. Commit.

### Task 2: Store — today goals, progress, auto-start, postpone, trash/archive

**Files:** Modify `src/store.ts`, `src/api.ts` (`deleteTask(id)`, `emptyTrash()`).

**Interfaces — Produces (all in `src/store.ts`):**
- `isLive(t)` (not archived, not trashed); `inToday(t, day)` = picked or due now.
- `progressOf(tasks, id): { done: number; total: number; ratio: number | null }` (null when no subtasks).
- `goalOf(tasks, t, day): { done: number; total: number; achieved: boolean }` — goals = live subtasks with `today === day`; none → achieved = `t.status === "done"`, total 0.
- `todayList` ranks achieved last.
- `setGoal(subId, on, day)`; `postpone(id, day): () => void` (undo); `toggleSub(subId): { started: boolean; allDone: boolean }` (todo parent → doing, keeps position).
- `trashTask(id)`, `restoreFromTrash(id)` (done → `doneAt = now`), `archiveDone(id)`, `unarchive(id)` (→ doing), `purgeTask(id): Promise<void>`, `emptyTrash(): Promise<void>`; `archivedList(tasks)`, `trashList(tasks)` (top-level trashed, plus trashed subtasks whose parent is not trashed).
- `moveTask` returns `"moved" | "trashed" | "archived" | null`: left from todo → trash, right from done → archive.
- `save()` normalizes `doneAt`. `startDay(ids, day, goals?: string[])`. `flush()` drops the local task on 410.
- Subtask × and detail delete use `trashTask`.

- [ ] Typecheck passes; behavior covered by Task 3–5 E2E. Commit with Task 3.

### Task 3: Card progress icon, Today goals, postpone, done actions, date guard

**Files:** Modify `src/components/TaskCard.tsx`, `src/components/TaskDetail.tsx`, `src/components/PlanScreen.tsx`, `src/App.tsx`, `src/styles.css`. Tests: `e2e/goals.spec.ts` (new), update `e2e/flick.spec.ts`, `e2e/today.spec.ts`, `e2e/features.spec.ts`.

- TaskCard props: `progress: number | null`, `goal?: { done: number; total: number; achieved: boolean }`, `allowArchive?: boolean`. `.dot.doing` fill = `--p` (ratio, default 0.5) animated; `data-progress` attribute (0–100) for tests. Goal chip `data-testid="goal-chip"`.
- Detail: `today-toggle` text 「今日やるに追加」/「明日以降に延期」; sub rows get `data-testid="goal-toggle"` (aria-pressed) when in today, goal rows class `goal`; counts `data-testid="sub-progress"` 「全体 2/4」 and `data-testid="goal-progress"` 「今日 1/2」; done task shows `data-testid="to-doing"` / `data-testid="to-archive"` instead of the status buttons; bottom 「ゴミ箱に移動」; status buttons ignore clicks for 600 ms after the date input changes or blurs.
- Today header: `today-progress` 「X / Y 達成」 from `goalOf`.
- Plan screen: chosen task with unfinished subtasks lists them with `data-testid="plan-goal"` toggles; passes goals to `startDay`.
- [ ] E2E `e2e/goals.spec.ts`: `report with 4 subtasks: goals 2, finish them → 今日分 完了 while whole is 50%`; `progress icon fills 0→25→50 and recalculates on undo/trash`; `first finished subtask starts the task; due date alone does not`; `postpone keeps progress and undo restores goals`; `done: right flick archives, left returns to doing`. Updated: flick left on todo → 「ゴミ箱に移動しました」+ undo; today toggle copy; detail delete button.
- [ ] Run `npx playwright test` → pass. Commit.

### Task 4: Archive & trash sheets

**Files:** Create `src/components/Shelf.tsx` (`ShelfSheet({ kind: "archive" | "trash", open, onClose })`). Modify `src/App.tsx` (menu items `data-testid="menu-archive"`/`"menu-trash"` with counts), `src/styles.css`. Test `e2e/shelf.spec.ts`.
- Rows: archive → `進行中に戻す` / `ゴミ箱に移動`; trash → `元に戻す` / `完全に削除` (two taps within 5 s), footer `ゴミ箱を空にする` (two taps) + 「30 日で自動的に完全削除されます」; empty state 「なし」.
- [ ] E2E: `done → archive → trash → restore → back in archive`; `purge from trash removes it on the server`; `empty trash`; `a deleted subtask shows as 親 › 子 and restores under its parent`.
- [ ] Run all tests. Commit.

### Task 5: Verify, deploy, record
- [ ] `npx vitest run`, `npx playwright test` all pass; in-app browser at 390 px: goals, icon, postpone, shelves. Fix clear bugs found, re-test.
- [ ] `npx wrangler d1 migrations apply flick --remote`, `npm run deploy`; production check without disturbing Ichi's data (create one test task, then purge it).
- [ ] README features/tech rows (Cron), IchiBrain `40_Dev/flick.md`, commit + push.
