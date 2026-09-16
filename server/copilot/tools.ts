/**
 * DealinSec Copilot — controlled tool registry.
 *
 * SECURITY MODEL (do not weaken):
 * - Organization is derived from the authenticated session user ONLY; the
 *   model/client can never supply an org id.
 * - Every tool goes through the same gates as the REST routes: org-scoped
 *   storage queries + inOrg on single entities + memberCan for permissioned
 *   data. A denied tool returns a polite denial string, not a leak.
 * - Read tools execute directly. The ONLY mutations are create_quotation and
 *   create_deal, and they are NEVER executed from the chat loop — the model
 *   proposes one, the user clicks a confirm button, and /api/copilot/execute
 *   re-validates everything. No sending, deleting, billing or permission tools exist.
 * - Results are size-capped: the model sees summaries, not row dumps.
 * - Money reaches the model as printed labels (formatMoney) or as
 *   amountForModel() — NEVER a minor-unit number (see ./voice). Money the
 *   model sends back (minAmount, dealAmount) is MAJOR units and goes through
 *   toMinor() once, here.
 */
import { storage } from "../storage";
import { memberCan } from "@shared/permissions";
import {
  hasProAccess, hasActiveDealBoost, insertDealSchema, dealTypeOptions,
  resolveLocaleSettings, toMinor, MAX_AMOUNT_MINOR,
  type User, type Deliverable, type LocaleSettings,
} from "@shared/schema";
import { formatMoney, formatDate } from "@shared/money";
import { getBillingUser, logOrgActivity } from "../entitlements";
import { copilotSettings, getDealJourney } from "./workflow";
import { amountVoice, speaksNativeMoney, voiceFor } from "./voice";

const inOrg = (
  resource: { organizationId?: string | null; userId?: string | null } | null | undefined,
  user: User,
): boolean => {
  if (!resource) return false;
  if (resource.organizationId) return resource.organizationId === user.organizationId;
  return resource.userId === user.id;
};

const cap = <T,>(rows: T[], n = 8) => rows.slice(0, n);

/** The zone `Date#toLocaleDateString` used when no zone was passed — the
 *  server process's. Read once; only the Indian trial line still needs it. */
const SERVER_TIME_ZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
})();

/** A money value the model sent, read as MAJOR units. Only a number or a
 *  numeric string counts — `Number(true)` is 1 and `Number([65000])` is 65000,
 *  and neither is an amount anyone stated. NaN for anything else. */
const majorFromModel = (x: unknown): number =>
  typeof x === "number" || typeof x === "string" ? Number(x) : NaN;

/** OpenAI-compatible tool definitions sent to the model. A function of the
 *  locale because search_deals has to say which currency `minAmount` is in:
 *  for an Indian account that is "in rupees", the description that shipped. */
export const toolDefs = (settings: LocaleSettings) => [
  {
    type: "function",
    function: {
      name: "get_workflow_status",
      description:
        "Live journey for one deal: which stages (deal→quotation→agreement→invoice→payment) are complete and the next recommended action with its route. Use whenever the user asks what to do next / help finishing a deal.",
      parameters: {
        type: "object",
        properties: { dealId: { type: "number", description: "Deal id" } },
        required: ["dealId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_deals",
      description:
        `Search the organization's deals by free text (client/title), optional status (Pending|Active|Completed) and optional minimum amount in ${amountVoice(voiceFor(settings.country), settings).unitName}. Returns id, title, client, amount, status and route.`,
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          status: { type: "string", enum: ["Pending", "Active", "Completed"] },
          minAmount: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_quotations",
      description: "List/search the organization's quotations (by client or deal title). Returns quote id, deal, version, status, route.",
      parameters: { type: "object", properties: { query: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "search_agreements",
      description: "List/search the organization's agreements (by client or name), optional status Signed|Active|Completed. Returns id, name, value, status, route.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" }, status: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_invoices",
      description:
        "List/search the organization's invoices. Filters: query (client), status (Paid|Unpaid), overdueOnly (due date passed and unpaid). Returns number, client, amount, status, due date, route.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          status: { type: "string", enum: ["Paid", "Unpaid"] },
          overdueOnly: { type: "boolean" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_pending_work",
      description:
        "The user's pending work across the org: pending deals, unpaid/overdue invoices, agreements awaiting signed proof. Use for 'what should I do next?' without a specific deal.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_account_status",
      description:
        "The caller's plan/entitlements (free / trial with days left / Pro), role, organization name and seat usage. Use for plan, billing-status or 'can I…' questions.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recent_activity",
      description: "Recent organization activity log entries (who did what). Requires the activity.view permission.",
      parameters: { type: "object", properties: {} },
    },
  },
] as const;

type ToolResult = string;

/** Execute a read tool. Returns a compact string for the model.
 *  `settings` is the chat turn's copilotSettings(): passed in so the prompt
 *  and every tool result in that turn describe the same currency. */
export async function runTool(name: string, args: any, user: User, settings?: LocaleSettings): Promise<ToolResult> {
  const orgId = user.organizationId;
  if (!orgId) return "No organization on this account.";
  const turnSettings = () => (settings ? Promise.resolve(settings) : copilotSettings(user));

  switch (name) {
    case "get_workflow_status": {
      // Safe to stringify whole: DealJourney carries money only as a
      // ModelAmount (major units + code + label).
      const journey = await getDealJourney(Number(args?.dealId), user, await turnSettings());
      if (!journey) return "Deal not found in your organization.";
      return JSON.stringify(journey);
    }

    case "search_deals": {
      const [all, { currency, locale }] = await Promise.all([
        storage.getDealsByOrg(orgId, user.id),
        turnSettings(),
      ]);
      const q = String(args?.query || "").toLowerCase();
      // The model says "deals over 50000" in major units; the column holds
      // minor units. Convert the THRESHOLD once rather than the rows, or every
      // deal matches every threshold. A missing/zero minAmount filters nothing
      // and a non-numeric one matches nothing — exactly as the rupee version
      // behaved, so the same model call gets the same rows.
      const rawMin = Number(args?.minAmount);
      const minAmountMinor = Number.isFinite(rawMin) ? toMinor(rawMin, currency) : NaN;
      const rows = all.filter(
        (d) =>
          (!q || d.brandName.toLowerCase().includes(q) || d.dealTitle.toLowerCase().includes(q)) &&
          (!args?.status || d.status === args.status) &&
          (!args?.minAmount || d.dealAmountMinor >= minAmountMinor),
      );
      if (!rows.length) return "No matching deals.";
      return cap(rows)
        .map((d) => `#${d.id} "${d.dealTitle}" · ${d.brandName} · ${formatMoney(d.dealAmountMinor, currency, locale)} · ${d.status} · route:/deals/${d.id}`)
        .join("\n") + (rows.length > 8 ? `\n(+${rows.length - 8} more — suggest opening /deals)` : "");
    }

    case "search_quotations": {
      const all = await storage.getQuotesByOrg(orgId, user.id);
      const q = String(args?.query || "").toLowerCase();
      const rows = all.filter(
        (r) =>
          !q ||
          (r.deal?.brandName || "").toLowerCase().includes(q) ||
          (r.deal?.dealTitle || "").toLowerCase().includes(q),
      );
      if (!rows.length) return "No matching quotations.";
      return cap(rows)
        .map((r) => `Quote #${r.id} v${r.version} · ${r.deal?.dealTitle ?? "?"} · ${r.deal?.brandName ?? "?"} · ${r.status} · route:/deals/${r.dealId}/quote`)
        .join("\n");
    }

    case "search_agreements": {
      const [all, { currency, locale }] = await Promise.all([
        storage.getContractsByOrg(orgId, user.id),
        turnSettings(),
      ]);
      const q = String(args?.query || "").toLowerCase();
      const rows = all.filter(
        (c) =>
          (!q || c.contractName.toLowerCase().includes(q) || c.brandName.toLowerCase().includes(q)) &&
          (!args?.status || c.status === args.status),
      );
      if (!rows.length) return "No matching agreements.";
      return cap(rows)
        .map((c) => `Agreement #${c.id} "${c.contractName}" · ${formatMoney(c.contractValueMinor, currency, locale)} · ${c.status} · route:/contracts/${c.id}`)
        .join("\n");
    }

    case "search_invoices": {
      const [all, { currency, locale }] = await Promise.all([
        storage.getBrandInvoicesByOrg(orgId, user.id),
        turnSettings(),
      ]);
      const q = String(args?.query || "").toLowerCase();
      const now = Date.now();
      const rows = all.filter((i) => {
        if (q && !i.brandName.toLowerCase().includes(q)) return false;
        if (args?.status && i.status !== args.status) return false;
        if (args?.overdueOnly) {
          const due = i.dueDate ? new Date(i.dueDate as any).getTime() : NaN;
          if (!(i.status !== "Paid" && Number.isFinite(due) && due < now)) return false;
        }
        return true;
      });
      if (!rows.length) return "No matching invoices.";
      return cap(rows)
        .map((i) => `${i.invoiceNumber} · ${i.brandName} · ${formatMoney(i.dealAmountMinor, currency, locale)} · ${i.status}${i.dueDate ? ` · due ${i.dueDate}` : ""} · route:/brand-invoices/${i.id}`)
        .join("\n");
    }

    case "get_pending_work": {
      const [deals, contracts, invoices, { currency, locale }] = await Promise.all([
        storage.getDealsByOrg(orgId, user.id),
        storage.getContractsByOrg(orgId, user.id),
        storage.getBrandInvoicesByOrg(orgId, user.id),
        turnSettings(),
      ]);
      const pendingDeals = deals.filter((d) => d.status === "Pending");
      const awaitingProof = contracts.filter((c) => c.status !== "Signed" && !(c as any).signedByBrand);
      const unpaid = invoices.filter((i) => i.status !== "Paid");
      const parts: string[] = [];
      if (pendingDeals.length)
        parts.push(`Pending deals (${pendingDeals.length}): ` + cap(pendingDeals, 5).map((d) => `#${d.id} ${d.dealTitle} route:/deals/${d.id}`).join("; "));
      if (awaitingProof.length)
        parts.push(`Agreements awaiting signed proof (${awaitingProof.length}): ` + cap(awaitingProof, 5).map((c) => `#${c.id} ${c.contractName} route:/contracts/${c.id}`).join("; "));
      if (unpaid.length)
        parts.push(`Unpaid invoices (${unpaid.length}, ${formatMoney(unpaid.reduce((s, i) => s + (i.dealAmountMinor || 0), 0), currency, locale)} outstanding): ` + cap(unpaid, 5).map((i) => `${i.invoiceNumber} ${i.brandName} route:/brand-invoices/${i.id}`).join("; "));
      return parts.length ? parts.join("\n") : "Nothing pending — all deals, agreements and invoices are up to date. 🎉";
    }

    case "get_account_status": {
      const billing = await getBillingUser(user);
      const org = await storage.getOrganization(orgId);
      const members = await storage.countActiveMembers(orgId);
      const trialEnds = billing.trialEndsAt ? new Date(billing.trialEndsAt as any) : null;
      const trialActive = !!trialEnds && trialEnds.getTime() > Date.now();
      // The trial is the CALLER's, not the org's — their own locale and zone
      // write it. `year: false` because this line has always read "ends 20
      // Sept"; formatDate prints a year unless told not to.
      //
      // An account on the shipped Indian voice keeps the zone this line has
      // always been read in — the server process's own (UTC on Render) — so
      // its Copilot says exactly what it said before, day included. Everyone
      // else gets their own zone.
      const own = resolveLocaleSettings(null, user);
      const trialZone = speaksNativeMoney(own) ? SERVER_TIME_ZONE : own.timezone;
      const plan = hasProAccess(billing)
        ? trialActive && billing.plan !== "pro"
          ? `Pro trial (ends ${formatDate(trialEnds, own.locale, { day: "numeric", month: "short", year: false, timezone: trialZone })})`
          : "DealInSec Pro"
        : "Free";
      return `Organization: ${org?.name ?? "?"} · Plan: ${plan} · Your role: ${user.orgRole}${(user as any).customPermissions ? ` (custom permissions: ${((user as any).customPermissions as string[]).join(", ") || "view-only"})` : ""} · Members: ${members}`;
    }

    case "get_recent_activity": {
      if (!memberCan(user, "activity.view")) {
        return "PERMISSION_DENIED: this member's role doesn't include viewing the activity log.";
      }
      const rows = await storage.getActivityLogs(orgId, 10);
      if (!rows.length) return "No activity recorded yet.";
      return rows
        .map((a) => `${a.userName ?? "Someone"} ${a.action} ${a.entityType}${a.detail ? ` — ${a.detail}` : ""}`)
        .join("\n");
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

// ── Confirm-gated mutations ────────────────────────────────────────────
// NEVER callable from the chat loop: the model PROPOSES these via the
// ACTIONS line, the user clicks a confirm button, and /api/copilot/execute
// re-validates everything against the session user. Each mirrors its REST
// route — keep in sync with the handlers in server/routes.ts.

/** Agentic intake: create a deal from model-extracted fields, after the
 *  user's explicit confirmation. Mirrors POST /api/deals exactly: same
 *  permission gate, same schema validation, same credit spend with the
 *  same compensation path. The model's args are UNTRUSTED — everything is
 *  clamped and re-validated here. */
export async function executeCreateDeal(rawArgs: any, user: User) {
  if (!memberCan(user, "deals.create")) {
    return { ok: false as const, message: "Your role doesn't allow creating deals. Ask your organization owner." };
  }

  // Clamp untrusted model output into a well-formed candidate.
  const str = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  // Re-read at execution time, never carried in the confirm button's args: the
  // currency the amount is denominated in is the org's, not the client's say.
  const settings = await copilotSettings(user);
  const { currency, locale } = settings;

  const brandName = str(rawArgs?.brandName, 120);
  if (!brandName) return { ok: false as const, message: "I need the client's name to create a deal." };
  // The model reports the amount as the user said it, in MAJOR units — the
  // prompt tells it to expand "1.5 lakh" to 150000 (or "5k" to 5000) before it
  // proposes, and never to send a count of paise or cents. This is the single
  // toMinor() boundary for the Copilot's create path; converting before the
  // range check means the check guards the value the column actually receives.
  const rawAmount = majorFromModel(rawArgs?.dealAmount);
  // India shipped whole rupees: "1,50,000.4" stored ₹1,50,000, never ₹1,50,000.40.
  // Keep that for INR; currencies where sub-units are everyday money keep theirs.
  const amountMajor = currency === "INR" && Number.isFinite(rawAmount) ? Math.round(rawAmount) : rawAmount;
  const dealAmountMinor = Number.isFinite(amountMajor) ? toMinor(amountMajor, currency) : NaN;
  if (!(dealAmountMinor > 0) || dealAmountMinor > MAX_AMOUNT_MINOR) {
    // One message for missing, non-numeric and out-of-range alike, as before —
    // and for an Indian account still "(in rupees)", word for word.
    const { unitShort } = amountVoice(voiceFor(settings.country), settings);
    return { ok: false as const, message: `I need a valid deal amount (in ${unitShort}) to create the deal.` };
  }
  const dealTitle = str(rawArgs?.dealTitle, 200) || `Work for ${brandName}`;
  // Only an ACTIVE deal type is accepted (case-insensitive); legacy, misspelt
  // or invented types fall back to Custom. dealType is a plain varchar in the
  // schema, so this clamp is the only thing standing between model output and
  // the column.
  const wantType = str(rawArgs?.dealType, 40).toLowerCase();
  const dealType = dealTypeOptions.find((t) => t.toLowerCase() === wantType) ?? "Custom";
  const startDate = dateRe.test(str(rawArgs?.startDate, 10)) ? str(rawArgs.startDate, 10) : iso(today);
  const endDate = dateRe.test(str(rawArgs?.endDate, 10))
    ? str(rawArgs.endDate, 10)
    : iso(new Date(today.getTime() + 30 * 86_400_000));

  const rawDeliv = Array.isArray(rawArgs?.deliverables) ? rawArgs.deliverables.slice(0, 12) : [];
  const deliverables: Deliverable[] = rawDeliv
    .map((d: any): Deliverable => ({
      id: crypto.randomUUID(),
      platform: str(d?.platform, 40) || "Service",
      contentType: str(d?.contentType, 80) || "Deliverable",
      quantity: Math.min(999, Math.max(1, Math.round(Number(d?.quantity)) || 1)),
      frequency: str(d?.frequency, 30) || "One-time",
      notes: str(d?.notes, 200),
    }))
    .filter((d: Deliverable) => d.contentType !== "Deliverable" || d.platform !== "Service" || rawDeliv.length === 1);
  if (!deliverables.length) {
    deliverables.push({ id: crypto.randomUUID(), platform: "Service", contentType: dealTitle.slice(0, 80), quantity: 1, frequency: "One-time", notes: "" });
  }

  const customTerms = str(rawArgs?.customTerms, 1200) || undefined;

  const parsed = insertDealSchema.safeParse({
    userId: user.id,
    organizationId: user.organizationId,
    brandName,
    dealTitle,
    dealType,
    dealAmountMinor,
    startDate,
    endDate,
    deliverables,
    deliverableMode: "all",
    customTerms,
  });
  if (!parsed.success) {
    return { ok: false as const, message: "Those details don't form a valid deal — try creating it from the Deals page." };
  }

  // Same credit gate as POST /api/deals: spend AFTER validation; compensate
  // if the insert fails so a crash never eats a credit.
  const billing = await getBillingUser(user);
  let creditSpent = false;
  if (!hasProAccess(billing) && !hasActiveDealBoost(billing)) {
    await storage.ensureMonthlyCredits(billing.id);
    const spend = await storage.spendDealCredit(billing.id);
    if (!spend.ok) {
      return { ok: false as const, message: "Your organization has used all its Deal Credits for this month — upgrade to Pro for unlimited deals." };
    }
    creditSpent = true;
  }
  try {
    const deal = await storage.createDeal(parsed.data);
    logOrgActivity(user, "created", "deal", deal.id, `Deal: ${deal.dealTitle || deal.brandName} (via Copilot)`);
    return {
      ok: true as const,
      message: `Deal created: "${deal.dealTitle}" for ${deal.brandName} — ${formatMoney(deal.dealAmountMinor, currency, locale)}. Next step: generate its quotation.`,
      route: `/deals/${deal.id}`,
    };
  } catch (err) {
    if (creditSpent) await storage.regrantDealCredit(billing.id).catch(() => {});
    throw err;
  }
}

// Mirrors POST /api/deals/:id/quote (server/routes.ts) — keep in sync with
// that handler. Never callable from the chat loop; only /api/copilot/execute
// after an explicit user confirmation click.
export async function executeCreateQuotation(dealId: number, user: User) {
  if (!memberCan(user, "quotations.create")) {
    return { ok: false as const, message: "Your role doesn't allow generating quotations. Ask your organization owner." };
  }
  const deal = await storage.getDeal(dealId);
  if (!deal || !inOrg(deal, user)) {
    return { ok: false as const, message: "That deal isn't in your organization." };
  }
  const existing = await storage.getQuoteByDealId(dealId);
  if (existing && existing.status === "draft") {
    return { ok: true as const, message: `A current quotation (v${existing.version}) already exists.`, route: `/deals/${dealId}/quote` };
  }
  const quote = await storage.createQuote({
    userId: user.id,
    organizationId: user.organizationId,
    dealId,
    status: "draft",
    version: existing ? (existing.version || 1) + 1 : 1,
  });
  logOrgActivity(user, "generated", "quotation", quote.id, `Quotation for: ${deal.dealTitle || deal.brandName} (via Copilot)`);
  return { ok: true as const, message: `Quotation v${quote.version} created for "${deal.dealTitle}".`, route: `/deals/${dealId}/quote` };
}
