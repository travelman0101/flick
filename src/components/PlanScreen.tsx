import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { api, HttpError } from "../api";
import { dueLabel, haptic } from "../format";
import { matches, sortTasks } from "../sort";
import { childrenOf, flush, planCandidates, progressOf, startDay, useStore } from "../store";
import { toast } from "../toast";
import { useSortMode } from "../useSortMode";
import { Check, Sparkle, Sun } from "./icons";
import { ListTools } from "./ListTools";

const WD = ["日", "月", "火", "水", "木", "金", "土"];
const dayLabel = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return `${m}/${d}(${WD[new Date(y, m - 1, d).getDay()]})`;
};

/**
 * The morning pick: every open task in one list, tap to choose what today is about.
 * Search and sort only change what is shown; choices stay. Tasks due today are always
 * in today's list, so they show as chosen and locked ("自動").
 */
export function PlanScreen({ day, onDone }: { day: string; onDone: () => void }) {
  const tasks = useStore((s) => s.tasks);
  const groups = useMemo(() => planCandidates(tasks, day), [tasks, day]);
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set([...groups.picked, ...groups.leftover].map((t) => t.id)),
  );
  // today's goals: subtasks already marked for today stay marked
  const [goals, setGoals] = useState<Set<string>>(
    () => new Set(Object.values(tasks).filter((t) => t.parentId !== null && t.today === day).map((t) => t.id)),
  );
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const openSubs = (id: string) => childrenOf(tasks, id).filter((x) => x.status !== "done");
  const toggleGoal = (id: string) => {
    haptic(6);
    setGoals((g) => {
      const n = new Set(g);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const [thinking, setThinking] = useState(false);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useSortMode("plan", "recommended");
  const locked = useMemo(() => new Set(groups.due.map((t) => t.id)), [groups]);
  const leftover = useMemo(() => new Set(groups.leftover.map((t) => t.id)), [groups]);
  // done tasks are never candidates (planCandidates leaves them out)
  const pool = [...groups.picked, ...groups.leftover, ...groups.due, ...groups.rest];
  const shown = sortTasks(
    pool.filter((t) => matches(t, query)),
    mode,
    { day, started: (t) => progressOf(tasks, t.id).done > 0 },
  );

  const toggle = (id: string) => {
    haptic(6);
    setChosen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const recommend = async () => {
    setThinking(true);
    try {
      await flush();
      const { picks } = await api.today();
      setChosen((s) => new Set([...s, ...picks.map((p) => p.id)]));
      setReasons(Object.fromEntries(picks.map((p) => [p.id, p.reason])));
      if (!picks.length) toast("おすすめはありませんでした");
    } catch (e) {
      toast(e instanceof HttpError && e.status === 429 ? "今日の AI 利用回数に達しました" : "おすすめを取得できませんでした");
    } finally {
      setThinking(false);
    }
  };

  const total = chosen.size + groups.due.length;
  const start = () => {
    startDay([...chosen], day, [...goals]);
    haptic(14);
    onDone();
  };

  const item = (t: (typeof pool)[number]) => {
    const isLocked = locked.has(t.id);
    const on = isLocked || chosen.has(t.id);
    const due = t.due ? dueLabel(t.due) : null;
    const prog = progressOf(tasks, t.id);
    return (
      <motion.li
        key={t.id}
        layout="position"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
      >
        <motion.button
          className={`plan-item ${on ? "on" : ""} ${isLocked ? "locked" : ""}`}
          aria-pressed={on}
          disabled={isLocked}
          whileTap={{ scale: 0.97 }}
          onClick={() => toggle(t.id)}
          data-testid="plan-item"
        >
          <motion.span className="plan-check" animate={{ scale: on ? [1, 1.25, 1] : 1 }} transition={{ duration: 0.25 }}>
            {on && <Check width={13} height={13} />}
          </motion.span>
          <span className="plan-title">
            {t.title}
            {reasons[t.id] && <span className="plan-reason">{reasons[t.id]}</span>}
          </span>
          {isLocked && (
            <span className="chip auto" data-testid="plan-auto">
              自動
            </span>
          )}
          {leftover.has(t.id) && (
            <span className="chip leftover" data-testid="plan-leftover">
              昨日の残り
            </span>
          )}
          {prog.total > 0 && (
            <span className={`chip progress ${prog.done > 0 ? "started" : ""}`}>
              {prog.done}/{prog.total}
            </span>
          )}
          {due && <span className={`chip due ${due.tone}`}>{due.text}</span>}
        </motion.button>
        <AnimatePresence initial={false}>
          {on && openSubs(t.id).length > 0 && (
            <motion.ul
              className="plan-goals"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 36 }}
            >
              <li className="plan-goals-hint">今日やる分をタップ</li>
              {openSubs(t.id).map((sub) => (
                <li key={sub.id}>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    className={`plan-goal ${goals.has(sub.id) ? "on" : ""}`}
                    aria-pressed={goals.has(sub.id)}
                    onClick={() => toggleGoal(sub.id)}
                    data-testid="plan-goal"
                  >
                    <Sun width={14} height={14} />
                    {sub.title}
                  </motion.button>
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </motion.li>
    );
  };

  return (
    <motion.div
      className="plan"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      data-testid="plan"
    >
      <div className="plan-head">
        <div>
          <p className="plan-date">{dayLabel(day)}</p>
          <h2>今日やることを選ぶ</h2>
        </div>
        <motion.button whileTap={{ scale: 0.94 }} className="btn small ai" onClick={recommend} disabled={thinking} data-testid="plan-ai">
          <Sparkle width={16} height={16} />
          {thinking ? "考え中" : "AI おすすめ"}
        </motion.button>
      </div>

      {pool.length > 0 && <ListTools query={query} onQuery={setQuery} mode={mode} onMode={setMode} />}
      <motion.ul className="plan-list" data-testid="plan-list">
        <AnimatePresence initial={false} mode="popLayout">
          {shown.map(item)}
        </AnimatePresence>
      </motion.ul>
      {pool.length > 0 && shown.length === 0 && (
        <p className="no-match" data-testid="no-match">
          一致するタスクがありません
        </p>
      )}

      <div className="plan-bar">
        <motion.button whileTap={{ scale: 0.97 }} className="btn primary wide" onClick={start} data-testid="plan-start">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={total} initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }}>
              {total > 0 ? `${total} 件で今日を始める` : "選ばずに始める"}
            </motion.span>
          </AnimatePresence>
        </motion.button>
      </div>
    </motion.div>
  );
}

export { dayLabel };
