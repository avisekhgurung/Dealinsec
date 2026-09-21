/**
 * Copilot proposals — what the model may SUGGEST, and what the user confirms.
 *
 * The model never writes to the database. When it wants a deal created it
 * emits fields; the server validates them, runs the Protection Check on the
 * result and registers a PROPOSAL: a single-use, server-issued id bound to the
 * user, the org and the validated fields. The confirm button carries only that
 * id. So the client can no longer post arbitrary create_deal arguments, and a
 * double-click (or a retry) replays the first result instead of creating a
 * second deal and spending a second credit.
 *
 * Kept free of database imports so it can be unit-tested on its own. Proposals
 * live in memory: a deploy or restart drops them and the user simply asks
 * again, which is safe — the alternative failure would be a lost write.
 */
import crypto from "crypto";
import type { LocaleSettings } from "@shared/schema";
import { formatMoney } from "@shared/money";
import {
  analyzeDealProtections,
  flagPriority,
  protectionPasses,
  type FlagPriority,
} from "./riskcheck";

const TTL_MS = 30 * 60 * 1000;
const MAX_OPEN = 2000;

export interface DealDraft {
  client: string;
  project: string;
  dealType: string;
  amount: string;
  timeline: string;
  deliverables: string[];
  terms: string[];
  /** Read from the terms text — shown only when actually stated. */
  advancePercent: number | null;
  revisions: number | null;
  protection: {
    flags: { id: string; priority: FlagPriority; title: string; detail: string; suggestedTerm?: string }[];
    passes: string[];
  };
  /** Things the user should look at before confirming. */
  warnings: string[];
  /** Fields the Edit button carries to the deal form (amount in MAJOR units). */
  prefill: {
    brandName: string;
    dealTitle: string;
    dealType: string;
    dealAmount: number;
    startDate: string;
    endDate: string;
    deliverables: { platform: string; contentType: string; quantity: number; frequency: string; notes: string }[];
    customTerms: string;
  };
}

interface Proposal {
  userId: string;
  organizationId: string | null;
  tool: "create_deal";
  args: Record<string, unknown>;
  /** The user's own words, kept to check the amount against on every rebuild. */
  userText: string;
  createdAt: number;
  state: "open" | "running" | "done";
  result?: { ok: boolean; message: string; route?: string };
}

const store = new Map<string, Proposal>();

const sweep = () => {
  const now = Date.now();
  for (const [id, p] of Array.from(store)) if (now - p.createdAt > TTL_MS) store.delete(id);
  if (store.size > MAX_OPEN) store.clear();
};

export function registerProposal(
  user: { id: string; organizationId?: string | null },
  tool: "create_deal",
  args: Record<string, unknown>,
  userText: string,
): string {
  sweep();
  const id = crypto.randomBytes(16).toString("hex");
  store.set(id, {
    userId: user.id,
    organizationId: user.organizationId ?? null,
    tool,
    args,
    userText,
    createdAt: Date.now(),
    state: "open",
  });
  return id;
}

/** Read an OPEN proposal that belongs to this user (for amending it). */
export function openProposal(
  id: unknown,
  user: { id: string; organizationId?: string | null },
): Proposal | null {
  sweep();
  const p = typeof id === "string" ? store.get(id) : undefined;
  if (!p || p.state !== "open") return null;
  if (p.userId !== user.id || (p.organizationId ?? null) !== (user.organizationId ?? null)) return null;
  return p;
}

/** Append one server-suggested term to an open proposal's terms. */
export function appendTerm(p: Proposal, term: string): void {
  const existing = typeof p.args.customTerms === "string" ? p.args.customTerms.trim() : "";
  p.args = { ...p.args, customTerms: existing ? `${existing}\n${term}` : term };
}

export type RunOutcome = { ok: boolean; message: string; route?: string; replay?: boolean };

/**
 * Run a proposal at most once. `run` is the real, re-validating executor.
 * A repeat of a finished proposal returns its first result; a repeat while it
 * is still running is refused; a failed run reopens it so the user can retry
 * (for example after upgrading), because nothing was written.
 */
export async function confirmProposal(
  id: unknown,
  user: { id: string; organizationId?: string | null },
  run: (tool: "create_deal", args: Record<string, unknown>) => Promise<{ ok: boolean; message: string; route?: string }>,
): Promise<{ status: number; body: RunOutcome }> {
  sweep();
  const p = typeof id === "string" ? store.get(id) : undefined;
  // Someone else's id looks exactly like an unknown one.
  if (!p || p.userId !== user.id || (p.organizationId ?? null) !== (user.organizationId ?? null)) {
    return { status: 404, body: { ok: false, message: "That draft has expired. Ask me again and I'll prepare it." } };
  }
  if (p.state === "done" && p.result) return { status: 200, body: { ...p.result, replay: true } };
  if (p.state === "running") return { status: 409, body: { ok: false, message: "That's already being created." } };

  p.state = "running";
  try {
    const result = await run(p.tool, p.args);
    if (result.ok) {
      p.state = "done";
      p.result = result;
    } else {
      p.state = "open";
    }
    return { status: result.ok ? 200 : 403, body: result };
  } catch (err) {
    p.state = "open";
    throw err;
  }
}

/* ── Grounding: an amount must come from the user's words ─────────────── */

const MULTIPLIERS: Record<string, number> = {
  k: 1e3, thousand: 1e3, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5,
  cr: 1e7, crore: 1e7, crores: 1e7, m: 1e6, mn: 1e6, million: 1e6,
};

/**
 * True when `major` can be read out of `text` as the user wrote it: "80000",
 * "80,000", "₹80k", "1.5 lakh", "$1,500". The model is told never to guess an
 * amount; this checks that it didn't, without asking the model.
 */
export function amountAppearsIn(text: string, major: number): boolean {
  const flat = text.replace(/(\d)[,\s](?=\d{2,3}\b)/g, "$1");
  const re = /(\d+(?:\.\d+)?)\s*(k|thousand|lakhs?|lacs?|crores?|cr|million|mn|m)?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat)) !== null) {
    const n = parseFloat(m[1]);
    const mult = m[2] ? MULTIPLIERS[m[2].toLowerCase()] ?? 1 : 1;
    if (Math.abs(n * mult - major) < 0.5) return true;
  }
  return false;
}

/* ── Draft ─────────────────────────────────────────────────────────────── */

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

function timelineLabel(start: string, end: string): string {
  const d = daysBetween(start, end);
  if (!(d > 0)) return `${start} to ${end}`;
  if (d % 7 === 0 && d <= 84) return `${d / 7} week${d === 7 ? "" : "s"}`;
  return `${d} days`;
}

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

export function readRevisions(text: string): number | null {
  const m = text.match(/\b(up to\s+)?(\d+|one|two|three|four|five)\s+(?:rounds?\s+of\s+)?(?:revisions?|rounds?)\b/i);
  if (!m) return null;
  const n = /^\d+$/.test(m[2]) ? parseInt(m[2], 10) : WORD_NUM[m[2].toLowerCase()];
  return Number.isFinite(n) ? n : null;
}

export function readAdvancePercent(text: string): number | null {
  const m = text.match(/(\d{1,2})\s*%\s*(?:advance|upfront|up-front|before)|advance[^.\n]{0,20}?(\d{1,2})\s*%/i);
  const n = m ? parseInt(m[1] ?? m[2], 10) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Build the card from ALREADY-VALIDATED fields (the output of the same
 *  clamping the executor uses) — never from what the model said in prose. */
export function buildDealDraft(
  candidate: {
    brandName: string;
    dealTitle: string;
    dealType: string;
    dealAmountMinor: number;
    startDate: string;
    endDate: string;
    deliverables: { platform: string; contentType: string; quantity: number; frequency: string; notes?: string | null }[];
    customTerms?: string | null;
  },
  amountMajor: number,
  settings: LocaleSettings,
  userText: string,
): DealDraft {
  const terms = (candidate.customTerms ?? "").split("\n").map((t) => t.trim()).filter(Boolean);
  const termsText = terms.join("\n");

  // The check only reads terms, so a draft is checked exactly like a saved deal.
  const report = analyzeDealProtections({ customTerms: termsText, standardTermIds: [] } as any, settings);

  const warnings: string[] = [];
  if (!amountAppearsIn(userText, amountMajor)) {
    warnings.push("I couldn't find this amount in your message. Check it before creating the deal.");
  }

  return {
    client: candidate.brandName,
    project: candidate.dealTitle,
    dealType: candidate.dealType,
    amount: formatMoney(candidate.dealAmountMinor, settings.currency, settings.locale),
    timeline: timelineLabel(candidate.startDate, candidate.endDate),
    deliverables: candidate.deliverables.map((d) => (d.quantity > 1 ? `${d.quantity} × ${d.contentType}` : d.contentType)),
    terms,
    advancePercent: readAdvancePercent(termsText),
    revisions: readRevisions(termsText),
    protection: {
      flags: report.flags.map((f) => ({
        id: f.id,
        priority: flagPriority(f),
        title: f.title,
        detail: f.detail,
        suggestedTerm: f.suggestedTerm,
      })),
      passes: protectionPasses(report),
    },
    warnings,
    prefill: {
      brandName: candidate.brandName,
      dealTitle: candidate.dealTitle,
      dealType: candidate.dealType,
      dealAmount: amountMajor,
      startDate: candidate.startDate,
      endDate: candidate.endDate,
      deliverables: candidate.deliverables.map((d) => ({
        platform: d.platform,
        contentType: d.contentType,
        quantity: d.quantity,
        frequency: d.frequency,
        notes: d.notes ?? "",
      })),
      customTerms: termsText,
    },
  };
}
