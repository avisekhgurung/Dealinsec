import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initTheme } from "./lib/theme";

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
