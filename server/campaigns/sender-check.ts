/**
 * The sender check for campaigns: looks up the three public DNS records for the domain of the person's OWN connected
 * mailbox and has shared/sender-check.ts read them. Read-only and advisory.
 *
 * What is looked up, and what isn't: the domain comes from the mailbox's account address (the one Google confirmed
 * when it was connected), never from anything typed into this request; only TXT records are asked for; nothing is
 * stored. An address on Google's own domains needs no lookup at all. A lookup that fails or takes too long is
 * reported as "couldn't check", never as "missing".
 */
import { Resolver } from "node:dns/promises";
import { GOOGLE_DKIM_SELECTOR, GOOGLE_MAIL_DOMAINS, assessSender, domainOfAddress, type SenderCheck, type SenderRecords } from "@shared/sender-check";
import { readGate, type Result, type Who } from "../services/leads";

export type TxtLookup = (name: string) => Promise<string[] | null>;
const LOOKUP_MS = 2_500, LOOKUP_TRIES = 2, CACHE_MS = 10 * 60_000, CACHE_MAX = 200;

/** One TXT lookup: the records (each joined from its chunks), [] when there are none, null when it couldn't be answered. */
export const dnsTxt: TxtLookup = async (name) => {
  // Two tries: one lost packet on a busy machine shouldn't read as "couldn't check" (seen once in testing).
  const r = new Resolver({ timeout: LOOKUP_MS, tries: LOOKUP_TRIES });
  let timer: NodeJS.Timeout | undefined;
  try {
    const rows = await Promise.race([
      r.resolveTxt(name),
      new Promise<never>((_, no) => { timer = setTimeout(() => { r.cancel(); no(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })); }, LOOKUP_MS * LOOKUP_TRIES + 500); }),
    ]);
    return rows.map((chunks) => chunks.join(""));
  } catch (e) {
    const code = String((e as { code?: string })?.code ?? "");
    return code === "ENOTFOUND" || code === "ENODATA" ? [] : null; // no such name / no TXT there is an answer; anything else is "couldn't check"
  } finally { if (timer) clearTimeout(timer); }
};

const cache = new Map<string, { at: number; records: SenderRecords }>();
export async function lookupRecords(domain: string, txt: TxtLookup, now: number): Promise<SenderRecords> {
  const hit = cache.get(domain);
  if (hit && now - hit.at < CACHE_MS) return hit.records;
  const [spf, dkim, dmarc] = await Promise.all([txt(domain), txt(`${GOOGLE_DKIM_SELECTOR}._domainkey.${domain}`), txt(`_dmarc.${domain}`)].map((p) => p.catch(() => null)));
  const records = { spf, dkim, dmarc };
  // A failed lookup isn't remembered: the next look tries again.
  if (spf !== null && dkim !== null && dmarc !== null) { cache.set(domain, { at: now, records }); if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string); }
  return records;
}
export const clearSenderCache = () => cache.clear();

export interface SenderCheckDeps {
  /** The caller's own connected mailbox address, or null when none is connected (or mailboxes aren't set up here). */
  mailbox(orgId: string, userId: string): Promise<{ address: string; status: string } | null>;
  txt: TxtLookup;
  now(): Date;
}
const defaults = (): SenderCheckDeps => ({
  async mailbox(orgId, userId) {
    try {
      const { pgMailboxStore } = await import("../mail/mailbox-store-pg");
      const c = await pgMailboxStore.live(orgId, userId, "gmail");
      return c ? { address: c.accountEmail, status: c.status } : null;
    } catch { return null; }
  },
  txt: dnsTxt, now: () => new Date(),
});

export async function senderCheck(user: Who, d: Partial<SenderCheckDeps> = {}): Promise<Result<{ check: SenderCheck; mailbox: "none" | "active" | "needs_reconnect" }>> {
  const deps = { ...defaults(), ...d };
  const gate = readGate(user);
  if (gate) return gate;
  const box = await deps.mailbox(user.organizationId!, user.id).catch(() => null);
  if (!box) return { ok: true, check: assessSender(null, null), mailbox: "none" };
  const mailbox = box.status === "active" ? "active" as const : "needs_reconnect" as const;
  const domain = domainOfAddress(box.address);
  if (!domain || GOOGLE_MAIL_DOMAINS.has(domain)) return { ok: true, check: assessSender(box.address, null), mailbox };
  return { ok: true, check: assessSender(box.address, await lookupRecords(domain, deps.txt, deps.now().getTime())), mailbox };
}
