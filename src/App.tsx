import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { STATUSES, type Status } from "../shared/types";
import { Composer } from "./components/Composer";
import { Sun } from "./components/icons";
import { Login } from "./components/Login";
import { OrganizeSheet } from "./components/OrganizeSheet";
import { StatusTabs } from "./components/StatusTabs";
import { TaskCard } from "./components/TaskCard";
import { TaskDetail } from "./components/TaskDetail";
import { TodaySheet } from "./components/TodaySheet";
import { ToastView } from "./components/ToastView";
import { childrenOf, counts, logout, moveTask, restoreTask, topLevel, useStore } from "./store";
import { toast } from "./toast";

export function App() {
  const auth = useStore((s) => s.auth);
  const ready = useStore((s) => s.ready);
  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence mode="wait">
        {auth === "out" ? (
          <Login key="login" />
        ) : auth === "in" && ready ? (
          <Main key="main" />
        ) : (
          <Skeleton key="skeleton" />
        )}
      </AnimatePresence>
      <ToastView />
    </MotionConfig>
  );
}

export function Skeleton() {
  return (
    <motion.div className="skeleton-screen" aria-busy="true" aria-label="読み込み中" exit={{ opacity: 0, transition: { duration: 0.2 } }}>
      <div className="sk sk-tabs" />
      {["", "", " short", "", " short", ""].map((c, i) => (
        <div key={i} className={`sk sk-card${c}`} />
      ))}
    </motion.div>
  );
}

const readTab = (): Status => {
  try {
    const t = localStorage.getItem("flick:v1:tab") as Status | null;
    return t && STATUSES.includes(t) ? t : "todo";
  } catch {
    return "todo";
  }
};

function Main() {
  const tasks = useStore((s) => s.tasks);
  const [tab, setTabState] = useState<Status>(readTab);
  const [dir, setDir] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [organizing, setOrganizing] = useState<string | null>(null);
  const [today, setToday] = useState(false);
  const firstPaint = useRef(true);
  useEffect(() => {
    const t = setTimeout(() => (firstPaint.current = false), 800);
    return () => clearTimeout(t);
  }, []);

  const setTab = (t: Status) => {
    setDir(STATUSES.indexOf(t) - STATUSES.indexOf(tab));
    setTabState(t);
    try {
      localStorage.setItem("flick:v1:tab", t);
    } catch {
      /* ignore */
    }
  };

  const list = topLevel(tasks, tab);
  const c = counts(tasks);

  const onFlick = (id: string, d: 1 | -1) => {
    const r = moveTask(id, d);
    if (r === "archived") toast("アーカイブしました", { label: "元に戻す", run: () => restoreTask(id) });
  };

  return (
    <motion.main className="main" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
      <Composer onAdded={() => setTab("todo")} onOrganize={setOrganizing} />
      <HeaderActions onToday={() => setToday(true)} />
      <StatusTabs value={tab} counts={c} onChange={setTab} />

      <AnimatePresence mode="popLayout" initial={false} custom={dir}>
        <motion.ul
          key={tab}
          className="list"
          custom={dir}
          variants={{
            enter: (d: number) => ({ x: d * 60, opacity: 0, filter: "blur(4px)" }),
            center: { x: 0, opacity: 1, filter: "blur(0px)" },
            exit: (d: number) => ({ x: d * -60, opacity: 0, filter: "blur(4px)" }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ type: "spring", stiffness: 420, damping: 38 }}
          data-testid={`list-${tab}`}
        >
          <AnimatePresence mode="popLayout" initial={true}>
            {list.map((t, i) => {
              const subs = childrenOf(tasks, t.id);
              return (
                <motion.li
                  key={t.id}
                  layout
                  className="row"
                  initial={{ opacity: 0, y: -14, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.18 } }}
                  transition={{ type: "spring", stiffness: 480, damping: 34, delay: firstPaint.current ? Math.min(i, 10) * 0.035 : 0 }}
                >
                  <TaskCard
                    task={t}
                    subtasks={{ total: subs.length, done: subs.filter((s) => s.status === "done").length }}
                    onOpen={setOpenId}
                    onFlick={onFlick}
                  />
                </motion.li>
              );
            })}
            {list.length === 0 && (
              <motion.li
                key="empty"
                className="empty"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                data-testid="empty"
              >
                <span className="empty-orb" aria-hidden />
                なし
              </motion.li>
            )}
          </AnimatePresence>
        </motion.ul>
      </AnimatePresence>

      <TaskDetail id={openId} onClose={() => setOpenId(null)} />
      <OrganizeSheet text={organizing} onClose={() => setOrganizing(null)} onAdded={() => setTab("todo")} />
      <TodaySheet open={today} onClose={() => setToday(false)} />
    </motion.main>
  );
}

function HeaderActions({ onToday }: { onToday: () => void }) {
  const user = useStore((s) => s.user);
  const [menu, setMenu] = useState(false);
  const slot = document.getElementById("topbar-actions");
  if (!slot || !user) return null;
  return createPortal(
    <>
      <motion.button
        whileTap={{ scale: 0.9 }}
        className="glass icon-btn round"
        aria-label="今日やること"
        onClick={onToday}
        data-testid="today"
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
      >
        <Sun />
      </motion.button>
      <div className="avatar-wrap">
        <motion.button
          whileTap={{ scale: 0.9 }}
          className="glass avatar"
          aria-label="アカウント"
          aria-expanded={menu}
          onClick={() => setMenu((m) => !m)}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.05 }}
        >
          {user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : <span>{user.name.slice(0, 1)}</span>}
        </motion.button>
        <AnimatePresence>
          {menu && (
            <motion.div
              className="glass menu"
              initial={{ opacity: 0, scale: 0.9, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -6 }}
              transition={{ type: "spring", stiffness: 500, damping: 32 }}
            >
              <div className="menu-email">{user.email}</div>
              <button className="menu-item" onClick={() => void logout()}>
                ログアウト
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>,
    slot,
  );
}
