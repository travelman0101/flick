import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Task } from "../../shared/types";
import { haptic } from "../format";
import { archivedList, emptyTrash, purgeTask, restoreFromTrash, trashList, trashTask, unarchive, useStore } from "../store";
import { toast } from "../toast";
import { Trash, Undo } from "./icons";
import { Sheet } from "./Sheet";

export type ShelfKind = "archive" | "trash";

const CONFIRM_MS = 5000;

/** Two taps within 5 s: the first arms, the second does it. */
function useArmed() {
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [armed]);
  return [armed, setArmed] as const;
}

const ago = (at: number) => {
  const days = Math.floor((Date.now() - at) / 86_400_000);
  return days <= 0 ? "今日" : `${days} 日前`;
};

/** The archive (kept done tasks) and the trash, opened from the account menu. */
export function ShelfSheet({ kind, onClose }: { kind: ShelfKind | null; onClose: () => void }) {
  const tasks = useStore((s) => s.tasks);
  const [armed, setArmed] = useArmed();
  const [busy, setBusy] = useState(false);
  const list = kind === "archive" ? archivedList(tasks) : kind === "trash" ? trashList(tasks) : [];

  useEffect(() => setArmed(null), [kind, setArmed]);

  const purge = async (t: Task) => {
    if (armed !== t.id) {
      haptic(6);
      setArmed(t.id);
      return;
    }
    setArmed(null);
    try {
      await purgeTask(t.id);
    } catch {
      toast("削除できませんでした");
    }
  };

  const empty = async () => {
    if (armed !== "all") {
      haptic(6);
      setArmed("all");
      return;
    }
    setArmed(null);
    setBusy(true);
    try {
      await emptyTrash();
    } catch {
      toast("削除できませんでした");
    } finally {
      setBusy(false);
    }
  };

  const when = (t: Task) => ago(kind === "archive" ? t.archivedAt! : t.trashedAt!);

  return (
    <Sheet open={kind !== null} onClose={onClose} title={kind === "archive" ? "アーカイブ" : "ゴミ箱"} testId={`shelf-${kind ?? ""}`}>
      <div className="shelf">
        <motion.ul className="shelf-list" layout>
          <AnimatePresence initial={false}>
            {list.map((t) => (
              <motion.li
                key={t.id}
                layout
                className="shelf-row"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0, transition: { duration: 0.18 } }}
                data-testid="shelf-item"
              >
                <div className="shelf-text">
                  <span className="shelf-title">
                    {t.parentId && tasks[t.parentId] ? (
                      <>
                        <span className="shelf-parent">{tasks[t.parentId].title} › </span>
                        {t.title}
                      </>
                    ) : (
                      t.title
                    )}
                  </span>
                  <span className="shelf-meta">{when(t)}</span>
                </div>
                <div className="shelf-actions">
                  {kind === "archive" ? (
                    <>
                      <motion.button whileTap={{ scale: 0.94 }} className="btn small ghost" onClick={() => unarchive(t.id)} data-testid="shelf-to-todo">
                        未完了に戻す
                      </motion.button>
                      <motion.button
                        whileTap={{ scale: 0.94 }}
                        className="btn small ghost danger-text"
                        aria-label="ゴミ箱に移動"
                        onClick={() => {
                          trashTask(t.id);
                          toast("ゴミ箱に移動しました", { label: "元に戻す", run: () => restoreFromTrash(t.id) });
                        }}
                        data-testid="shelf-to-trash"
                      >
                        <Trash width={15} height={15} />
                      </motion.button>
                    </>
                  ) : (
                    <>
                      <motion.button whileTap={{ scale: 0.94 }} className="btn small ghost" onClick={() => restoreFromTrash(t.id)} data-testid="shelf-restore">
                        <Undo width={14} height={14} />
                        元に戻す
                      </motion.button>
                      <motion.button
                        whileTap={{ scale: 0.94 }}
                        className={`btn small ${armed === t.id ? "danger armed" : "ghost danger-text"}`}
                        onClick={() => void purge(t)}
                        data-testid="shelf-purge"
                      >
                        {armed === t.id ? "もう一度で削除" : "完全に削除"}
                      </motion.button>
                    </>
                  )}
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>

        {list.length === 0 && (
          <motion.div className="empty shelf-empty" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} data-testid="shelf-empty">
            <span className="empty-orb" aria-hidden />
            なし
          </motion.div>
        )}

        {kind === "trash" && (
          <div className="shelf-foot">
            <p>30 日で自動的に完全削除されます</p>
            {list.length > 0 && (
              <motion.button
                whileTap={{ scale: 0.97 }}
                className={`btn small wide ${armed === "all" ? "danger armed" : "ghost danger-text"}`}
                onClick={() => void empty()}
                disabled={busy}
                data-testid="shelf-empty-trash"
              >
                {armed === "all" ? "もう一度でゴミ箱を空にする" : "ゴミ箱を空にする"}
              </motion.button>
            )}
          </div>
        )}
        {kind === "archive" && <p className="shelf-foot">完了したタスクは 7 日たつとゴミ箱に移ります。ここに保存したものは残ります</p>}
      </div>
    </Sheet>
  );
}
