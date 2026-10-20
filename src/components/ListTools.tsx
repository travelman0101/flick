import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { SORT_LABEL, SORT_MODES, type SortMode } from "../sort";
import { Check, Close, Search } from "./icons";

interface Props {
  query: string;
  onQuery: (q: string) => void;
  mode: SortMode;
  onMode: (m: SortMode) => void;
}

/** One compact row: search by title or memo, and the sort order. Neither changes the tasks. */
export function ListTools({ query, onQuery, mode, onMode }: Props) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="list-tools" data-testid="list-tools">
      <label className="search">
        <Search width={16} height={16} />
        <input
          ref={input}
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="タスク名・メモを検索"
          aria-label="タスク名・メモを検索"
          enterKeyHint="search"
          data-testid="search"
        />
        <AnimatePresence>
          {query && (
            <motion.button
              type="button"
              className="search-clear"
              aria-label="検索を消す"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              onClick={() => {
                onQuery("");
                input.current?.focus();
              }}
              data-testid="search-clear"
            >
              <Close width={12} height={12} />
            </motion.button>
          )}
        </AnimatePresence>
      </label>
      <div className="sort-wrap" ref={wrap}>
        <motion.button
          type="button"
          whileTap={{ scale: 0.95 }}
          className="sort-button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          data-testid="sort-button"
        >
          {SORT_LABEL[mode]}
          <motion.span className="sort-caret" animate={{ rotate: open ? 180 : 0 }} aria-hidden>
            ▾
          </motion.span>
        </motion.button>
        <AnimatePresence>
          {open && (
            <motion.div
              className="glass sort-menu"
              role="menu"
              aria-label="並び替え"
              initial={{ opacity: 0, scale: 0.92, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: -4 }}
              transition={{ type: "spring", stiffness: 520, damping: 34 }}
            >
              {SORT_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="menuitemradio"
                  aria-checked={m === mode}
                  className={`sort-option ${m === mode ? "on" : ""}`}
                  onClick={() => {
                    onMode(m);
                    setOpen(false);
                  }}
                  data-testid="sort-option"
                >
                  <span className="sort-check">{m === mode && <Check width={13} height={13} />}</span>
                  {SORT_LABEL[m]}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
