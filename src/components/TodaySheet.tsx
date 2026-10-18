import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { TodayResult } from "../../shared/types";
import { api, HttpError } from "../api";
import { flush, updateTask, useStore, topPosition } from "../store";
import { Sheet, SkeletonRows, stagger } from "./Sheet";

export function TodaySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [picks, setPicks] = useState<TodayResult["picks"] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const tasks = useStore((s) => s.tasks);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setPicks(null);
    setFailed(null);
    flush()
      .then(() => api.today())
      .then((r) => alive && setPicks(r.picks))
      .catch((e) => alive && setFailed(e instanceof HttpError && e.status === 429 ? "今日の AI 利用回数に達しました" : "提案を取得できませんでした"));
    return () => {
      alive = false;
    };
  }, [open]);

  return (
    <Sheet open={open} onClose={onClose} title="今日やること" testId="today-sheet">
      <AnimatePresence mode="wait">
        {!picks && !failed && (
          <motion.div key="loading" exit={{ opacity: 0 }}>
            <SkeletonRows n={3} />
          </motion.div>
        )}
        {failed && (
          <motion.p key="failed" className="sheet-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {failed}
          </motion.p>
        )}
        {picks && picks.length === 0 && (
          <motion.p key="empty" className="sheet-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            未着手・進行中のタスクがありません
          </motion.p>
        )}
        {picks && picks.length > 0 && (
          <motion.ol key="list" className="today-list" variants={stagger.list} initial="initial" animate="animate">
            {picks.map((p, i) => {
              const t = tasks[p.id];
              if (!t) return null;
              return (
                <motion.li key={p.id} variants={stagger.item} className="today-item" data-testid="today-item">
                  <span className="today-rank">{i + 1}</span>
                  <div className="today-text">
                    <div className="today-title">{t.title}</div>
                    <div className="today-reason">{p.reason}</div>
                  </div>
                  {t.status === "todo" ? (
                    <motion.button
                      whileTap={{ scale: 0.94 }}
                      className="btn small"
                      onClick={() => updateTask(p.id, { status: "doing", position: topPosition() })}
                    >
                      始める
                    </motion.button>
                  ) : (
                    <span className="chip">{t.status === "doing" ? "進行中" : "完了"}</span>
                  )}
                </motion.li>
              );
            })}
          </motion.ol>
        )}
      </AnimatePresence>
    </Sheet>
  );
}
