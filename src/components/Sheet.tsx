import { AnimatePresence, motion, useDragControls, type PanInfo } from "motion/react";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Close } from "./icons";

interface Props {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  testId?: string;
}

/** Bottom sheet: springs up, drag down or tap the backdrop to close. */
export function Sheet({ open, onClose, title, children, testId }: Props) {
  const controls = useDragControls();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 700) onClose();
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="sheet-layer">
          <motion.div
            className="sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.section
            className="glass sheet"
            role="dialog"
            aria-modal="true"
            data-testid={testId}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            dragListener={false}
            dragControls={controls}
            onDragEnd={onDragEnd}
          >
            <div className="sheet-handle" onPointerDown={(e) => controls.start(e)}>
              <div className="sheet-grip" aria-hidden />
            </div>
            <header className="sheet-head" onPointerDown={(e) => controls.start(e)}>
              <h2>{title}</h2>
              <motion.button whileTap={{ scale: 0.9 }} className="icon-btn" onClick={onClose} aria-label="閉じる">
                <Close />
              </motion.button>
            </header>
            <div className="sheet-body">{children}</div>
          </motion.section>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function SkeletonRows({ n = 3 }: { n?: number }) {
  return (
    <div className="sk-rows" aria-busy="true" aria-label="読み込み中">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="sk sk-row" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
    </div>
  );
}

export const stagger = {
  list: { animate: { transition: { staggerChildren: 0.06 } } },
  item: {
    initial: { opacity: 0, y: 14, filter: "blur(6px)" },
    animate: { opacity: 1, y: 0, filter: "blur(0px)", transition: { type: "spring" as const, stiffness: 420, damping: 30 } },
  },
};
