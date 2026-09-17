/**
 * Theme preference — light / dark / system, per device.
 *
 * The `dark` class on <html> is the single switch the whole stylesheet keys
 * off (.dark vars in index.css + dark: variants everywhere). The inline
 * bootstrap in index.html applies the stored preference BEFORE first paint
 * so there's never a flash;
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

/** The signed-in workspace wears the ink-green of its top and bottom bars
 *  in the phone's status bar too; the marketing pages keep the plain theme
 *  colour. Matches the top of .dis-topnav / .dis-bottomnav in index.css. */
const APP_STATUS_BAR = { light: "#163630", dark: "#12211f" };

function isDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

/** Re-tint the status bar / PWA chrome for the current theme and page. */
export function applyStatusBar() {
  const dark = isDark();
  const inApp = document.documentElement.hasAttribute("data-app-shell");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute(
      "content",
      inApp ? (dark ? APP_STATUS_BAR.dark : APP_STATUS_BAR.light) : dark ? "#0B1220" : "#FFFFFF",
    );
  }
  // iOS can only draw black or white here; keep its text readable.
  const ios = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (ios) ios.setAttribute("content", dark ? "black-translucent" : "default");
}

/** Mark the page as the signed-in workspace (or not) and re-tint. */
export function setAppShell(on: boolean) {
  document.documentElement.toggleAttribute("data-app-shell", on);
  applyStatusBar();
}

function apply(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && mq().matches);
  document.documentElement.classList.toggle("dark", dark);
  // Keep the mobile status bar / PWA chrome in step with the theme —
  // otherwise Android shows an emerald bar over a dark app (and iOS keeps a
  // translucent bar with light text on a white page).
  applyStatusBar();
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
