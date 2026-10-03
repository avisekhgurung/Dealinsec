/**
 * Which face of the product the person lives in:
 *   "agent"  a full-screen chat (and voice): find companies, work leads, ask, approve
 *   "app"    the dashboard and its pages (the SaaS)
 * Remembered on this device and kept in step across tabs. It decides where `/`
 * lands and whether the navigation bars are drawn; it never changes what any
 * page or the agent can do, so every route keeps working in both modes.
 */
import { useSyncExternalStore } from "react";

export type UiMode = "agent" | "app";
const KEY = "dis-ui-mode";
const listeners = new Set<() => void>();

function read(): UiMode {
  try { return typeof window !== "undefined" && window.localStorage.getItem(KEY) === "agent" ? "agent" : "app"; } catch { return "app"; }
}
let current: UiMode = read();
const notify = () => listeners.forEach((l) => l());

export const getUiMode = (): UiMode => current;
export function setUiMode(mode: UiMode): void {
  if (mode === current) return;
  current = mode;
  try { window.localStorage.setItem(KEY, mode); } catch { /* the choice just won't be remembered */ }
  notify();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => { if (e.key === KEY) { current = read(); notify(); } });
}

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
export const useUiMode = (): UiMode => useSyncExternalStore(subscribe, () => current, () => "app" as UiMode);
