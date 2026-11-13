/**
 * Which of the product's two modes the person is reading: Client Search or the Deal Suite (shared/work-mode.ts
 * holds the rules and says why they are never mixed).
 *
 * Remembered on this device and kept in step across tabs, exactly like use-ui-mode. It only decides which numbers
 * and which empty state are drawn; every route keeps working in either mode, so nothing is ever unreachable
 * because of what is stored here.
 */
import { useSyncExternalStore } from "react";
import { DEFAULT_WORK_MODE, isWorkMode, type WorkMode } from "@shared/work-mode";

const KEY = "dis-work-mode";
const listeners = new Set<() => void>();

function read(): WorkMode {
  try {
    const v = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    return isWorkMode(v) ? v : DEFAULT_WORK_MODE;
  } catch { return DEFAULT_WORK_MODE; }
}

let current: WorkMode = read();
const notify = () => listeners.forEach((l) => l());

export const getWorkMode = (): WorkMode => current;

export function setWorkMode(mode: WorkMode): void {
  if (mode === current) return;
  current = mode;
  try { window.localStorage.setItem(KEY, mode); } catch { /* the choice just won't be remembered */ }
  notify();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => { if (e.key === KEY) { current = read(); notify(); } });
}

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
/** The remembered choice. A caller that cares where the person IS passes this to resolveWorkMode(path, …). */
export const useWorkMode = (): WorkMode =>
  useSyncExternalStore(subscribe, () => current, () => DEFAULT_WORK_MODE as WorkMode);
