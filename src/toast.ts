import { useSyncExternalStore } from "react";

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

let current: Toast | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, action?: Toast["action"]) {
  current = { id: Date.now(), text, action };
  clearTimeout(timer);
  timer = setTimeout(dismissToast, action ? 5000 : 2600);
  emit();
}

export function dismissToast() {
  current = null;
  emit();
}

export const useToast = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );
