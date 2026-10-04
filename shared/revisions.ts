/**
 * Revising a quotation or an agreement: the pure parts. No database, no network.
 *
 * A quotation has no content of its own: it is a rendering of its deal, so
 * revising one means editing the deal's fields (price, dates, deliverables,
 * terms) and regenerating it. An agreement is the same fields frozen at the
 * moment the issuer signed it, which is why revising one is a deliberate,
 * confirmed act with its own rules (see server/services/revisions.ts).
 */
import { z } from "zod";

export const MAX_TERMS_LENGTH = 1200;
export const MAX_DELIVERABLES = 12;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const deliverableInput = z.object({
  platform: z.string().max(40).optional().describe("The channel or area, for example Website, Design, Instagram"),
  contentType: z.string().max(80).optional().describe("What is delivered, for example Home page, Logo, Reel"),
  quantity: z.number().optional(),
  frequency: z.string().max(30).optional().describe("For example One-time, Per month"),
  notes: z.string().max(200).optional(),
});

/** The fields of a deal a revision may change. Every one is optional; leaving one out keeps it as it is. */
export const dealEditSchema = z.object({
  dealTitle: z.string().max(200).optional().describe("The project's name"),
  dealAmount: z.number().positive().optional().describe("The new total in whole currency units. Only a figure the user stated."),
  startDate: z.string().regex(DATE, "Dates are written YYYY-MM-DD").optional(),
  endDate: z.string().regex(DATE, "Dates are written YYYY-MM-DD").optional(),
  deliverables: z.array(deliverableInput).min(1).max(MAX_DELIVERABLES).optional().describe("The COMPLETE new list of deliverables; it replaces the old list, so include the ones that stay"),
  addTerms: z.string().max(MAX_TERMS_LENGTH).optional().describe("Terms to ADD, one per line. Existing terms are kept."),
  removeTerms: z.string().max(MAX_TERMS_LENGTH).optional().describe("Terms to REMOVE, one per line, written as they appear on the deal"),
  replaceTerms: z.string().max(MAX_TERMS_LENGTH).optional().describe("The COMPLETE new terms, one per line; it replaces all existing terms"),
});
export type DealEdit = z.infer<typeof dealEditSchema>;

const lines = (t: string | null | undefined) => (t ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
const key = (l: string) => l.toLowerCase().replace(/\s+/g, " ");

/** Append whole lines to existing terms, skipping any already there. */
export function appendLines(existing: string | null | undefined, add: string): string {
  const have = lines(existing);
  const seen = new Set(have.map(key));
  for (const l of lines(add)) if (!seen.has(key(l))) { have.push(l); seen.add(key(l)); }
  return have.join("\n");
}

/** Remove whole lines (matched ignoring case and spacing). `missing` are the ones that weren't there. */
export function removeLines(existing: string | null | undefined, remove: string): { text: string; removed: string[]; missing: string[] } {
  const gone = lines(remove);
  const want = new Set(gone.map(key));
  const kept: string[] = [], removed: string[] = [];
  for (const l of lines(existing)) (want.has(key(l)) ? removed : kept).push(l);
  const removedKeys = new Set(removed.map(key));
  return { text: kept.join("\n"), removed, missing: gone.filter((g) => !removedKeys.has(key(g))) };
}

export interface StoredDeliverable { id: string; platform: string; contentType: string; quantity: number; frequency: string; notes: string }

const clip = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");

/** The same clamps the creation path applies, so a revised list is shaped exactly like a new one. */
export function normalizeDeliverables(raw: unknown, newId: () => string): StoredDeliverable[] {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_DELIVERABLES) : [];
  return list.map((d: any) => ({
    id: newId(),
    platform: clip(d?.platform, 40) || "Service",
    contentType: clip(d?.contentType, 80) || "Deliverable",
    quantity: Math.min(999, Math.max(1, Math.round(Number(d?.quantity)) || 1)),
    frequency: clip(d?.frequency, 30) || "One-time",
    notes: clip(d?.notes, 200),
  }));
}

export const describeDeliverable = (d: Pick<StoredDeliverable, "quantity" | "contentType" | "platform">) =>
  `${d.quantity} × ${d.contentType}${d.platform && d.platform !== "Service" ? ` (${d.platform})` : ""}`;

/** "3 items: 1 × Home page, 4 × Inner page, …" for a preview line. */
export function summarizeDeliverables(ds: StoredDeliverable[], max = 4): string {
  const shown = ds.slice(0, max).map(describeDeliverable).join(", ");
  return `${ds.length} item${ds.length === 1 ? "" : "s"}: ${shown}${ds.length > max ? `, and ${ds.length - max} more` : ""}`;
}

export const isEmptyEdit = (e: DealEdit) => Object.values(e).every((v) => v === undefined);

/** The rules for what an agreement revision may change, in words a person can read back. */
export const AGREEMENT_LOCKED = "The client has already signed this agreement (or a signed copy was uploaded), so it is locked: its signature and integrity record exist to prove it hasn't changed.";
