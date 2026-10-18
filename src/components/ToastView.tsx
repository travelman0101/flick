import { AnimatePresence, motion } from "motion/react";
import { dismissToast, useToast } from "../toast";

export function ToastView() {
  const t = useToast();
  return (
    <div className="toast-layer" aria-live="polite">
      <AnimatePresence>
        {t && (
          <motion.div
            key={t.id}
            className="glass toast"
            data-testid="toast"
            initial={{ y: 40, opacity: 0, scale: 0.9 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 500, damping: 32 }}
          >
            <span>{t.text}</span>
            {t.action && (
              <motion.button
                whileTap={{ scale: 0.92 }}
                className="toast-action"
                onClick={() => {
                  t.action!.run();
                  dismissToast();
                }}
              >
                {t.action.label}
              </motion.button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
