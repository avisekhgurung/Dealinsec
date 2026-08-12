import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initTheme } from "./lib/theme";
import { registerSW } from "virtual:pwa-register";

/**
 * Deployment freshness. Devices that kept the app open (or installed it) were
 * running builds from days ago: the service worker only checked for updates on
 * a full navigation, so an always-open tab never saw a new deploy.
 *
 * Now the app checks for a new version every 15 minutes AND whenever it
 * returns to the foreground; when the new service worker takes over, open tabs
 * reload themselves — unless the user is mid-typing, in which case the reload
 * waits until the app is next backgrounded so no form input is ever lost.
 */
const UPDATE_INTERVAL_MS = 15 * 60 * 1000;
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return;
    const check = () => reg.update().catch(() => {});
    setInterval(check, UPDATE_INTERVAL_MS);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) check();
    });
  },
});

if ("serviceWorker" in navigator) {
  // Reload only on a TAKEOVER (an update), never on first-ever install.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  const reload = () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return;
    const el = document.activeElement;
    const typing =
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLElement && el.isContentEditable);
    if (!typing || document.hidden) {
      reload();
    } else {
      // Mid-typing: refresh the moment the app is backgrounded instead.
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) reload();
      }, { once: true });
      window.addEventListener("pagehide", reload, { once: true });
    }
  });
}

/**
 * Stale-build recovery. Every deploy renames the JS chunks; a tab opened
 * before the deploy fails to lazy-load a route ("create deal → white screen,
 * works after reload"). Vite reports that exact failure as vite:preloadError —
 * reload once to pick up the new build. The sessionStorage guard stops a
 * reload loop if the network itself is down.
 */
window.addEventListener("vite:preloadError", (event) => {
  const KEY = "dis_chunk_reload";
  if (sessionStorage.getItem(KEY)) return; // second failure — genuinely offline
  sessionStorage.setItem(KEY, "1");
  event.preventDefault();
  window.location.reload();
});
window.addEventListener("load", () => {
  // A successful page load clears the guard for the next deploy.
  sessionStorage.removeItem("dis_chunk_reload");
});

initTheme();
createRoot(document.getElementById("root")!).render(<App />);
