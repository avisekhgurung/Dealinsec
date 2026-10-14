/**
 * Outreach safety rules, pure and shared: who may never be written to (an organization's do-not-contact list, by
 * address or domain), what can happen to a sent message, and how many drafts one request may prepare.
 *
 * Nothing in DealInSec sends email by itself: a person approves exactly one text, sends it from their own email app,
 * and records it. These rules hold at every step (draft, approve, record as sent) and for every lead of the
 * organization, so an opt-out recorded on one lead also protects the same address on any other lead.
 */
import { z } from "zod";
import type { LeadStatus } from "./leads";

/** The most prospects one "prepare drafts" request may cover (each is a model call, done one after another). */
export const PREPARE_MAX = 10;

export const SUPPRESSION_REASONS = ["opt_out", "bounce", "complaint", "manual"] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];
export const SUPPRESSION_REASON_LABEL: Record<SuppressionReason, string> = { opt_out: "Asked not to be contacted", bounce: "Address bounced", complaint: "Complained", manual: "Added by your team" };
/** Only an entry your team added can be removed: an opt-out, a bounce or a complaint is permanent. */
export const isRemovable = (reason: string) => reason === "manual";

export const OUTCOMES = ["replied", "bounced", "opted_out"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OUTCOME_LABEL: Record<Outcome, string> = { replied: "They replied", bounced: "It bounced", opted_out: "They asked not to be contacted" };
/**
 * "opened": the approved text was handed to the person's email app (after the checks); not proof that anything was sent.
 * "follow_due" / "follow_done": the transactional outbox for what follows a send. "follow_due" is written in the SAME
 * transaction that records the send; "follow_done" in the same transaction as the follow-up work itself (timeline entry,
 * stage move, follow-up ticket). A send whose follow-up was interrupted is therefore always found and finished, once.
 */
export const EVENT_KINDS = ["opened", "sent", "delivered", "replied", "bounced", "opted_out", "complaint", "failed", "follow_due", "follow_done"] as const;

/** Days until the follow-up a sent first message creates. */
export const FOLLOW_UP_DAYS = 4;
/** The stages a lead passes through when its first message goes out, each one a move the lead pipeline allows. */
export function pathToContacted(status: string): LeadStatus[] {
  if (status === "new" || status === "researching") return ["qualified", "contacted"];
  if (status === "qualified") return ["contacted"];
  return [];
}
export type OutreachEventKind = (typeof EVENT_KINDS)[number];

const EMAIL = /^[^\s@<>"',;]{1,64}@([a-z0-9-]+\.)+[a-z]{2,}$/i;
const DOMAIN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
/** An address in the one form the list compares: trimmed, lower case. Null when it isn't an address. */
export function normalEmail(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase().replace(/^mailto:/, "");
  return EMAIL.test(s) && s.length <= 254 ? s : null;
}
/** A domain in the one form the list compares: lower case, no scheme, path or "www.". Null when it isn't a domain. */
export function normalDomain(v: unknown): string | null {
  let s = String(v ?? "").trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").replace(/\.$/, "");
  if (s.startsWith("@")) s = s.slice(1);
  return DOMAIN.test(s) && s.length <= 253 ? s : null;
}
/** The entries that would block writing to `address`: the address itself, and its domain. */
export function suppressionKeys(address: string): { kind: "email" | "domain"; value: string }[] {
  const e = normalEmail(address);
  if (!e) return [];
  return [{ kind: "email", value: e }, { kind: "domain", value: e.split("@")[1] }];
}

/** What a person adds to the list by hand: an address, or a whole domain ("@acme.com", "acme.com"). */
export const suppressionInputSchema = z.object({
  value: z.string().trim().min(3).max(254),
  note: z.string().trim().max(200).optional(),
}).strict();
export function parseSuppressionInput(raw: unknown): { ok: true; kind: "email" | "domain"; value: string; note: string | null } | { ok: false; message: string } {
  const p = suppressionInputSchema.safeParse(raw);
  if (!p.success) return { ok: false, message: "Give an email address or a domain." };
  const email = normalEmail(p.data.value);
  if (email) return { ok: true, kind: "email", value: email, note: p.data.note || null };
  const domain = normalDomain(p.data.value);
  if (domain) return { ok: true, kind: "domain", value: domain, note: p.data.note || null };
  return { ok: false, message: "That isn't an email address or a domain." };
}

export const prepareRequestSchema = z.object({ prospectIds: z.array(z.number().int().positive()).min(1).max(PREPARE_MAX) }).strict();
/** What happened to one prospect in a "prepare drafts" request. */
export type PrepareOutcome =
  | { prospectId: number; outcome: "drafted"; leadId: number; messageId: number }
  | { prospectId: number; outcome: "skipped" | "failed"; reason: string; message: string; leadId?: number; messageId?: number };
