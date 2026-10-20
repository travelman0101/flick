import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { updateTask } from "../store";
import { NoteIcon } from "./icons";

const SAVE_DELAY = 500;

/**
 * Free-form memo for a task, folded by default so subtasks stay in view.
 * Saves while typing, and immediately on blur or close.
 */
export function NoteField({ taskId, note }: { taskId: string; note: string }) {
  const [value, setValue] = useState(note);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; value: string } | null>(null);

  const save = () => {
    if (!pending.current) return;
    clearTimeout(pending.current.timer);
    updateTask(taskId, { note: pending.current.value });
    pending.current = null;
  };

  const grow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  };

  // a different task opened, or another device changed the note while we were idle
  useEffect(() => {
    if (!pending.current) setValue(note);
  }, [taskId, note]);

  // each task opens folded
  useEffect(() => setOpen(false), [taskId]);

  useEffect(grow, [value, open]);

  // closing the sheet must not lose the last keystrokes
  useEffect(() => save, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  const empty = value.trim().length === 0;
  const firstLine = value.trim().split("\n")[0];

  const toggle = () => {
    if (open) save();
    setOpen(!open);
  };

  return (
    <section className={`note ${open ? "open" : ""}`}>
      <button
        className="note-head"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={`note-${taskId}`}
        data-testid="note-toggle"
      >
        <NoteIcon width={16} height={16} />
        <span className="note-label">{empty ? "メモを追加" : "メモ"}</span>
        {!open && !empty && (
          <span className="note-peek" data-testid="note-peek">
            {firstLine}
          </span>
        )}
        {!empty && <span className="note-count">{value.length} 字</span>}
        <motion.span className="note-chevron" animate={{ rotate: open ? 180 : 0 }} aria-hidden>
          ▾
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`note-${taskId}`}
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 38 }}
            style={{ overflow: "hidden" }}
            onAnimationComplete={grow}
          >
            <textarea
              ref={ref}
              className="note-input"
              value={value}
              rows={3}
              maxLength={10_000}
              placeholder="メモ"
              aria-label="タスクのメモ"
              data-testid="note"
              autoFocus={empty}
              onChange={(e) => {
                const v = e.target.value;
                setValue(v);
                if (pending.current) clearTimeout(pending.current.timer);
                pending.current = { value: v, timer: setTimeout(save, SAVE_DELAY) };
              }}
              onBlur={save}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
