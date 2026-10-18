import { motion } from "motion/react";
import { STATUSES, type Status } from "../../shared/types";
import { STATUS_LABEL } from "../format";

interface Props {
  value: Status;
  counts: Record<Status, number>;
  onChange: (s: Status) => void;
}

export function StatusTabs({ value, counts, onChange }: Props) {
  return (
    <nav className="glass refractive tabs" role="tablist" aria-label="ステータス">
      {STATUSES.map((s) => (
        <button
          key={s}
          role="tab"
          aria-selected={value === s}
          className={`tab ${value === s ? "active" : ""}`}
          onClick={() => onChange(s)}
          data-testid={`tab-${s}`}
        >
          {value === s && (
            <motion.span layoutId="tab-pill" className="tab-pill" transition={{ type: "spring", stiffness: 480, damping: 36 }} />
          )}
          <span className="tab-label">{STATUS_LABEL[s]}</span>
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
