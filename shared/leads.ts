/**
 * The lead pipeline's rules, shared by the server (services, routes, agent
 * tools) and the browser (forms, the stage control). Pure: no database, no DOM.
 *
 * A lead is a company worth pursuing, worked through explicit stages until it
 * becomes a deal. The stage is business state in the database, never something
 * the model remembers, and moves follow this table, nothing else.
 */
import { z } from "zod";

/* ── stages ───────────────────────────────────────────────────────────── */

export const LEAD_STATUSES = ["new", "researching", "qualified", "contacted", "replied", "meeting", "proposal", "won", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const leadStatusLabels: Record<LeadStatus, string> = {
  new: "New", researching: "Researching", qualified: "Qualified", contacted: "Contacted",
  replied: "Replied", meeting: "Meeting", proposal: "Proposal", won: "Won", lost: "Lost",
};

/** The stages a lead can be worked in, in funnel order. */
export const OPEN_STATUSES = ["new", "researching", "qualified", "contacted", "replied", "meeting", "proposal"] as const;

/**
 * Moves a person (or the agent) may make directly. Forward along the funnel,
 * a step back where one makes sense, `lost` from any open stage, and `lost →
 * new` to reopen. `won` appears NOWHERE here: a lead is won only by converting
 * it to a deal (see canConvertFrom), so "won" always means a real deal exists.
 */
const MOVES: Record<LeadStatus, readonly LeadStatus[]> = {
  new: ["researching", "qualified", "lost"],
  researching: ["new", "qualified", "lost"],
  qualified: ["researching", "contacted", "lost"],
  contacted: ["qualified", "replied", "lost"],
  replied: ["contacted", "meeting", "proposal", "lost"],
  meeting: ["replied", "proposal", "lost"],
  proposal: ["meeting", "lost"],
  won: [],
  lost: ["new"],
};

export const allowedMoves = (from: LeadStatus): readonly LeadStatus[] => MOVES[from];
export const canMove = (from: LeadStatus, to: LeadStatus): boolean => MOVES[from].includes(to);
export const isOpen = (s: LeadStatus): boolean => (OPEN_STATUSES as readonly string[]).includes(s);
export const isLeadStatus = (v: unknown): v is LeadStatus => (LEAD_STATUSES as readonly unknown[]).includes(v);

/** A lead can be closed as won (by creating its deal) once it is qualified: before that there is nothing to deal on. */
export const CONVERTIBLE_FROM: readonly LeadStatus[] = ["qualified", "contacted", "replied", "meeting", "proposal"];
export const canConvertFrom = (s: LeadStatus): boolean => CONVERTIBLE_FROM.includes(s);

/* ── companies ────────────────────────────────────────────────────────── */

/**
 * The comparable form of a website: lower case, no scheme, no "www.", no path.
 * Two leads for "https://www.Acme.com/about" and "acme.com" are the same
 * company. Null for anything that isn't a plausible hostname.
 */
export function normalizeDomain(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim().toLowerCase();
  if (!raw || raw.length > 253) return null;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^www\./, "").replace(/\.$/, "");
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(host) ? host : null;
}

/* ── tickets ──────────────────────────────────────────────────────────── */

export const TICKET_KINDS = ["intro", "follow_up", "research", "meeting", "proposal", "other"] as const;
export const TICKET_STATUSES = ["open", "done", "cancelled"] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];

/* ── claims: what we believe about a company, and how we know ────────── */

export const CLAIM_STATUSES = ["confirmed", "inferred", "unknown", "conflicting"] as const;

const httpUrl = z.string().trim().max(500).url().refine((u) => /^https?:\/\//i.test(u), "must be an http(s) URL");

/**
 * A fact about a company. "Confirmed" MUST point at where it was seen: a URL and
 * the words on the page. Anything we cannot point at is "inferred" or "unknown".
 * This is the rule that stops an invented fact from being stored as true.
 */
export const claimInputSchema = z.object({
  field: z.string().trim().min(2).max(60),
  value: z.string().trim().min(1).max(400),
  status: z.enum(CLAIM_STATUSES),
  evidenceUrl: httpUrl.optional(),
  evidenceSnippet: z.string().trim().min(8).max(500).optional(),
}).superRefine((c, ctx) => {
  if (c.status === "confirmed") {
    if (!c.evidenceUrl) ctx.addIssue({ code: "custom", path: ["evidenceUrl"], message: "a confirmed fact needs the URL where it was seen" });
    if (!c.evidenceSnippet) ctx.addIssue({ code: "custom", path: ["evidenceSnippet"], message: "a confirmed fact needs the words from the page" });
  }
});
export type ClaimInput = z.infer<typeof claimInputSchema>;

/* ── lead input ───────────────────────────────────────────────────────── */

const optionalText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

/** A contact email is only ever stored when given: never guessed from a name and a domain. */
const email = z.string().trim().toLowerCase().max(254).email();

export const leadFieldsSchema = z.object({
  companyName: z.string().trim().min(1, "a company name is required").max(120),
  website: optionalText(300),
  industry: optionalText(80),
  location: optionalText(80),
  sizeHint: optionalText(60),
  fitSummary: optionalText(1000),
  estValueMajor: z.number().positive().max(10_000_000_000).optional(),
  contactName: optionalText(100),
  contactRole: optionalText(100),
  contactEmail: email.optional(),
  contactSource: optionalText(200),
});
export type LeadFields = z.infer<typeof leadFieldsSchema>;

export const LEAD_SOURCES = ["manual", "agent", "import"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const MAX_BATCH = 20;
