import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import type { Task } from "../../shared/types";
import { api, HttpError } from "../api";
import { dueLabel, haptic } from "../format";
import { flush, planCandidates, startDay, useStore } from "../store";
import { toast } from "../toast";
import { Check, Sparkle } from "./icons";

const WD = ["日", "月", "火", "水", "木", "金", "土"];
const dayLabel = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return `${m}/${d}(${WD[new Date(y, m - 1, d).getDay()]})`;
};

/**
 * The morning pick: every open task, tap to choose what today is about.
 * Tasks due today are always in today's list, so they show as chosen and locked.
 */
export function PlanScreen({ day, onDone }: { day: string; onDone: () => void }) {
  const tasks = useStore((s) => s.tasks);
  const groups = useMemo(() => planCandidates(tasks, day), [tasks, day]);
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set([...groups.picked, ...groups.leftover].map((t) => t.id)),
  );
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [thinking, setThinking] = useState(false);

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
    startDay([...chosen], day);
    haptic(14);
    onDone();
  };

  const section = (title: string, list: Task[], locked = false) =>
    list.length > 0 && (
      <motion.section key={title} className="plan-section" layout>
        <h3>{title}</h3>
        <motion.ul
          className="plan-list"
          initial="initial"
          animate="animate"
          variants={{ animate: { transition: { staggerChildren: 0.035 } } }}
        >
          {list.map((t) => {
            const on = locked || chosen.has(t.id);
            const due = t.due ? dueLabel(t.due) : null;
            return (
              <motion.li
                key={t.id}
                variants={{
                  initial: { opacity: 0, y: 10 },
                  animate: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 420, damping: 32 } },
                }}
              >
                <motion.button
                  className={`plan-item ${on ? "on" : ""} ${locked ? "locked" : ""}`}
                  aria-pressed={on}
                  disabled={locked}
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
                  {due && <span className={`chip due ${due.tone}`}>{due.text}</span>}
                  {t.status === "doing" && <span className="chip">進行中</span>}
                </motion.button>
              </motion.li>
            );
          })}
        </motion.ul>
      </motion.section>
    );

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

      {section("選択中", groups.picked)}
      {section("昨日の残り", groups.leftover)}
      {section("期限が今日まで", groups.due, true)}
      {section("そのほか", groups.rest)}

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
