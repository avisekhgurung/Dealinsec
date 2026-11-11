/**
 * Does DealInSec notice a reply by itself, for the person looking at the page?
 *
 * Only when reading replies is switched on for their workspace AND their own connected Gmail allows it. Everywhere
 * else (no Gmail, sending-only Gmail, reading switched off) a reply is known only once the person records it, so the
 * page must not promise that "a reply cancels" a follow-up. The follow-up job itself is unchanged: it steps aside for
 * a recorded reply, an opt-out, a bounce, or a lead moved on past first contact.
 */
import type { GmailStatusView } from "@shared/gmail-connect";

export const repliesAreRead = (s: Pick<GmailStatusView, "connection" | "replySync"> | null | undefined): boolean =>
  !!s?.replySync?.available && !!s.replySync.granted && s.connection?.status === "active";

/** How a planned follow-up ends early, in the words that are true for this person. */
export const followUpEnds = (read: boolean): string =>
  read ? "a reply cancels it" : "it is cancelled once you move the lead to Replied";
