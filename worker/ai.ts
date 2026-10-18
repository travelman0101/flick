import { Hono, type Context } from "hono";
import type { OrganizeResult, SubtasksResult, TodayResult } from "../shared/types";
import type { AppEnv } from "./env";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

class AiOutputError extends Error {}

/** Pull a JSON object out of whatever shape the model returned. */
export function extractJson(output: unknown): any {
  const o = output as any;
  const candidate = o?.response ?? o?.choices?.[0]?.message?.content ?? o?.output_text ?? o;
  if (candidate && typeof candidate === "object") return candidate;
  if (typeof candidate !== "string") throw new AiOutputError("empty");
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiOutputError("no json");
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new AiOutputError("bad json");
  }
}

async function runJson(c: Context<AppEnv>, system: string, user: string, schema: object) {
  const output = await c.env.AI.run(c.env.AI_MODEL as any, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_schema", json_schema: schema },
    max_tokens: 1024,
    temperature: 0.2,
  } as any);
  return extractJson(output);
}

const cleanTitle = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function underLimit(c: Context<AppEnv>) {
  const day = new Date().toISOString().slice(0, 10);
  const row = await c.env.DB.prepare(
    `INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 1)
     ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1 RETURNING count`,
  )
    .bind(c.get("user").id, day)
    .first<{ count: number }>();
  return (row?.count ?? 0) <= Number(c.env.AI_DAILY_LIMIT || 50);
}

function todayLabel(today: unknown) {
  const d = typeof today === "string" && DATE.test(today) ? today : new Date().toISOString().slice(0, 10);
  return `${d}（${WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()]}曜日）`;
}

const mock = {
  organize: (text: string): OrganizeResult => ({
    tasks: text
      .split(/[。\n、]|あと|それから/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10)
      .map((title) => ({ title, due: null })),
  }),
  subtasks: (title: string): SubtasksResult => ({
    subtasks: [`${title}の段取りを書き出す`, "必要なものをそろえる", "最初の 15 分だけ手をつける"],
  }),
};

export const ai = new Hono<AppEnv>();

ai.onError((err, c) => {
  if (err instanceof AiOutputError) return c.json({ error: "ai output unusable" }, 502);
  console.error("ai error", err);
  return c.json({ error: "ai failed" }, 502);
});

ai.use(async (c, next) => {
  if (!(await underLimit(c))) return c.json({ error: "daily limit reached" }, 429);
  await next();
});

ai.post("/organize", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const text = cleanTitle(body.text, 2000);
  if (!text) return c.json({ error: "text required" }, 400);
  if (c.env.AI_MOCK === "1") return c.json(mock.organize(text));

  const raw = await runJson(
    c,
    `あなたはタスク整理アシスタントです。ユーザーのメモは音声入力のため、誤変換や話し言葉（えーと、あの 等）を含みます。
1. 文脈から誤変換を直し、話し言葉を取り除く
2. 実行できるタスクに分ける（1 つのメモに複数あれば分割、重複はまとめる）
3. 各タスクは 30 文字以内の「〜する」形の簡潔な日本語にする
4. 期限を表す言葉（明日、金曜まで、来週 等）があれば、今日 = ${todayLabel(body.today)} を基準に YYYY-MM-DD に変換する。なければ null
JSON だけを出力: {"tasks":[{"title":"...","due":"YYYY-MM-DD" または null}]}`,
    text,
    {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: { title: { type: "string" }, due: { type: ["string", "null"] } },
            required: ["title", "due"],
          },
        },
      },
      required: ["tasks"],
    },
  );
  if (!Array.isArray(raw?.tasks)) throw new AiOutputError("shape");
  const tasks = raw.tasks
    .map((t: any) => ({ title: cleanTitle(t?.title), due: typeof t?.due === "string" && DATE.test(t.due) ? t.due : null }))
    .filter((t: { title: string }) => t.title)
    .slice(0, 10);
  return c.json({ tasks } satisfies OrganizeResult);
});

ai.post("/subtasks", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const title = cleanTitle(body.title, 500);
  if (!title) return c.json({ error: "title required" }, 400);
  if (c.env.AI_MOCK === "1") return c.json(mock.subtasks(title));

  const raw = await runJson(
    c,
    `ユーザーのタスクを、すぐ着手できる具体的な次の一手に分解してください。
- 3〜6 個、実行順に並べる
- 各項目は 25 文字以内の「〜する」形の日本語
JSON だけを出力: {"subtasks":["...", "..."]}`,
    title,
    { type: "object", properties: { subtasks: { type: "array", items: { type: "string" } } }, required: ["subtasks"] },
  );
  if (!Array.isArray(raw?.subtasks)) throw new AiOutputError("shape");
  const subtasks = raw.subtasks.map((s: unknown) => cleanTitle(s)).filter(Boolean).slice(0, 6);
  return c.json({ subtasks } satisfies SubtasksResult);
});

ai.post("/today", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { results } = await c.env.DB.prepare(
    `SELECT id, title, status, due FROM tasks
     WHERE user_id = ? AND archived_at IS NULL AND status != 'done' AND parent_id IS NULL
     ORDER BY position DESC LIMIT 60`,
  )
    .bind(c.get("user").id)
    .all<{ id: string; title: string; status: string; due: string | null }>();
  if (results.length === 0) return c.json({ picks: [] } satisfies TodayResult);
  if (c.env.AI_MOCK === "1") {
    return c.json({ picks: results.slice(0, 3).map((t) => ({ id: t.id, reason: t.status === "doing" ? "進行中" : "早めに片づけたい" })) });
  }

  const list = results
    .map((t) => `- id=${t.id} | ${t.title} | ${t.status === "doing" ? "進行中" : "未着手"} | 期限: ${t.due ?? "なし"}`)
    .join("\n");
  const raw = await runJson(
    c,
    `今日は ${todayLabel(body.today)} です。ユーザーのタスク一覧から、今日やるべきものを最大 3 つ選んでください。
期限が近いもの、進行中のもの、短時間で終わるものを優先します。理由は 20 文字以内の日本語。
id は一覧にあるものをそのまま使うこと。
JSON だけを出力: {"picks":[{"id":"...","reason":"..."}]}`,
    list,
    {
      type: "object",
      properties: {
        picks: {
          type: "array",
          items: { type: "object", properties: { id: { type: "string" }, reason: { type: "string" } }, required: ["id", "reason"] },
        },
      },
      required: ["picks"],
    },
  );
  if (!Array.isArray(raw?.picks)) throw new AiOutputError("shape");
  const open = new Set(results.map((t) => t.id));
  const seen = new Set<string>();
  const picks = raw.picks
    .filter((p: any) => typeof p?.id === "string" && open.has(p.id) && !seen.has(p.id) && seen.add(p.id))
    .slice(0, 3)
    .map((p: any) => ({ id: p.id, reason: cleanTitle(p.reason, 40) }));
  return c.json({ picks } satisfies TodayResult);
});
