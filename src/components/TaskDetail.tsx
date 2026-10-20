import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { STATUSES } from "../../shared/types";
import { api, HttpError } from "../api";
import { STATUS_LABEL } from "../format";
import {
  addTask,
  archiveDone,
  childrenOf,
  goalOf,
  inToday,
  isDueNow,
  isLive,
  isPicked,
  postpone,
  progressOf,
  restoreFromTrash,
  setGoal,
  setToday,
  toggleSub,
  topPosition,
  trashTask,
  unarchiveInPlace,
  updateTask,
  useStore,
} from "../store";
import { toast } from "../toast";
import { Attachments } from "./Attachments";
import { Archive, ArrowLeft, Calendar, Check, Close, Plus, Sparkle, Sun, Trash } from "./icons";
import { NoteField } from "./NoteField";
import { Sheet, SkeletonRows, stagger } from "./Sheet";

export function TaskDetail({
  id,
  day,
  autoDrive = false,
  onClose,
}: {
  id: string | null;
  day: string;
  /** open the Drive picker right away (back from connecting Drive) */
  autoDrive?: boolean;
  onClose: () => void;
}) {
  const tasks = useStore((s) => s.tasks);
  const task = id ? tasks[id] : undefined;
  const [title, setTitle] = useState("");
  const [newSub, setNewSub] = useState("");
  const [ideas, setIdeas] = useState<string[] | null>(null);
  const [thinking, setThinking] = useState(false);
  // iPhone: the tap that closes the date picker can land on the status buttons right above it
  const dateTouched = useRef(0);
  const statusLocked = () => Date.now() - dateTouched.current < 600;

  useEffect(() => {
    setTitle(task?.title ?? "");
    setIdeas(null);
    setNewSub("");
    // only when a different task opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const open = !!task && isLive(task);
  const subs = task ? childrenOf(tasks, task.id) : [];
  const today = !!task && task.parentId === null && inToday(task, day);
  const progress = task ? progressOf(tasks, task.id) : null;
  const goal = task ? goalOf(tasks, task, day) : null;
  const unfinished = subs.filter((s) => s.status !== "done").length;

  const tick = (subId: string) => {
    const parentId = task?.id;
    const { allDone } = toggleSub(subId);
    if (allDone && parentId)
      toast("すべて完了。タスクも完了にする？", { label: "完了にする", run: () => updateTask(parentId, { status: "done", position: topPosition() }) });
  };

  const trash = (id: string) => {
    trashTask(id);
    toast("ゴミ箱に移動しました", { label: "元に戻す", run: () => restoreFromTrash(id) });
  };

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
      const r = await api.subtasks(task.title, task.note, task.id);
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

          {task.parentId === null && (
            <motion.button
              whileTap={{ scale: 0.97 }}
              className={`today-toggle ${isPicked(task, day) ? "postpone" : isDueNow(task, day) ? "on" : ""}`}
              disabled={isDueNow(task, day) && !isPicked(task, day)}
              onClick={() => {
                if (isPicked(task, day)) toast("延期しました", { label: "元に戻す", run: postpone(task.id, day) });
                else setToday(task.id, true, day);
              }}
              data-testid="today-toggle"
            >
              {isPicked(task, day) ? <ArrowLeft width={18} height={18} /> : <Sun width={18} height={18} />}
              {isDueNow(task, day) && !isPicked(task, day)
                ? "期限が今日までなので今日に入っています"
                : isPicked(task, day)
                  ? "明日以降に延期"
                  : "今日やるに追加"}
            </motion.button>
          )}

          {task.status === "done" && task.parentId === null ? (
            <div className="done-actions">
              <motion.button
                whileTap={{ scale: 0.97 }}
                className="btn small ghost"
                onClick={() => updateTask(task.id, { status: "todo", position: topPosition() })}
                data-testid="to-todo"
              >
                <ArrowLeft width={16} height={16} />
                未完了に戻す
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.97 }}
                className="btn small keep"
                onClick={() => {
                  archiveDone(task.id);
                  onClose();
                  toast("アーカイブに保存しました", { label: "元に戻す", run: () => unarchiveInPlace(task.id) });
                }}
                data-testid="to-archive"
              >
                <Archive width={16} height={16} />
                アーカイブに保存
              </motion.button>
            </div>
          ) : (
            <div className="seg" role="radiogroup" aria-label="ステータス">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  role="radio"
                  aria-checked={task.status === s}
                  className={`seg-item ${task.status === s ? "on" : ""}`}
                  onClick={() => !statusLocked() && task.status !== s && updateTask(task.id, { status: s, position: topPosition() })}
                >
                  <span>{STATUS_LABEL[s]}</span>
                </button>
              ))}
            </div>
          )}

          <label className="field">
            <Calendar />
            <input
              type="date"
              value={task.due ?? ""}
              aria-label="期限"
              onChange={(e) => {
                dateTouched.current = Date.now();
                updateTask(task.id, { due: e.target.value || null });
              }}
              onBlur={() => (dateTouched.current = Date.now())}
            />
            {task.due && (
              <button className="icon-btn tiny" aria-label="期限を消す" onClick={() => updateTask(task.id, { due: null })}>
                <Close width={14} height={14} />
              </button>
            )}
          </label>

          <NoteField taskId={task.id} note={task.note} />

          <section className="subs">
            <div className="subs-head">
              <h3>サブタスク</h3>
              {progress && progress.total > 0 && (
                <span className="sub-count" data-testid="sub-progress">
                  全体 {progress.done}/{progress.total}
                </span>
              )}
              {today && goal && goal.total > 0 && (
                <span className={`sub-count goal ${goal.achieved ? "achieved" : ""}`} data-testid="goal-progress">
                  <Sun width={12} height={12} />
                  今日 {goal.done}/{goal.total}
                </span>
              )}
              <motion.button whileTap={{ scale: 0.94 }} className="btn small ai" onClick={suggest} disabled={thinking} data-testid="suggest">
                <Sparkle width={16} height={16} />
                AI 提案
              </motion.button>
            </div>
            {today && goal && goal.total === 0 && unfinished > 0 && (
              <p className="goal-hint" data-testid="goal-hint">
                <Sun width={13} height={13} />
                今日やる分をタップ
              </p>
            )}
            <motion.ul className="sub-list" layout>
              <AnimatePresence initial={false}>
                {subs.map((s) => (
                  <motion.li
                    key={s.id}
                    layout
                    className={`sub ${s.status === "done" ? "done" : ""} ${today && s.today === day ? "goal" : ""}`}
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
                      onClick={() => tick(s.id)}
                    >
                      {s.status === "done" && <Check width={13} height={13} />}
                    </motion.button>
                    <span className="sub-title">{s.title}</span>
                    {today && (
                      <motion.button
                        whileTap={{ scale: 0.8 }}
                        className={`icon-btn tiny goal-toggle ${s.today === day ? "on" : ""}`}
                        aria-pressed={s.today === day}
                        aria-label={s.today === day ? "今日の目標から外す" : "今日の目標にする"}
                        onClick={() => setGoal(s.id, s.today !== day, day)}
                        data-testid="goal-toggle"
                      >
                        <Sun width={15} height={15} />
                      </motion.button>
                    )}
                    <button className="icon-btn tiny" aria-label="削除" onClick={() => trash(s.id)}>
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

          <Attachments taskId={task.id} autoDrive={autoDrive} />

          <motion.button
            whileTap={{ scale: 0.97 }}
            className="btn danger wide"
            onClick={() => {
              onClose();
              trash(task.id);
            }}
            data-testid="detail-trash"
          >
            <Trash width={18} height={18} />
            ゴミ箱に移動
          </motion.button>
        </div>
      )}
    </Sheet>
  );
}
