/**
 * Where a follow-up belongs in Gmail: the thread of the outreach it follows, and the Message-IDs to answer, so the
 * recipient sees one conversation. Known when the outreach was sent through DealInSec (mail_send_jobs) or its
 * hand-sent copy was found by reply sync (mail_threads + the copy's Message-ID). Unknown otherwise: the follow-up is
 * then sent as a new message with a "Re:" subject. Ids only; nothing here reads message text.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { mailMessages, mailSendJobs, mailThreads, outreachFollowups } from "@shared/schema";

export async function followupThread(orgId: string, messageId: number): Promise<{ threadId: string | null; inReplyTo: string; references: string[] } | null> {
  const [f] = await db.select().from(outreachFollowups).where(and(eq(outreachFollowups.organizationId, orgId), eq(outreachFollowups.draftMessageId, messageId)));
  if (!f) return null; // not a follow-up
  const earlier = await db.select({ id: outreachFollowups.draftMessageId }).from(outreachFollowups)
    .where(and(eq(outreachFollowups.organizationId, orgId), eq(outreachFollowups.rootMessageId, f.rootMessageId), eq(outreachFollowups.status, "sent"))).orderBy(asc(outreachFollowups.step));
  const chain = [f.rootMessageId, ...earlier.map((e) => e.id).filter((x): x is number => !!x && x !== messageId)];
  const jobs = await db.select({ messageId: mailSendJobs.messageId, rfc: mailSendJobs.rfcMessageId, thread: mailSendJobs.providerThreadId }).from(mailSendJobs)
    .where(and(eq(mailSendJobs.organizationId, orgId), inArray(mailSendJobs.messageId, chain), eq(mailSendJobs.status, "sent")));
  const ids: string[] = [];
  let threadId: string | null = null;
  for (const id of chain) {
    const j = jobs.find((x) => x.messageId === id);
    if (j) { ids.push(j.rfc.toLowerCase()); threadId ??= j.thread; }
  }
  if (!jobs.some((j) => j.messageId === f.rootMessageId)) {
    // Sent by hand: the copy reply sync found in Sent mail carries the Message-ID the recipient has.
    const [copy] = await db.select({ rfc: mailMessages.rfcMessageId, thread: mailThreads.providerThreadId }).from(mailMessages)
      .innerJoin(mailThreads, eq(mailThreads.id, mailMessages.threadId))
      .where(and(eq(mailMessages.organizationId, orgId), eq(mailMessages.leadMessageId, f.rootMessageId), eq(mailMessages.kind, "outreach_copy"))).limit(1);
    if (copy?.rfc) { ids.unshift(copy.rfc); threadId ??= copy.thread; }
  }
  const valid = ids.filter((x) => /^<[^<>\s]{1,250}>$/.test(x)).slice(-20);
  if (!valid.length) return null;
  return { threadId, inReplyTo: valid[valid.length - 1], references: valid };
}
