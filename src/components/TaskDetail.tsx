import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { STATUSES } from "../../shared/types";
import { api, HttpError } from "../api";
import { STATUS_LABEL } from "../format";
import { addTask, archiveTask, childrenOf, restoreTask, updateTask, useStore, topPosition } from "../store";
import { toast } from "../toast";
import { Archive, Calendar, Check, Close, Plus, Sparkle } from "./icons";
import { Sheet, SkeletonRows, stagger } from "./Sheet";

export function TaskDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const tasks = useStore((s) => s.tasks);
  const task = id ? tasks[id] : undefined;
  const [title, setTitle] = useState("");
  const [newSub, setNewSub] = useState("");
  const [ideas, setIdeas] = useState<string[] | null>(null);
  const [thinking, setThinking] = useState(false);

  useEffect(() => {
    setTitle(task?.title ?? "");
    setIdeas(null);
    setNewSub("");
    // only when a different task opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const open = !!task && task.archivedAt === null;
  const subs = task ? childrenOf(tasks, task.id) : [];

  const saveTitle = () => {
    const t = title.trim();
    if (task && t && t !== task.title) updateTask(task.id, { title: t });
    else if (task) setTitle(task.title);
  };

  const suggest = async () => {
    if (!task) return;
    setThinking(true);
    setIdeas(null);
    try {
      const r = await api.subtasks(task.title);
      const existing = new Set(subs.map((s) => s.title));
      setIdeas(r.subtasks.filter((s) => !existing.has(s)));
    } catch (e) {
      toast(e instanceof HttpError && e.status === 429 ? "今日の AI 利用回数に達しました" : "提案を取得できませんでした");
    } finally {
      setThinking(false);
    }
  };

  const addSub = (t: string) => task && addTask(t, { parentId: task.id });

  return (
    <Sheet open={open} onClose={onClose} title={task ? STATUS_LABEL[task.status] : ""} testId="detail-sheet">
      {task && (
        <div className="detail">
          <textarea
            className="detail-title"
            value={title}
            rows={2}
            aria-label="タイトル"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
          />

          <div className="seg" role="radiogroup" aria-label="ステータス">
            {STATUSES.map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={task.status === s}
                className={`seg-item ${task.status === s ? "on" : ""}`}
                onClick={() => task.status !== s && updateTask(task.id, { status: s, position: topPosition() })}
              >
                <span>{STATUS_LABEL[s]}</span>
              </button>
            ))}
          </div>

          <label className="field">
            <Calendar />
            <input
              type="date"
              value={task.due ?? ""}
              aria-label="期限"
              onChange={(e) => updateTask(task.id, { due: e.target.value || null })}
            />
            {task.due && (
              <button className="icon-btn tiny" aria-label="期限を消す" onClick={() => updateTask(task.id, { due: null })}>
                <Close width={14} height={14} />
              </button>
            )}
          </label>

          <section className="subs">
            <div className="subs-head">
              <h3>サブタスク</h3>
              <motion.button whileTap={{ scale: 0.94 }} className="btn small ai" onClick={suggest} disabled={thinking} data-testid="suggest">
                <Sparkle width={16} height={16} />
                AI 提案
              </motion.button>
            </div>
            <motion.ul className="sub-list" layout>
              <AnimatePresence initial={false}>
                {subs.map((s) => (
                  <motion.li
                    key={s.id}
                    layout
                    className={`sub ${s.status === "done" ? "done" : ""}`}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    data-testid="subtask"
                  >
                    <motion.button
                      whileTap={{ scale: 0.85 }}
                      className="sub-check"
                      aria-pressed={s.status === "done"}
                      aria-label={s.status === "done" ? "未完了に戻す" : "完了にする"}
                      onClick={() => updateTask(s.id, { status: s.status === "done" ? "todo" : "done" })}
                    >
                      {s.status === "done" && <Check width={13} height={13} />}
                    </motion.button>
                    <span className="sub-title">{s.title}</span>
                    <button className="icon-btn tiny" aria-label="削除" onClick={() => archiveTask(s.id)}>
                      <Close width={14} height={14} />
                    </button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </motion.ul>
            {thinking && <SkeletonRows n={3} />}
            {ideas && ideas.length > 0 && (
              <motion.ul className="ideas" variants={stagger.list} initial="initial" animate="animate">
                {ideas.map((idea) => (
                  <motion.li key={idea} variants={stagger.item} className="idea" data-testid="idea">
                    <span>{idea}</span>
                    <motion.button
                      whileTap={{ scale: 0.85 }}
                      className="icon-btn tiny add"
                      aria-label={`${idea} を追加`}
                      onClick={() => {
                        addSub(idea);
                        setIdeas(ideas.filter((x) => x !== idea));
                      }}
                    >
                      <Plus width={16} height={16} />
                    </motion.button>
                  </motion.li>
                ))}
                <motion.li variants={stagger.item}>
                  <button
                    className="btn small wide"
                    onClick={() => {
                      ideas.forEach(addSub);
                      setIdeas(null);
                    }}
                    data-testid="ideas-all"
                  >
                    すべて追加
                  </button>
                </motion.li>
              </motion.ul>
            )}
            <form
              className="sub-add"
              onSubmit={(e) => {
                e.preventDefault();
                if (newSub.trim()) addSub(newSub);
                setNewSub("");
              }}
            >
              <Plus width={16} height={16} />
              <input value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="サブタスク" aria-label="サブタスクを追加" />
            </form>
          </section>

          <motion.button
            whileTap={{ scale: 0.97 }}
            className="btn danger wide"
            onClick={() => {
              archiveTask(task.id);
              onClose();
              toast("アーカイブしました", { label: "元に戻す", run: () => restoreTask(task.id) });
            }}
          >
            <Archive width={18} height={18} />
            アーカイブ
          </motion.button>
        </div>
      )}
    </Sheet>
  );
}
