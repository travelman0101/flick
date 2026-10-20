# Two Statuses, Sort & Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop the "doing" status (未完了/完了 only, tabs 今日/タスク/完了), and add sort + search to the morning pick and the タスク tab.

**Architecture:** `doing` is migrated to `todo` and normalized on write. Sorting and search are pure functions in `src/sort.ts`, shared by a `ListTools` bar used by `PlanScreen` and the タスク list; the chosen sort is kept per screen in localStorage.

**Tech Stack:** Workers + D1 (Hono), React 19 + Motion, Vitest (workers pool), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-21-two-status-sort-search-design.md`

## Global Constraints
- Statuses exactly `todo` (「未完了」) and `done` (「完了」); tab labels 「今日」「タスク」「完了」.
- Copy: 「未完了に戻す」「アーカイブに保存」「タスク名・メモを検索」「一致するタスクがありません」「おすすめ順」「期限順」「追加順」「自動」「昨日の残り」.
- Base day = app logical day (04:00 boundary). Days until due = due − today in whole days.
- Tie-break: `createdAt` desc, then `id` asc.
- Defaults: morning pick = おすすめ順, タスク tab = 追加順; stored per screen and per user in localStorage (`flick:v1:sort:<screen>:<uid>`).
- Search: NFKC + lowercase, substring on title or note; not persisted.
- Done tab and Today tab: no sort/search UI.

## Review Focus
1. An old PWA still sending `status: "doing"` → stored as `todo` (API test).
2. Overdue tasks in おすすめ order come oldest-due first, before today (unit test).
3. Toggling a check in the morning pick must not reorder the list (E2E: order equal before/after tap).
4. Changing sort while a search term is typed keeps the term and the checks (E2E).
5. A note containing the term but not the title still matches; full-width 「ＫＩＳＣ」 matches 「kisc」 (unit + E2E).

---

### Task 1: Two statuses

**Files:** Create `migrations/0007_two_status.sql`. Modify `shared/types.ts`, `worker/tasks.ts` (normalize `doing` → `todo` before validation), `worker/ai.ts` (today prompt/reasons: 着手済み from subtask counts), `src/format.ts`, `src/store.ts` (`toggleSub` returns `{ allDone }` only; `unarchive` → status `todo`; `moveTask` right from todo → done), `src/components/StatusTabs.tsx` (label 「タスク」 for todo), `TaskCard.tsx` (labels, dot: todo with progress > 0 shows `--p`), `TaskDetail.tsx`, `Shelf.tsx`, `PlanScreen.tsx` (chip), tests: `test/tasks.test.ts`, all `e2e/*.spec.ts` that use 進行中/doing.

**Interfaces — Produces:** `STATUSES = ["todo", "done"] as const`; `STATUS_LABEL = { todo: "未完了", done: "完了" }`; detail `data-testid="to-todo"` (「未完了に戻す」); shelf `data-testid="shelf-to-todo"`; dot `data-progress` = round(ratio×100) for todo with done subtasks, else 0.

- [ ] Test `test/tasks.test.ts`: `stores an old client's "doing" as todo` → PUT `{status:"doing"}` → 200, listed `status === "todo"`.
- [ ] Update E2E for: 3 tabs (`tab-today`, `tab-todo` text 「タスク」, `tab-done`; no `tab-doing`), right flick todo → done, done left → todo, archive → 「未完了に戻す」, progress icon on todo, no auto-move.
- [ ] Implement; `npx tsc --noEmit -p . && npx vitest run && npx playwright test` → pass. Commit.

### Task 2: Sort & search functions

**Files:** Create `src/sort.ts`, `test/sort.test.ts`.

**Interfaces — Produces:**
- `type SortMode = "recommended" | "due" | "added"`; `SORT_LABEL: Record<SortMode, string>`.
- `daysUntil(due: string, day: string): number`.
- `sortTasks(list: Task[], mode: SortMode, ctx: { day: string; started: (t: Task) => boolean }): Task[]` (new array).
- `matches(t: Task, query: string): boolean`; `normalize(s: string): string`.

- [ ] Tests: `recommended: overdue oldest first, then today…+3`; `recommended: started beats 4–7 days, but ≤3 days beats started`; `recommended: 4–7 days before others; others with due before no due`; `due: overdue, today, later, none`; `added: newest first`; `ties: createdAt desc then id`; `search: title or note, case and width insensitive`; `search: empty query matches all`.
- [ ] Implement; `npx vitest run test/sort.test.ts` → pass. Commit.

### Task 3: ListTools bar, morning pick, タスク tab

**Files:** Create `src/components/ListTools.tsx` (`ListTools({ query, onQuery, mode, onMode })`), `src/useSortMode.ts` (`useSortMode(screen: "plan" | "tasks", fallback: SortMode): [SortMode, (m: SortMode) => void]`). Modify `PlanScreen.tsx` (one list, labels `data-testid="plan-auto"` / `"plan-leftover"`), `App.tsx` (タスク tab list = search → sort), `styles.css`. Test `e2e/sort.spec.ts`.
- testids: `search` (input), `search-clear`, `sort-button`, `sort-option` (aria-checked), `no-match`.
- [ ] E2E: `morning pick: search by title and memo, clear, no match`; `morning pick: recommended order, switch to due and added, kept after reload`; `checks and search survive sort changes; tapping does not reorder`; `タスク tab: added order by default, search and sort work, setting kept`.
- [ ] Run all tests → pass. Commit.

### Task 4: Verify, deploy, record
- [ ] Local in-app browser at 390 px; fix clear bugs; full tests again.
- [ ] `npx wrangler d1 migrations apply flick --remote` (check row counts first), `npm run deploy`, production check without changing Ichi's data.
- [ ] README, IchiBrain `40_Dev/flick.md`, commit + push.
