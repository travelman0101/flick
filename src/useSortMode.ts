import { useState } from "react";
import { SORT_MODES, type SortMode } from "./sort";
import { getState } from "./store";

/** Remembered per screen on this device: a display preference, so local storage is enough. */
const key = (screen: string) => `flick:v1:sort:${screen}:${getState().user?.id ?? "anon"}`;

export function useSortMode(screen: "plan" | "tasks", fallback: SortMode): [SortMode, (m: SortMode) => void] {
  const [mode, setMode] = useState<SortMode>(() => {
    try {
      const v = localStorage.getItem(key(screen)) as SortMode | null;
      return v && SORT_MODES.includes(v) ? v : fallback;
    } catch {
      return fallback;
    }
  });
  const choose = (m: SortMode) => {
    setMode(m);
    try {
      localStorage.setItem(key(screen), m);
    } catch {
      /* private mode: still sorts, just not remembered */
    }
  };
  return [mode, choose];
}
