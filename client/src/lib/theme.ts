/**
 * Theme preference — light / dark / system, per device.
 *
 * The `dark` class on <html> is the single switch the whole stylesheet keys
 * off (.dark vars in index.css + dark: variants everywhere). The inline
 * bootstrap in index.html applies the stored preference BEFORE first paint
 * (same pattern as the sidebar collapse state) so there's never a flash;
 * this module is the runtime side: reading, setting, and following OS
 * changes while the "system" preference is active.
 *
 * DEFAULT IS LIGHT, not system — the app has always been light, so an OS
 * dark-mode user must opt in rather than get silently flipped by a deploy.
 */

export type ThemePref = "light" | "dark" | "system";

const KEY = "dis_theme";
const mq = () => window.matchMedia("(prefers-color-scheme: dark)");

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "dark" || v === "system" ? v : "light";
  } catch {
    return "light";
  }
}

function apply(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && mq().matches);
  document.documentElement.classList.toggle("dark", dark);
  // Keep the mobile status bar / PWA chrome in step with the theme —
  // otherwise Android shows an emerald bar over a dark app (and iOS keeps a
  // translucent bar with light text on a white page).
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#0B1220" : "#FFFFFF");
  const ios = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (ios) ios.setAttribute("content", dark ? "black-translucent" : "default");
}

export function setThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {}
  apply(pref);
}

/** Call once at app boot: re-applies (harmless after the bootstrap) and
 *  keeps a "system" preference tracking live OS changes. */
export function initTheme() {
  apply(getThemePref());
  mq().addEventListener("change", () => {
    if (getThemePref() === "system") apply("system");
  });
}
