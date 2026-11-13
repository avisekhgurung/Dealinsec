/**
 * Theme: DealInSec is dark, end to end (13 Nov 2026, founder's decision), on every page, signed in or not.
 *
 * The `dark` class on <html> is the single switch the whole stylesheet keys off (.dark vars in index.css + dark:
 * variants everywhere). The inline bootstrap in index.html adds it BEFORE first paint so nothing flashes; this module
 * is the runtime side.
 *
 * The one exception is paper. Documents are formal and white: the quotation, agreement and invoice pages, the public
 * accept and sign links, and anything printed or exported. App.tsx calls setDocumentLight() for those routes, and
 * strips the class for the duration of a print, so the whole cascade flips to light at once instead of 128 variables
 * being overridden one by one. There is no per-device preference any more; the old `dis_theme` key is ignored.
 */

/** The signed-in workspace wears the ink-green of its top and bottom bars in the phone's status bar too; the public
 *  pages keep the plain dark colour. Matches the top of .dis-topnav / .dis-bottomnav in index.css. */
const APP_STATUS_BAR = "#12211f";
const PAGE_STATUS_BAR = "#0B1220";
const PAPER_STATUS_BAR = "#FFFFFF";

function isDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

/** Re-tint the status bar / PWA chrome for the current page. */
export function applyStatusBar() {
  const dark = isDark();
  const inApp = document.documentElement.hasAttribute("data-app-shell");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", !dark ? PAPER_STATUS_BAR : inApp ? APP_STATUS_BAR : PAGE_STATUS_BAR);
  // iOS can only draw black or white here; keep its text readable.
  const ios = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (ios) ios.setAttribute("content", dark ? "black-translucent" : "default");
}

/** Mark the page as the signed-in workspace (or not) and re-tint. */
export function setAppShell(on: boolean) {
  document.documentElement.toggleAttribute("data-app-shell", on);
  applyStatusBar();
}

/** A document page renders on white; everything else is dark. */
export function setDocumentLight(light: boolean) {
  document.documentElement.classList.toggle("dark", !light);
  applyStatusBar();
}

/** Call once at app boot: the bootstrap already added the class; this only keeps the chrome tint in step. */
export function initTheme() {
  document.documentElement.classList.add("dark");
  applyStatusBar();
}
