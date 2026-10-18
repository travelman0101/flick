import type { Status } from "../shared/types";

export const STATUS_LABEL: Record<Status, string> = { todo: "未着手", doing: "進行中", done: "完了" };

const WD = ["日", "月", "火", "水", "木", "金", "土"];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "今日" / "明日" / "10/24(金)" plus a tone for styling. */
export function dueLabel(due: string): { text: string; tone: "late" | "soon" | "later" } {
  const [y, m, d] = due.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const diff = Math.round((startOfDay(date) - startOfDay(new Date())) / 86_400_000);
  const tone = diff < 0 ? "late" : diff <= 1 ? "soon" : "later";
  if (diff === 0) return { text: "今日", tone };
  if (diff === 1) return { text: "明日", tone };
  if (diff === -1) return { text: "昨日", tone };
  return { text: `${m}/${d}(${WD[date.getDay()]})`, tone };
}

export const haptic = (ms = 8) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
};
