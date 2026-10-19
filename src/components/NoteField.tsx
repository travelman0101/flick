import { useEffect, useRef, useState } from "react";
import { updateTask } from "../store";

const SAVE_DELAY = 500;

/** Free-form memo for a task. Saves while typing, and immediately on blur or close. */
export function NoteField({ taskId, note }: { taskId: string; note: string }) {
  const [value, setValue] = useState(note);
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

  useEffect(grow, [value]);

  // closing the sheet must not lose the last keystrokes
  useEffect(() => save, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <label className="note">
      <textarea
        ref={ref}
        className="note-input"
        value={value}
        rows={3}
        maxLength={10_000}
        placeholder="メモ"
        aria-label="メモ"
        data-testid="note"
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          if (pending.current) clearTimeout(pending.current.timer);
          pending.current = { value: v, timer: setTimeout(save, SAVE_DELAY) };
        }}
        onBlur={save}
      />
    </label>
  );
}
