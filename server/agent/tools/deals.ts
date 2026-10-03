/**
 * Deal tools: reading a pasted message, the Protection Check, and creating or
 * changing a pending deal. Every change goes through the same validation as the
 * form (buildDealCandidate, the Pending-only rule, the same revised-quote
 * follow-up) — the agent adds no rules of its own.
 */
import { z } from "zod";
import { amountMinorSchema, hasActiveDealBoost, hasProAccess, toMinor, MAX_AMOUNT_MINOR } from "@shared/schema";
import { getBillingUser, logOrgActivity } from "../../entitlements";
import { aiProvider } from "../../copilot/provider";
import { analyzeDealProtections } from "../../copilot/riskcheck";
import { buildDealDraft, protectionPayload } from "../../copilot/proposals";
import { buildDealCandidate, executeCreateDeal, runTool } from "../../copilot/tools";
import { copilotAudience } from "../../copilot/workflow";
import { readDenial } from "../../copilot/readAccess";
import { storage } from "../../storage";
import { reviseDraftQuote } from "../../services/deals";
import { buildAnalysis } from "../analysis";
import { currencyMentions, extractionSystemPrompt, extractionUserMessage, isPlaceholderName, parseJsonObject, pickSourceMessage } from "../extraction";
import { allOf, needsLinkedRead, needsPermission } from "../policy";
import type { AgentTool, ToolOutcome } from "../types";
import { dealFor, fail, money, settingsFor } from "./shared";

// ── analyze_deal_message ───────────────────────────────────────────────────

const analyzeDealMessage: AgentTool<Record<string, never>> = {
  name: "analyze_deal_message",
  description: "Read the client or brand message the user pasted and extract its deal terms — each tagged stated / inferred / not specified / conflicting — then run the Protection Check on what it states. Takes no arguments: it reads the user's pasted message itself. Use it BEFORE create_deal whenever the user pastes a message.",
  risk: "READ_ONLY", activity: "extracting",
  input: z.object({}),
  authorize: () => null,
  async run(ctx): Promise<ToolOutcome> {
    const source = pickSourceMessage(ctx.userMessages);
    if (source.trim().length < 20) return fail("no_message", "There's no client or brand message to read yet. Ask the user to paste it.");
    const [audience, settings] = await Promise.all([copilotAudience(ctx.user as any), settingsFor(ctx)]);

    // A separate call with NO tools: whatever the message says, it cannot make
    // the model call anything. The message is fenced and treated as data.
    ctx.progress("Reading the message…");
    let reply;
    try {
      reply = await aiProvider.chat(
        [{ role: "system", content: extractionSystemPrompt(audience) }, { role: "user", content: extractionUserMessage(source) }],
        [], { signal: ctx.signal, maxTokens: 1400 },
      );
    } catch (err) {
      if ((err as any)?.code === "aborted") throw err;
      return fail("extraction_failed", "I couldn't read that message just now.");
    }
    if (reply.usage) ctx.addUsage?.(reply.usage.inputTokens, reply.usage.outputTokens);
    const raw = parseJsonObject(reply.content);
    if (!raw) return fail("extraction_failed", "I couldn't read that message reliably. Paste it again, or tell me the key details.");

    ctx.progress("Running Protection Check…");
    const { summary, cards } = buildAnalysis(raw, source, audience, settings);
    return { ok: true, summary, cards };
  },
};

// ── run_protection_check ───────────────────────────────────────────────────

const runProtectionCheck: AgentTool<{ dealId?: number }> = {
  name: "run_protection_check",
  description: "Run the Protection Check on one saved deal (or every active deal if dealId is omitted): risky wording and missing protections, each with why it matters and what to ask.",
  risk: "READ_ONLY", activity: "searching",
  input: z.object({ dealId: z.number().optional().describe("Deal id; omit to check every active deal") }),
  authorize: (user) => readDenial("run_protection_check", user),
  async run(ctx, { dealId }): Promise<ToolOutcome> {
    if (dealId == null) return { ok: true, summary: await runTool("run_protection_check", {}, ctx.user as any, await settingsFor(ctx)) };
    const deal = await dealFor(ctx, dealId);
    if (!deal) return fail("not_found", "That deal isn't in your organization.");
    const report = analyzeDealProtections(deal, await settingsFor(ctx));
    const protection = protectionPayload(report);
    return {
      ok: true, route: `/deals/${dealId}`,
      cards: [{ kind: "findings", data: { dealId, title: "Protection Check", findings: protection.flags, passes: protection.passes } }],
      summary: protection.flags.length
        ? `${protection.flags.length} thing${protection.flags.length === 1 ? "" : "s"} to clarify on "${deal.dealTitle}":\n` + protection.flags.map((f) => `- [${f.id}] ${f.title}: ${f.why} Ask: ${f.ask}${f.suggestedTerm ? " (a suggested term can be added with add_protection_term)" : ""}`).join("\n")
        : `"${deal.dealTitle}" — no risky wording or missing protections found.`,
    };
  },
};

// ── create_deal ────────────────────────────────────────────────────────────

const createDealInput = z.object({
  brandName: z.string().describe("The client's or brand's name, exactly as stated"),
  dealTitle: z.string().optional(),
  dealType: z.string().optional(),
  dealAmount: z.coerce.number().describe("Total amount as a plain number in whole currency units, only if stated"),
  startDate: z.string().optional().describe("YYYY-MM-DD, only if stated"),
  endDate: z.string().optional().describe("YYYY-MM-DD, only if stated"),
  deliverables: z.array(z.object({
    platform: z.string().optional(), contentType: z.string().optional(),
    quantity: z.number().optional(), frequency: z.string().optional(), notes: z.string().optional(),
  })).optional(),
  customTerms: z.string().optional().describe("Only terms the message states, one per line"),
  brandTerms: z.record(z.string()).optional().describe("Brand deals only: campaign, usageRights, usageDuration, exclusivity, approval — only what is stated"),
});

const createDeal: AgentTool<z.infer<typeof createDealInput>> = {
  name: "create_deal",
  description: "Prepare a new deal from details the user stated or pasted. Never invent a value: omit what isn't stated. The user sees the draft with its Protection Check before anything is created.",
  risk: "SAFE_MUTATION",
  input: createDealInput,
  authorize: needsPermission("deals.create", "creating deals"),
  async prepare(ctx, input) {
    // A placeholder is not a name. The model may be tempted to "act" with one; refuse here, where it cannot be argued with.
    if (isPlaceholderName(input.brandName)) {
      return { ok: false, code: "missing_client", message: "I need the client's or brand's real name to create a deal. Ask the user for it; never use a placeholder." };
    }
    const built = await buildDealCandidate(input, ctx.user as any);
    if (!built.ok) return { ok: false, code: "invalid_deal", message: built.message };
    const draft = buildDealDraft(built.data as any, built.amountMajor, built.settings, ctx.userText);

    // Two more things worth a second look, both checked against the user's own
    // words: a client name that never appears, and an amount written in a
    // currency other than the workspace's (it would be saved as the workspace's).
    const warnings = [...draft.warnings];
    if (!ctx.userText.toLowerCase().includes(input.brandName.trim().toLowerCase())) {
      warnings.push("I couldn't find this client name in your message. Check it before creating the deal.");
    }
    const others = currencyMentions(ctx.userText).filter((c) => c !== built.settings.currency);
    if (others.length) {
      warnings.push(`Your message mentions ${others.join(", ")}, but this workspace uses ${built.settings.currency}, so the amount will be saved in ${built.settings.currency}.`);
    }

    // A free-plan deal spends one of the month's credits. The user hasn't
    // agreed to that just by having the agent at level 1, so it always asks.
    const billing = await getBillingUser(ctx.user as any);
    const spendsCredit = !hasProAccess(billing) && !hasActiveDealBoost(billing);
    return {
      ok: true,
      args: input as Record<string, unknown>,
      forceApproval: spendsCredit,
      preview: {
        title: `Create deal: ${draft.client} — ${draft.project}`,
        lines: [
          { label: "Client", value: draft.client },
          { label: "Project", value: draft.project },
          { label: "Amount", value: draft.amount },
          // Dates the message never gave are a default, not a fact: say so.
          { label: "Timeline", value: input.startDate && input.endDate ? draft.timeline : "Not specified — defaults to 30 days from today" },
          ...(warnings.length ? [{ label: "Check", value: warnings.join(" ") }] : []),
        ],
        effects: spendsCredit ? ["Uses 1 of your Deal Credits for this month."] : [],
        draft: { ...draft, warnings },
      },
    };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const r = await executeCreateDeal(args, ctx.user as any);
    return r.ok ? { ok: true, summary: r.message, route: r.route } : { ok: false, code: "rejected", message: r.message };
  },
};

// ── update_deal ────────────────────────────────────────────────────────────

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const updateDealInput = z.object({
  dealId: z.number(),
  brandName: z.string().optional(),
  dealTitle: z.string().optional(),
  dealAmount: z.coerce.number().optional().describe("The new total in whole currency units"),
  startDate: z.string().optional().describe("YYYY-MM-DD"),
  endDate: z.string().optional().describe("YYYY-MM-DD"),
  addTerms: z.string().optional().describe("Terms to ADD to the deal's terms (one per line). Existing terms are kept."),
});

/** Append whole lines to existing terms, skipping any already there. */
function appendLines(existing: string | null | undefined, add: string): string {
  const have = (existing ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const haveLower = new Set(have.map((l) => l.toLowerCase()));
  for (const l of add.split("\n").map((x) => x.trim()).filter(Boolean)) {
    if (!haveLower.has(l.toLowerCase())) { have.push(l); haveLower.add(l.toLowerCase()); }
  }
  return have.join("\n");
}

const updateDeal: AgentTool<z.infer<typeof updateDealInput>> = {
  name: "update_deal",
  description: "Change a PENDING deal: its client name, title, amount, dates, or add terms. Only pending deals can be edited. Changing the amount always asks the user first.",
  risk: "SAFE_MUTATION",
  input: updateDealInput,
  authorize: allOf(needsPermission("deals.edit", "editing deals"), needsLinkedRead()),
  async prepare(ctx, input) {
    const deal = await dealFor(ctx, input.dealId);
    if (!deal) return { ok: false, code: "not_found", message: "That deal isn't in your organization." };
    if (deal.status !== "Pending") return { ok: false, code: "not_editable", message: "Only pending deals can be edited. This one is already " + deal.status.toLowerCase() + "." };
    const s = await settingsFor(ctx);

    const updates: Record<string, unknown> = {};
    const lines: { label: string; value: string }[] = [];
    const brandName = input.brandName?.trim().slice(0, 120);
    if (brandName && brandName !== deal.brandName) { updates.brandName = brandName; lines.push({ label: "Client", value: `${deal.brandName} → ${brandName}` }); }
    const dealTitle = input.dealTitle?.trim().slice(0, 200);
    if (dealTitle && dealTitle !== deal.dealTitle) { updates.dealTitle = dealTitle; lines.push({ label: "Title", value: `${deal.dealTitle} → ${dealTitle}` }); }

    let amountChanged = false;
    if (input.dealAmount !== undefined) {
      const major = s.currency === "INR" ? Math.round(input.dealAmount) : input.dealAmount;
      const minor = Number.isFinite(major) ? toMinor(major, s.currency) : NaN;
      const ok = amountMinorSchema.safeParse(minor);
      if (!ok.success || ok.data <= 0 || ok.data > MAX_AMOUNT_MINOR) return { ok: false, code: "invalid_amount", message: "That isn't a valid deal amount." };
      if (ok.data !== deal.dealAmountMinor) {
        updates.dealAmountMinor = ok.data; amountChanged = true;
        lines.push({ label: "Amount", value: `${money(deal.dealAmountMinor, s)} → ${money(ok.data, s)}` });
      }
    }
    const start = input.startDate ?? deal.startDate, end = input.endDate ?? deal.endDate;
    if ((input.startDate && !DATE.test(input.startDate)) || (input.endDate && !DATE.test(input.endDate))) return { ok: false, code: "invalid_date", message: "Dates must be written as YYYY-MM-DD." };
    if (input.startDate || input.endDate) {
      if (Date.parse(end) < Date.parse(start)) return { ok: false, code: "invalid_date", message: "The end date can't be before the start date." };
      if (input.startDate && input.startDate !== deal.startDate) { updates.startDate = input.startDate; lines.push({ label: "Start", value: `${deal.startDate} → ${input.startDate}` }); }
      if (input.endDate && input.endDate !== deal.endDate) { updates.endDate = input.endDate; lines.push({ label: "End", value: `${deal.endDate} → ${input.endDate}` }); }
    }
    let termsToAdd: string | undefined;
    const addTerms = input.addTerms?.trim().slice(0, 600);
    if (addTerms && appendLines(deal.customTerms, addTerms) !== appendLines(deal.customTerms, "")) {
      termsToAdd = addTerms;
      lines.push({ label: "Add to terms", value: addTerms });
    }
    if (!lines.length) return { ok: false, code: "no_change", message: "That's already how the deal is set up, so there's nothing to change." };

    const quote = await storage.getQuoteByDealId(deal.id);
    return {
      ok: true,
      args: { dealId: deal.id, updates, ...(termsToAdd ? { addTerms: termsToAdd } : {}) },
      // Changing what the client will be asked to pay is never silent.
      forceApproval: amountChanged,
      preview: {
        title: `Update deal: ${deal.brandName} — ${deal.dealTitle}`,
        lines,
        effects: quote?.status === "draft" ? ["The draft quotation will be marked revised, so you regenerate it."] : [],
      },
    };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const dealId = Number(args.dealId);
    const deal = await dealFor(ctx, dealId);
    if (!deal) return fail("not_found", "That deal isn't in your organization.");
    // Re-checked: it may have been activated since the request was made.
    if (deal.status !== "Pending") return fail("not_editable", "That deal is no longer pending, so it can't be edited.");
    const updates = { ...(args.updates as Record<string, unknown>) } as Record<string, any>;
    if (typeof args.addTerms === "string") updates.customTerms = appendLines(deal.customTerms, args.addTerms);
    const updated = await storage.updateDeal(dealId, updates);
    if (!updated) return fail("failed", "Couldn't update the deal.");
    await reviseDraftQuote(dealId);
    logOrgActivity(ctx.user as any, "updated", "deal", dealId, `Deal: ${updated.dealTitle || updated.brandName} (via Agent)`);
    return { ok: true, summary: `Updated "${updated.dealTitle}" for ${updated.brandName}.`, route: `/deals/${dealId}` };
  },
};

// ── add_protection_term ────────────────────────────────────────────────────

const addProtectionTerm: AgentTool<{ dealId: number; flagId: string }> = {
  name: "add_protection_term",
  description: "Add the Protection Check's suggested wording for one finding to a PENDING deal's terms. Pass the finding's id from run_protection_check. The wording comes from the app, never from you.",
  risk: "SAFE_MUTATION",
  input: z.object({ dealId: z.number(), flagId: z.string().describe("A finding id, e.g. from run_protection_check") }),
  authorize: allOf(needsPermission("deals.edit", "editing deals"), needsLinkedRead()),
  async prepare(ctx, { dealId, flagId }) {
    const deal = await dealFor(ctx, dealId);
    if (!deal) return { ok: false, code: "not_found", message: "That deal isn't in your organization." };
    if (deal.status !== "Pending") return { ok: false, code: "not_editable", message: "Only pending deals can be edited." };
    const flag = analyzeDealProtections(deal, await settingsFor(ctx)).flags.find((f) => f.id === flagId);
    if (!flag?.suggestedTerm) return { ok: false, code: "no_suggestion", message: "There's no suggested wording for that finding." };
    if (appendLines(deal.customTerms, flag.suggestedTerm) === appendLines(deal.customTerms, "")) {
      return { ok: false, code: "no_change", message: "That term is already in the deal." };
    }
    return {
      ok: true,
      args: { dealId, term: flag.suggestedTerm },
      preview: { title: `Add a term to: ${deal.brandName} — ${deal.dealTitle}`, lines: [{ label: "Fixes", value: flag.title }, { label: "Adds", value: flag.suggestedTerm }], effects: [] },
    };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const dealId = Number(args.dealId);
    const deal = await dealFor(ctx, dealId);
    if (!deal) return fail("not_found", "That deal isn't in your organization.");
    if (deal.status !== "Pending") return fail("not_editable", "That deal is no longer pending, so it can't be edited.");
    await storage.updateDeal(dealId, { customTerms: appendLines(deal.customTerms, String(args.term)) });
    await reviseDraftQuote(dealId);
    logOrgActivity(ctx.user as any, "updated", "deal", dealId, `Terms added to: ${deal.dealTitle || deal.brandName} (via Agent)`);
    return { ok: true, summary: `Added the term to "${deal.dealTitle}".`, route: `/deals/${dealId}` };
  },
};

export const DEAL_TOOLS: AgentTool<any>[] = [analyzeDealMessage, runProtectionCheck, createDeal, updateDeal, addProtectionTerm];
