import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { haptic } from "../format";
import { addTask, drainBootQueue } from "../store";
import { ArrowUp, Sparkle } from "./icons";

declare global {
  interface Window {
    __flickBoot?: (e: KeyboardEvent) => void;
  }
}

const clearDraft = () => {
  try {
    localStorage.removeItem("flick:v1:draft");
  } catch {
    /* ignore */
  }
};

interface Props {
  onAdded: () => void;
  onOrganize: (text: string) => void;
}

/**
 * The memo field lives in index.html so it is usable before React loads.
 * This component adopts it: it never remounts and never loses focus.
 */
export function Composer({ onAdded, onOrganize }: Props) {
  const memo = useRef(document.getElementById("memo") as HTMLTextAreaElement).current;
  const form = useRef(document.getElementById("composer") as HTMLFormElement).current;
  const slot = useRef(document.getElementById("composer-actions") as HTMLDivElement).current;
  const [text, setText] = useState(memo.value);
  const [pulse, setPulse] = useState(0);
  const latest = useRef({ onAdded, onOrganize });
  latest.current = { onAdded, onOrganize };

  useEffect(() => {
    const resize = () => {
      memo.style.height = "auto";
      memo.style.height = `${Math.min(memo.scrollHeight, 200)}px`;
    };
    const submit = () => {
      const lines = memo.value
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (!lines.length) return;
      [...lines].reverse().forEach((l) => addTask(l));
      memo.value = "";
      clearDraft();
      setText("");
      resize();
      haptic();
      setPulse((p) => p + 1);
      latest.current.onAdded();
      memo.focus({ preventScroll: true });
    };
    const onInput = () => {
      setText(memo.value);
      resize();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      submit();
    };
    const onSubmit = (e: Event) => {
      e.preventDefault();
      submit();
    };
    if (window.__flickBoot) memo.removeEventListener("keydown", window.__flickBoot);
    // memos sent while the list was still loading
    drainBootQueue();
    memo.addEventListener("input", onInput);
    memo.addEventListener("keydown", onKey);
    form.addEventListener("submit", onSubmit);
    setText(memo.value);
    resize();
    return () => {
      memo.removeEventListener("input", onInput);
      memo.removeEventListener("keydown", onKey);
      form.removeEventListener("submit", onSubmit);
    };
  }, [memo, form]);

  useEffect(() => {
    if (!pulse) return;
    form.classList.remove("sent");
    void form.offsetWidth; // restart the CSS animation
    form.classList.add("sent");
  }, [pulse, form]);

  const has = text.trim().length > 0;

  return createPortal(
    <AnimatePresence>
      {has && (
        <motion.div
          className="composer-buttons"
          initial={{ opacity: 0, scale: 0.6, x: 12 }}
          animate={{ opacity: 1, scale: 1, x: 0 }}
          exit={{ opacity: 0, scale: 0.6, x: 12 }}
          transition={{ type: "spring", stiffness: 520, damping: 30 }}
        >
          <motion.button
            type="button"
            className="icon-btn ai"
            whileTap={{ scale: 0.88 }}
            aria-label="AI で整理"
            data-testid="organize"
            onClick={() => {
              const t = memo.value.trim();
              if (!t) return;
              memo.value = "";
              clearDraft();
              setText("");
              memo.style.height = "auto";
              latest.current.onOrganize(t);
            }}
          >
            <Sparkle />
          </motion.button>
          <motion.button
            type="submit"
            className="icon-btn send"
            whileTap={{ scale: 0.88 }}
            aria-label="追加"
            data-testid="send"
            // keep the keyboard open for the next memo
            onMouseDown={(e) => e.preventDefault()}
          >
            <ArrowUp />
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>,
    slot,
  );
}
