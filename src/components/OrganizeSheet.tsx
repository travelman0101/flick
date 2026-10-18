import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { OrganizeResult } from "../../shared/types";
import { api, HttpError } from "../api";
import { dueLabel } from "../format";
import { addTask } from "../store";
import { toast } from "../toast";
import { Check } from "./icons";
import { Sheet, SkeletonRows, stagger } from "./Sheet";

interface Props {
  text: string | null;
  onClose: () => void;
  onAdded: () => void;
}

type Item = OrganizeResult["tasks"][number] & { on: boolean };

export function OrganizeSheet({ text, onClose, onAdded }: Props) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!text) return;
    let alive = true;
    setItems(null);
    setFailed(null);
    api
      .organize(text)
      .then((r) => alive && setItems(r.tasks.map((t) => ({ ...t, on: true }))))
      .catch((e) => alive && setFailed(e instanceof HttpError && e.status === 429 ? "今日の AI 利用回数に達しました" : "うまく整理できませんでした"));
    return () => {
      alive = false;
    };
  }, [text]);

  const chosen = items?.filter((i) => i.on && i.title.trim()) ?? [];

  const commit = () => {
    [...chosen].reverse().forEach((i) => addTask(i.title, { due: i.due }));
    toast(`${chosen.length} 件追加しました`);
    onAdded();
    onClose();
  };

  const keepRaw = () => {
    if (text) addTask(text.replace(/\s*\n\s*/g, " "));
    onAdded();
    onClose();
  };

  return (
    <Sheet open={text !== null} onClose={onClose} title="AI で整理" testId="organize-sheet">
      <AnimatePresence mode="wait">
        {!items && !failed && (
          <motion.div key="loading" exit={{ opacity: 0 }}>
            <SkeletonRows n={3} />
          </motion.div>
        )}
        {failed && (
          <motion.div key="failed" className="sheet-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <p>{failed}</p>
            <motion.button whileTap={{ scale: 0.96 }} className="btn" onClick={keepRaw}>
              そのまま追加
            </motion.button>
          </motion.div>
        )}
        {items && (
          <motion.div key="result" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <motion.ul className="pick-list" variants={stagger.list} initial="initial" animate="animate">
              {items.map((it, i) => (
                <motion.li key={i} variants={stagger.item} className={`pick ${it.on ? "on" : ""}`} data-testid="organize-item">
                  <button
                    className="pick-toggle"
                    aria-pressed={it.on}
                    aria-label={it.on ? "選択を外す" : "選択する"}
                    onClick={() => setItems(items.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))}
                  >
                    <Check width={14} height={14} />
                  </button>
                  <input
                    className="pick-input"
                    value={it.title}
                    onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                  />
                  {it.due && <span className={`chip due ${dueLabel(it.due).tone}`}>{dueLabel(it.due).text}</span>}
                </motion.li>
              ))}
            </motion.ul>
            {items.length === 0 ? (
              <div className="sheet-empty">
                <p>タスクが見つかりませんでした</p>
                <button className="btn" onClick={keepRaw}>
                  そのまま追加
                </button>
              </div>
            ) : (
              <motion.button
                whileTap={{ scale: 0.97 }}
                className="btn primary wide"
                disabled={!chosen.length}
                onClick={commit}
                data-testid="organize-commit"
              >
                {chosen.length} 件を追加
              </motion.button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Sheet>
  );
}
