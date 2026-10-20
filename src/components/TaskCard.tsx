import { animate, motion, useMotionValue, useTransform, type PanInfo } from "motion/react";
import { useRef, useState } from "react";
import type { Task } from "../../shared/types";
import { dueLabel, haptic, STATUS_LABEL } from "../format";
import { Archive, ArrowLeft, ArrowRight, Check, NoteIcon, Paperclip, Sun, Trash } from "./icons";

const THRESHOLD = 96;
const VELOCITY = 650;

interface Props {
  task: Task;
  subtasks: { done: number; total: number };
  onOpen: (id: string) => void;
  /** "stay": the task is still in this list afterwards, so the card slides back in */
  onFlick: (id: string, dir: 1 | -1) => "leave" | "stay";
  /** label for a left flick on a todo (default: archive) */
  leftLabel?: string;
  /** small "今日" chip in the status columns */
  pickedToday?: boolean;
  /** whole-task progress from subtasks (0..1), null without subtasks */
  progress: number | null;
  /** today's goal, shown in the Today list */
  goal?: { done: number; total: number; achieved: boolean };
  /** a right flick on a done task keeps it in the archive (not in Today, to avoid accidents) */
  allowArchive?: boolean;
}

export function TaskCard({ task, subtasks, onOpen, onFlick, leftLabel, pickedToday, progress, goal, allowArchive = false }: Props) {
  const x = useMotionValue(0);
  const [armed, setArmed] = useState<0 | 1 | -1>(0);
  const busy = useRef(false);
  const dragged = useRef(false);
  const canNext = task.status !== "done" || allowArchive;

  const rightOpacity = useTransform(x, [12, THRESHOLD], [0, 1]);
  const leftOpacity = useTransform(x, [-THRESHOLD, -12], [1, 0]);
  const rotate = useTransform(x, [-240, 0, 240], [-4, 0, 4]);
  const scale = useTransform(x, [-THRESHOLD, 0, THRESHOLD], [0.98, 1, 0.98]);

  const nextLabel = task.status === "todo" ? STATUS_LABEL.doing : task.status === "doing" ? STATUS_LABEL.done : "アーカイブに保存";
  const trashes = task.status === "todo" && !leftLabel;
  const prevLabel =
    task.status === "todo" ? (leftLabel ?? "ゴミ箱") : task.status === "doing" ? STATUS_LABEL.todo : "進行中に戻す";

  function onDrag(_: unknown, info: PanInfo) {
    const o = info.offset.x;
    const next: 0 | 1 | -1 = o > THRESHOLD && canNext ? 1 : o < -THRESHOLD ? -1 : 0;
    if (next !== armed) {
      if (next !== 0) haptic();
      setArmed(next);
    }
  }

  async function onDragEnd(_: unknown, info: PanInfo) {
    const o = info.offset.x;
    const v = info.velocity.x;
    let dir: 0 | 1 | -1 = o > THRESHOLD || (v > VELOCITY && o > 24) ? 1 : o < -THRESHOLD || (v < -VELOCITY && o < -24) ? -1 : 0;
    if (dir === 1 && !canNext) dir = 0;
    setArmed(0);
    if (!dir) {
      animate(x, 0, { type: "spring", stiffness: 520, damping: 34 });
      return;
    }
    haptic(14);
    // Commit first: the fly-out is only visual, and it gets cut short if the list
    // changes underneath (e.g. a tab switch), which must not lose the flick.
    const stays = onFlick(task.id, dir) === "stay";
    busy.current = true;
    await animate(x, dir * (window.innerWidth + 80), { type: "spring", stiffness: 260, damping: 32, velocity: v });
    busy.current = false;
    if (stays) {
      // re-enter from the other side with the new status
      x.jump(-dir * 140);
      animate(x, 0, { type: "spring", stiffness: 380, damping: 30 });
    }
  }

  const due = task.due ? dueLabel(task.due) : null;
  const hasNote = task.note.trim().length > 0;
  const files = task.attachmentCount ?? 0;

  return (
    <div className="card-shell" data-testid="task" data-id={task.id} data-status={task.status}>
      <motion.div className={`swipe-bg right ${task.status === "done" ? "keep" : ""}`} style={{ opacity: rightOpacity }} aria-hidden>
        <motion.span className="swipe-hint" animate={{ scale: armed === 1 ? 1.15 : 0.9 }}>
          {task.status === "doing" ? <Check /> : task.status === "done" ? <Archive /> : <ArrowRight />}
          {nextLabel}
        </motion.span>
      </motion.div>
      <motion.div className={`swipe-bg left ${trashes ? "archive" : ""}`} style={{ opacity: leftOpacity }} aria-hidden>
        <motion.span className="swipe-hint" animate={{ scale: armed === -1 ? 1.15 : 0.9 }}>
          {prevLabel}
          {trashes ? <Trash /> : <ArrowLeft />}
        </motion.span>
      </motion.div>

      <motion.div
        className="glass card"
        style={{ x, rotate, scale }}
        drag="x"
        dragDirectionLock
        dragMomentum={false}
        onPointerDown={() => (dragged.current = false)}
        onDragStart={() => (dragged.current = true)}
        onDrag={onDrag}
        onDragEnd={onDragEnd}
        onTap={() => {
          // a drag that ends where it started still counts as a drag, never a tap
          if (dragged.current || busy.current || Math.abs(x.get()) > 4) return;
          onOpen(task.id);
        }}
        whileTap={{ scale: 0.985 }}
        role="button"
        tabIndex={0}
        aria-label={`${task.title}（${STATUS_LABEL[task.status]}）`}
        onKeyDown={(e) => {
          if (e.key === "Enter") onOpen(task.id);
          if (e.key === "ArrowRight" && canNext) onFlick(task.id, 1);
          if (e.key === "ArrowLeft") onFlick(task.id, -1);
        }}
      >
        <StatusDot status={task.status} progress={progress} />
        <div className="card-body">
          <div className={`card-title ${task.status === "done" ? "is-done" : ""}`}>{task.title}</div>
          {(pickedToday || goal || due || subtasks.total > 0 || hasNote || files > 0) && (
            <div className="card-meta">
              {goal && (goal.total > 0 || goal.achieved) && (
                <span className={`chip goal ${goal.achieved ? "achieved" : ""}`} data-testid="goal-chip">
                  <Sun width={12} height={12} />
                  {goal.achieved ? "今日分 完了" : `今日 ${goal.done}/${goal.total}`}
                </span>
              )}
              {pickedToday && (
                <span className="chip today" data-testid="picked-today">
                  今日
                </span>
              )}
              {due && <span className={`chip due ${due.tone}`}>{due.text}</span>}
              {subtasks.total > 0 && (
                <span className="chip">
                  {subtasks.done}/{subtasks.total}
                </span>
              )}
              {hasNote && (
                <span className="chip icon" aria-label="メモあり" data-testid="has-note">
                  <NoteIcon width={13} height={13} />
                </span>
              )}
              {files > 0 && (
                <span className="chip icon" aria-label={`添付 ${files} 件`} data-testid="has-files">
                  <Paperclip width={13} height={13} />
                  {files}
                </span>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

/** Doing fills with whole-task progress (done subtasks ÷ subtasks); half when there are none. */
function StatusDot({ status, progress }: { status: Task["status"]; progress: number | null }) {
  const p = status === "doing" ? (progress ?? 0.5) : status === "done" ? 1 : 0;
  return (
    <motion.span
      className={`dot ${status}`}
      aria-hidden
      data-testid="status-dot"
      data-progress={Math.round(p * 100)}
      initial={false}
      animate={{ "--p": `${p * 100}%` } as Record<string, string>}
      transition={{ type: "spring", stiffness: 170, damping: 24 }}
    >
      {status === "done" && (
        <svg viewBox="0 0 24 24" width="14" height="14">
          <motion.path
            d="M5 12.5l4.5 4.5L19 7.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.35, ease: "easeOut", delay: 0.1 }}
          />
        </svg>
      )}
    </motion.span>
  );
}
