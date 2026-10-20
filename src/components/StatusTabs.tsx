import { motion } from "motion/react";
import { STATUSES } from "../../shared/types";
import type { View } from "../view";

export const VIEWS: View[] = ["today", ...STATUSES];
// "今日" is a mark, not a status: picked tasks also show under タスク (all open tasks)
const LABEL: Record<View, string> = { today: "今日", todo: "タスク", done: "完了" };

interface Props {
  value: View;
  counts: Record<View, number>;
  onChange: (v: View) => void;
}

export function StatusTabs({ value, counts, onChange }: Props) {
  return (
    <nav className="glass refractive tabs" role="tablist" aria-label="表示">
      {VIEWS.map((s) => (
        <button
          key={s}
          role="tab"
          aria-selected={value === s}
          className={`tab ${value === s ? "active" : ""} ${s === "today" ? "tab-today" : ""}`}
          onClick={() => onChange(s)}
          data-testid={`tab-${s}`}
        >
          {value === s && (
            <motion.span layoutId="tab-pill" className="tab-pill" transition={{ type: "spring", stiffness: 480, damping: 36 }} />
          )}
          <span className="tab-label">{LABEL[s]}</span>
          <motion.span
            key={counts[s]}
            className="tab-count"
            data-testid={`count-${s}`}
            initial={{ scale: 1.6, opacity: 0.4 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 600, damping: 18 }}
          >
            {counts[s]}
          </motion.span>
        </button>
      ))}
    </nav>
  );
}
