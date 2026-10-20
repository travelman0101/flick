import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { HttpError, api } from "../api";
import { Markdown, plainFirstLine } from "../markdown";
import { updateTask } from "../store";
import { toast } from "../toast";
import { NoteIcon, Sparkle } from "./icons";

const SAVE_DELAY = 500;
const spring = { type: "spring", stiffness: 420, damping: 38 } as const;

/**
 * Free-form memo for a task, folded by default so subtasks stay in view.
 * Open: reads as formatted Markdown, tap to edit. "AI で整える" tidies a dictated
 * note, shows the result first, and replaces only on confirm (with undo).
 */
export function NoteField({ taskId, note }: { taskId: string; note: string }) {
  const [value, setValue] = useState(note);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [tidying, setTidying] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
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
  useEffect(() => {
    setOpen(false);
    setEditing(false);
    setPreview(null);
  }, [taskId]);

  useEffect(grow, [value, open, editing]);

  // closing the sheet must not lose the last keystrokes
  useEffect(() => save, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  const empty = value.trim().length === 0;
  const showEditor = editing || empty;

  const toggle = () => {
    if (open) {
      save();
      setEditing(false);
      setPreview(null);
    }
    setOpen(!open);
  };

  const edit = () => {
    setEditing(true);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  const tidy = async () => {
    save();
    const before = value;
    setTidying(true);
    setPreview(null);
    try {
      const { markdown } = await api.tidy(before);
      if (markdown.trim()) setPreview(markdown);
      else toast("整えられませんでした");
    } catch (e) {
      toast(e instanceof HttpError && e.status === 429 ? "今日の AI 利用回数に達しました" : "整えられませんでした");
    } finally {
      setTidying(false);
    }
  };

  const apply = () => {
    if (preview === null) return;
    const before = value;
    setValue(preview);
    updateTask(taskId, { note: preview });
    setPreview(null);
    setEditing(false);
    toast("メモを整えました", {
      label: "元に戻す",
      run: () => {
        setValue(before);
        updateTask(taskId, { note: before });
      },
    });
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
            {plainFirstLine(value)}
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
            transition={spring}
            style={{ overflow: "hidden" }}
            onAnimationComplete={grow}
          >
            {showEditor ? (
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
                // typing into an empty note must not swap the editor for the read view
                onFocus={() => setEditing(true)}
                onChange={(e) => {
                  const v = e.target.value;
                  setValue(v);
                  if (pending.current) clearTimeout(pending.current.timer);
                  pending.current = { value: v, timer: setTimeout(save, SAVE_DELAY) };
                }}
                onBlur={save}
              />
            ) : (
              <div
                className="note-view md"
                role="button"
                tabIndex={0}
                aria-label="メモを編集"
                data-testid="note-view"
                onClick={edit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    edit();
                  }
                }}
              >
                <Markdown text={value} />
              </div>
            )}

            <AnimatePresence initial={false}>
              {preview !== null && (
                <motion.div
                  key="preview"
                  className="tidy-preview"
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.98 }}
                  transition={spring}
                  data-testid="tidy-preview"
                >
                  <div className="tidy-preview-label">
                    <Sparkle width={13} height={13} />
                    整えたメモ
                  </div>
                  <div className="md">
                    <Markdown text={preview} />
                  </div>
                  <div className="tidy-actions">
                    <button className="btn small ghost" onClick={() => setPreview(null)} data-testid="tidy-cancel">
                      やめる
                    </button>
                    <motion.button whileTap={{ scale: 0.94 }} className="btn small primary" onClick={apply} data-testid="tidy-apply">
                      置き換える
                    </motion.button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {!empty && preview === null && (
              <div className="note-tools">
                <motion.button
                  whileTap={{ scale: 0.94 }}
                  className={`btn small ai ${tidying ? "busy" : ""}`}
                  onClick={tidy}
                  disabled={tidying}
                  data-testid="tidy"
                >
                  <Sparkle width={14} height={14} />
                  {tidying ? "整えています…" : "AI で整える"}
                </motion.button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
