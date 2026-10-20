import { AnimatePresence, MotionConfig, motion, useIsPresent } from "motion/react";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Task } from "../shared/types";
import { Composer } from "./components/Composer";
import { Sun } from "./components/icons";
import { Login } from "./components/Login";
import { OrganizeSheet } from "./components/OrganizeSheet";
import { dayLabel, PlanScreen } from "./components/PlanScreen";
import { StatusTabs, VIEWS } from "./components/StatusTabs";
import { TaskCard } from "./components/TaskCard";
import { TaskDetail } from "./components/TaskDetail";
import { ToastView } from "./components/ToastView";
import { logicalDay } from "./day";
import { takeDriveReturn } from "./drivePicker";
import { api } from "./api";
import {
  childrenOf,
  counts,
  isPicked,
  isPlanned,
  logout,
  moveTask,
  planCandidates,
  restoreTask,
  setToday,
  todayList,
  topLevel,
  useStore,
} from "./store";
import { toast } from "./toast";
import type { View } from "./view";

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

function useLogicalDay() {
  const [day, setDay] = useState(logicalDay);
  useEffect(() => {
    // the app may stay open across 04:00
    const check = () => setDay(logicalDay());
    const t = setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  return day;
}

function Main() {
  const tasks = useStore((s) => s.tasks);
  const day = useLogicalDay();
  const [view, setViewState] = useState<View>("today");
  const [dir, setDir] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [organizing, setOrganizing] = useState<string | null>(null);
  const [replan, setReplan] = useState(false);
  const [driveReturn, setDriveReturn] = useState<string | null>(null);
  const firstPaint = useRef(true);

  // back from connecting Google Drive: reopen the task and its picker
  useEffect(() => {
    const result = new URLSearchParams(location.search).get("drive");
    if (!result) return;
    history.replaceState(null, "", "/");
    const taskId = takeDriveReturn();
    if (result === "connected") {
      toast("ドライブと連携しました");
      if (taskId) {
        setOpenId(taskId);
        setDriveReturn(taskId);
      }
    } else if (result === "wrong-account") toast("Flick と同じ Google アカウントを選んでください");
    else if (result === "failed") toast("ドライブと連携できませんでした");
  }, []);
  useEffect(() => {
    const t = setTimeout(() => (firstPaint.current = false), 800);
    return () => clearTimeout(t);
  }, []);

  const setView = (v: View) => {
    setDir(VIEWS.indexOf(v) - VIEWS.indexOf(view));
    setViewState(v);
  };

  const today = todayList(tasks, day);
  const groups = planCandidates(tasks, day);
  // The first open of the day asks what today is about, when there is something to choose from.
  const planning = view === "today" && (replan || (!isPlanned(day) && groups.leftover.length + groups.rest.length > 0));
  const list = view === "today" ? today : topLevel(tasks, view);
  const c = { ...counts(tasks), today: today.filter((t) => t.status !== "done").length };

  const onFlick = (id: string, d: 1 | -1): "leave" | "stay" => {
    const t = tasks[id];
    if (view !== "today") {
      const r = moveTask(id, d);
      if (r === "archived") toast("アーカイブしました", { label: "元に戻す", run: () => restoreTask(id) });
      return "leave";
    }
    // In Today, status changes keep the card in the list.
    if (d === 1 || !t || t.status !== "todo") {
      moveTask(id, d, true);
      return "stay";
    }
    if (!isPicked(t, day)) {
      toast("期限が今日までのタスクです");
      return "stay";
    }
    setToday(id, false, day);
    toast("今日から外しました", { label: "元に戻す", run: () => setToday(id, true, day) });
    return "leave";
  };

  const addedTo = () => {
    if (view !== "today") setView("todo");
  };

  return (
    <motion.main className="main" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
      <Composer today={view === "today" ? day : null} onAdded={addedTo} onOrganize={setOrganizing} />
      <HeaderActions
        onPlan={() => {
          setView("today");
          setReplan(true);
        }}
      />
      <StatusTabs value={view} counts={c} onChange={setView} />

      <AnimatePresence mode="popLayout" initial={false} custom={dir}>
        {planning ? (
          <PlanScreen key="plan" day={day} onDone={() => setReplan(false)} />
        ) : (
          <PresentList
            key={view}
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
            data-testid={`list-${view}`}
          >
            {view === "today" && <TodayHeader day={day} list={today} onPlan={() => setReplan(true)} />}
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
                      leftLabel={view === "today" ? "今日から外す" : undefined}
                      pickedToday={view !== "today" && isPicked(t, day)}
                    />
                  </motion.li>
                );
              })}
              {list.length === 0 && view !== "today" && (
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
          </PresentList>
        )}
      </AnimatePresence>

      <TaskDetail
        id={openId}
        day={day}
        autoDrive={!!openId && driveReturn === openId}
        onClose={() => {
          setOpenId(null);
          setDriveReturn(null);
        }}
      />
      <OrganizeSheet text={organizing} today={view === "today" ? day : null} onClose={() => setOrganizing(null)} onAdded={addedTo} />
    </motion.main>
  );
}

/** A list that is animating out is inert: no taps, not read out, not matched twice. */
function PresentList(props: ComponentProps<typeof motion.ul>) {
  const present = useIsPresent();
  return <motion.ul {...props} {...(present ? {} : { inert: true, "aria-hidden": true, "data-exiting": "" })} />;
}

function TodayHeader({ day, list, onPlan }: { day: string; list: Task[]; onPlan: () => void }) {
  const done = list.filter((t) => t.status === "done").length;
  const ratio = list.length ? done / list.length : 0;
  return (
    <motion.li className="today-head" layout data-testid="today-head">
      <div className="today-head-row">
        <span className="today-date">{dayLabel(day)}</span>
        <span className="today-progress" data-testid="today-progress">
          {done} / {list.length} 完了
        </span>
      </div>
      <div className="today-bar">
        <motion.span initial={false} animate={{ width: `${ratio * 100}%` }} transition={{ type: "spring", stiffness: 200, damping: 26 }} />
      </div>
      {list.length === 0 && (
        <div className="today-empty">
          <span className="empty-orb" aria-hidden />
          <motion.button whileTap={{ scale: 0.96 }} className="btn small" onClick={onPlan} data-testid="plan-open">
            全体から選ぶ
          </motion.button>
        </div>
      )}
    </motion.li>
  );
}

function HeaderActions({ onPlan }: { onPlan: () => void }) {
  const user = useStore((s) => s.user);
  const [menu, setMenu] = useState(false);
  const slot = document.getElementById("topbar-actions");
  if (!slot || !user) return null;
  return createPortal(
    <>
      <motion.button
        whileTap={{ scale: 0.9 }}
        className="glass icon-btn round"
        aria-label="今日の計画"
        onClick={onPlan}
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
              <button
                className="menu-item"
                onClick={() => {
                  setMenu(false);
                  api
                    .driveDisconnect()
                    .then(() => toast("ドライブ連携を解除しました"))
                    .catch(() => toast("解除できませんでした"));
                }}
              >
                ドライブ連携を解除
              </button>
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
