import { animate, motion, useMotionValue, useTransform, type PanInfo } from "motion/react";
import { useRef, useState } from "react";
import type { Task } from "../../shared/types";
import { dueLabel, haptic, STATUS_LABEL } from "../format";
import { Archive, ArrowLeft, ArrowRight, Check, NoteIcon, Paperclip } from "./icons";

const THRESHOLD = 96;
const VELOCITY = 650;

interface Props {
  task: Task;
  subtasks: { done: number; total: number };
  onOpen: (id: string) => void;
  onFlick: (id: string, dir: 1 | -1) => void;
}

export function TaskCard({ task, subtasks, onOpen, onFlick }: Props) {
  const x = useMotionValue(0);
  const [armed, setArmed] = useState<0 | 1 | -1>(0);
  const busy = useRef(false);
  const dragged = useRef(false);
  const canNext = task.status !== "done";

  const rightOpacity = useTransform(x, [12, THRESHOLD], [0, 1]);
  const leftOpacity = useTransform(x, [-THRESHOLD, -12], [1, 0]);
  const rotate = useTransform(x, [-240, 0, 240], [-4, 0, 4]);
  const scale = useTransform(x, [-THRESHOLD, 0, THRESHOLD], [0.98, 1, 0.98]);

  const nextLabel = task.status === "todo" ? STATUS_LABEL.doing : STATUS_LABEL.done;
  const prevLabel = task.status === "todo" ? "アーカイブ" : task.status === "doing" ? STATUS_LABEL.todo : STATUS_LABEL.doing;

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
    if (!dir || busy.current) {
      animate(x, 0, { type: "spring", stiffness: 520, damping: 34 });
      return;
    }
    busy.current = true;
    haptic(14);
    await animate(x, dir * (window.innerWidth + 80), { type: "spring", stiffness: 260, damping: 32, velocity: v });
    onFlick(task.id, dir);
  }

  const due = task.due ? dueLabel(task.due) : null;
  const hasNote = task.note.trim().length > 0;
  const files = task.attachmentCount ?? 0;

  return (
    <div className="card-shell" data-testid="task" data-id={task.id} data-status={task.status}>
      <motion.div className="swipe-bg right" style={{ opacity: rightOpacity }} aria-hidden>
        <motion.span className="swipe-hint" animate={{ scale: armed === 1 ? 1.15 : 0.9 }}>
          {task.status === "doing" ? <Check /> : <ArrowRight />}
          {nextLabel}
        </motion.span>
      </motion.div>
      <motion.div className={`swipe-bg left ${task.status === "todo" ? "archive" : ""}`} style={{ opacity: leftOpacity }} aria-hidden>
        <motion.span className="swipe-hint" animate={{ scale: armed === -1 ? 1.15 : 0.9 }}>
          {prevLabel}
          {task.status === "todo" ? <Archive /> : <ArrowLeft />}
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
        <StatusDot status={task.status} />
        <div className="card-body">
          <div className={`card-title ${task.status === "done" ? "is-done" : ""}`}>{task.title}</div>
          {(due || subtasks.total > 0 || hasNote || files > 0) && (
            <div className="card-meta">
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

function StatusDot({ status }: { status: Task["status"] }) {
  return (
    <span className={`dot ${status}`} aria-hidden>
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
    </span>
  );
}
