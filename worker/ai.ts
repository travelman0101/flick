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
  const json = candidate.slice(start, end + 1);
  try {
    return JSON.parse(json);
  } catch {
    // Models occasionally mix in single quotes: {"subtasks':['a', 'b']}
    try {
      return JSON.parse(json.replace(/'/g, '"'));
    } catch {
      throw new AiOutputError("bad json");
    }
  }
}

/**
 * The JSON shape is spelled out in each prompt. Measured on Workers AI (2026-10):
 * response_format json_object/json_schema sometimes returned broken output, plain
 * prompting did not, so we parse the text ourselves and retry once.
 * `accurate` uses the slower model that gets relative dates right.
 */
async function runJson(c: Context<AppEnv>, system: string, user: string, accurate = false) {
  const model = accurate ? c.env.AI_MODEL : c.env.AI_MODEL_FAST;
  const input = {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: 2048,
    temperature: 0.2,
    ...(model.includes("gpt-oss") ? { reasoning_effort: "low" } : {}),
  };
  for (let attempt = 0; ; attempt++) {
    try {
      return extractJson(await c.env.AI.run(model as any, input as any));
    } catch (e) {
      if (attempt >= 1 || !(e instanceof AiOutputError)) throw e;
    }
  }
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

const isoDay = (today: unknown) =>
  typeof today === "string" && DATE.test(today) ? today : new Date().toISOString().slice(0, 10);

function todayLabel(today: unknown) {
  const d = isoDay(today);
  return `${d}（${WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()]}曜日）`;
}

/** Models are bad at date arithmetic, so hand them a lookup table instead. */
export function calendar(today: unknown, days = 21) {
  const start = new Date(`${isoDay(today)}T00:00:00Z`).getTime();
  const rows: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start + i * 86_400_000);
    const label = i === 0 ? "今日" : i === 1 ? "明日" : i === 2 ? "明後日" : "";
    rows.push(`${d.toISOString().slice(0, 10)}(${WEEKDAYS[d.getUTCDay()]})${label ? ` ${label}` : ""}`);
  }
  return rows.join(", ");
}

/** Days from today to due, for the today-picker prompt. */
function daysLeft(today: unknown, due: string) {
  return Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${isoDay(today)}T00:00:00Z`)) / 86_400_000);
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
    `あなたは日本語のタスク整理アシスタントです。入力は音声入力のメモで、誤変換や話し言葉を含みます。
手順:
1. 誤変換を文脈から正しい語に直す（例: 「イーエス」→「ES」、「ボイスカード」→「ボーイスカウト」）。「えーと」「あの」などは削除する
2. 実行できるタスクごとに分ける（重複はまとめる）
3. 各タスクは「何の・何を」が分かる 30 文字以内の「〜する」形にする。メモにある固有名詞や目的は省略しない
4. 期限の言葉があれば、下のカレンダーから該当する日付を選ぶ。「来週」は次の月曜から始まる週。期限の言葉がなければ null。勝手に期限を作らない
カレンダー: ${calendar(body.today)}
出力は JSON オブジェクトのみ。キーと文字列は必ずダブルクォート。
例: 入力「あしたまでにレポート出すのと牛乳かう」→ {"tasks":[{"title":"レポートを提出する","due":"${calendar(body.today).split(", ")[1].slice(0, 10)}"},{"title":"牛乳を買う","due":null}]}`,
    text,
    true,
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
    `ユーザーのタスクを、すぐ着手できる具体的な手順に分解してください。
- 3〜6 個、実行する順番に並べる
- 各項目はそのタスク固有の具体的な行動にする（「調べる」「確認する」だけの抽象的な項目は禁止）
- 各項目は 25 文字以内の「〜する」形の日本語
出力は JSON オブジェクトのみ。キーと文字列は必ずダブルクォート。
例: 入力「引っ越しの準備」→ {"subtasks":["不用品を捨てるリストを作る","段ボールを20箱用意する","電気・ガスの停止を申し込む","転出届を出す"]}`,
    title,
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
    .map((t) => {
      const due = t.due ? `${t.due}（${daysLeft(body.today, t.due) < 0 ? "期限切れ" : `あと${daysLeft(body.today, t.due)}日`}）` : "なし";
      return `- id=${t.id} | ${t.title} | ${t.status === "doing" ? "進行中" : "未着手"} | 期限: ${due}`;
    })
    .join("\n");
  const raw = await runJson(
    c,
    `今日は ${todayLabel(body.today)} です。タスク一覧から、今日取り組むべきものを最大 3 つ選んでください。
優先順位: 1) 期限切れ・今日・明日 2) 進行中 3) 数日以内の期限 4) すぐ終わる小さなタスク。期限まで 1 週間以上あるものは原則選ばない。
reason は選んだ理由を 20 文字以内の日本語で具体的に（例: 「期限は明日」「進行中で仕上げ段階」「5分で終わる」）。
id は一覧の id をそのまま使う。出力は JSON オブジェクトのみ: {"picks":[{"id":"...","reason":"..."}]}`,
    list,
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
