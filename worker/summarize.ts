import { runText } from "./ai";
import type { Env } from "./env";

/**
 * One-time attachment summaries. When a file is attached we read it once, keep a
 * ~300-character summary, and subtask ideas read that summary instead of the file:
 * cheap on the free AI allowance and no extra wait when asking for ideas.
 */

/** Only the start of long documents is read: enough to know what it is about. */
export const READ_CHARS = 8000;
const SUMMARY_CHARS = 300;

const TEXT = /^(text\/|application\/(json|xml|csv))/;

/** Text content of a file, or null when it cannot be read. PDFs, images and Office files go through toMarkdown. */
export async function extractText(env: Env, name: string, type: string, bytes: ArrayBuffer): Promise<string | null> {
  if (TEXT.test(type)) return new TextDecoder().decode(bytes).slice(0, READ_CHARS);
  try {
    const res = await env.AI.toMarkdown({ name, blob: new Blob([bytes], { type }) });
    return res.format === "error" ? null : res.data.slice(0, READ_CHARS);
  } catch {
    return null;
  }
}

export async function summarize(env: Env, name: string, text: string): Promise<string | null> {
  if (env.AI_MOCK === "1") return `${name} の内容（要約）`;
  const body = text.trim();
  if (!body) return null;
  try {
    const summary = await runText(
      env,
      env.AI_MODEL_FAST,
      `添付ファイルの内容を、タスクの手順を考えるための材料として日本語で要約してください。
- ${SUMMARY_CHARS} 字以内、箇条書き可
- 日付・場所・人数・金額・締切など具体的な事実を優先して残す
- 推測で情報を足さない。要約だけを出力する`,
      `ファイル名: ${name}\n---\n${body.slice(0, READ_CHARS)}`,
      400,
    );
    return summary.slice(0, SUMMARY_CHARS + 50);
  } catch {
    return null;
  }
}

/** Google Drive: export Docs/Sheets/Slides as text, download other files. Needs the Drive API and a drive.file token. */
export async function driveText(accessToken: string, url: string, mimeType: string, name: string, env: Env) {
  const id = /\/d\/([A-Za-z0-9_-]+)/.exec(url)?.[1] ?? new URL(url).searchParams.get("id");
  if (!id) return null;
  const auth = { authorization: `Bearer ${accessToken}` };
  const exportAs: Record<string, string> = {
    "application/vnd.google-apps.document": "text/plain",
    "application/vnd.google-apps.spreadsheet": "text/csv",
    "application/vnd.google-apps.presentation": "text/plain",
  };
  const api = "https://www.googleapis.com/drive/v3/files/";
  if (exportAs[mimeType]) {
    const res = await fetch(`${api}${id}/export?mimeType=${encodeURIComponent(exportAs[mimeType])}`, { headers: auth });
    return res.ok ? (await res.text()).slice(0, READ_CHARS) : null;
  }
  if (mimeType.startsWith("application/vnd.google-apps")) return null; // forms, folders, …
  const res = await fetch(`${api}${id}?alt=media`, { headers: auth });
  if (!res.ok || Number(res.headers.get("content-length") ?? 0) > 10 * 1024 * 1024) return null;
  return extractText(env, name, mimeType, await res.arrayBuffer());
}
