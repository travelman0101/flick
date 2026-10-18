import { motion } from "motion/react";
import { GoogleG } from "./icons";

export function Login() {
  return (
    <motion.main
      className="login"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      data-testid="login"
    >
      <motion.div
        className="glass login-card"
        initial={{ y: 24, scale: 0.96, opacity: 0, filter: "blur(10px)" }}
        animate={{ y: 0, scale: 1, opacity: 1, filter: "blur(0px)" }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
      >
        <motion.h1
          className="login-mark"
          initial={{ letterSpacing: "0.3em", opacity: 0 }}
          animate={{ letterSpacing: "-0.02em", opacity: 1 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        >
          Flick
        </motion.h1>
        <motion.a
          href="/api/auth/google"
          className="btn google"
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.96 }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, type: "spring", stiffness: 300, damping: 24 }}
        >
          <GoogleG />
          Google でログイン
        </motion.a>
      </motion.div>
    </motion.main>
  );
}
