/**
 * The chat's interaction rules, as pure functions (tested in interaction.test.ts; the components only wire them up).
 */

/** How close to the bottom still counts as "following the conversation" (px). */
export const FOLLOW_THRESHOLD = 96;

export interface ScrollMetrics { scrollTop: number; scrollHeight: number; clientHeight: number }
export const distanceFromBottom = (m: ScrollMetrics) => Math.max(0, m.scrollHeight - m.scrollTop - m.clientHeight);
/** True when the reader is at (or near) the latest message, so new content may scroll into view. */
export const isFollowing = (m: ScrollMetrics, threshold = FOLLOW_THRESHOLD) => distanceFromBottom(m) <= threshold;

/**
 * What a change in the conversation should do to the scroll position:
 *   follow     keep the latest message in view (the reader is at the bottom, or just sent a message, or opened it)
 *   mark-new   leave the reader where they are and offer "Jump to latest"
 *   none       nothing new arrived
 */
export function onContentChange(a: { following: boolean; added: number; lastIsOwnNewMessage: boolean; firstLoad: boolean }): "follow" | "mark-new" | "none" {
  if (a.firstLoad || a.lastIsOwnNewMessage) return "follow";
  if (a.added <= 0) return a.following ? "follow" : "none";
  return a.following ? "follow" : "mark-new";
}

/**
 * Enter in the message box. Desktop: Enter sends, Shift+Enter is a new line. A touch keyboard has no Shift, so there
 * Enter is a new line and the Send button sends. Ctrl/Cmd+Enter sends everywhere. Never while an IME is composing.
 */
export function enterIntent(e: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; isComposing: boolean; keyCode?: number }, touchFirst: boolean): "send" | "newline" | "none" {
  if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return "none";
  if (e.ctrlKey || e.metaKey) return "send";
  if (e.shiftKey || e.altKey) return "newline";
  return touchFirst ? "newline" : "send";
}

/** The composer's height: grows with its text, between one line and a cap that leaves the conversation visible. */
export const composerHeight = (scrollHeight: number, viewportHeight: number, min = 40, max = 240) =>
  Math.max(min, Math.min(scrollHeight, max, Math.round(viewportHeight * 0.4)));

/** A message long enough to start folded (it is never cut: "Show more" reveals all of it). */
export const isLongMessage = (text: string, maxChars = 1200, maxLines = 16) => text.length > maxChars || text.split("\n").length > maxLines;
