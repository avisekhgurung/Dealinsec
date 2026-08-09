/**
 * DealinSec Copilot — controlled tool registry.
 *
 * SECURITY MODEL (do not weaken):
 * - Organization is derived from the authenticated session user ONLY; the
 *   model/client can never supply an org id.
 * - Every tool goes through the same gates as the REST routes: org-scoped
 *   storage queries + inOrg on single entities + memberCan for permissioned
 *   data. A denied tool returns a polite denial string, not a leak.
 * - Read tools execute directly. The ONLY mutation is create_quotation and
 *   it is NEVER executed from the chat loop — the model proposes it, the
 *   user clicks a confirm button, and /api/copilot/execute re-validates
 *   everything. No sending, deleting, billing or permission tools exist.
 * - Results are size-capped: the model sees summaries, not row dumps.
 */
import { storage } from "../storage";
import { memberCan } from "@shared/permissions";
import { hasProAccess, type User } from "@shared/schema";
import { getBillingUser, logOrgActivity } from "../entitlements";
import { getDealJourney } from "./workflow";

const inOrg = (
  resource: { organizationId?: string | null; userId?: string | null } | null | undefined,
  user: User,
): boolean => {
  if (!resource) return false;
  if (resource.organizationId) return resource.organizationId === user.organizationId;
  return resource.userId === user.id;
};

const fmtINR = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const cap = <T,>(rows: T[], n = 8) => rows.slice(0, n);

/** OpenAI-compatible tool definitions sent to the model. */
export const TOOL_DEFS = [
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
        "Search the organization's deals by free text (client/title), optional status (Pending|Active|Completed) and optional minimum amount in rupees. Returns id, title, client, amount, status and route.",
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

/** Execute a read tool. Returns a compact string for the model. */
export async function runTool(name: string, args: any, user: User): Promise<ToolResult> {
  const orgId = user.organizationId;
  if (!orgId) return "No organization on this account.";

  switch (name) {
    case "get_workflow_status": {
      const journey = await getDealJourney(Number(args?.dealId), user);
      if (!journey) return "Deal not found in your organization.";
      return JSON.stringify(journey);
    }

    case "search_deals": {
      const all = await storage.getDealsByOrg(orgId, user.id);
      const q = String(args?.query || "").toLowerCase();
      const rows = all.filter(
        (d) =>
          (!q || d.brandName.toLowerCase().includes(q) || d.dealTitle.toLowerCase().includes(q)) &&
          (!args?.status || d.status === args.status) &&
          (!args?.minAmount || Number(d.dealAmount) >= Number(args.minAmount)),
      );
      if (!rows.length) return "No matching deals.";
      return cap(rows)
        .map((d) => `#${d.id} "${d.dealTitle}" · ${d.brandName} · ${fmtINR(Number(d.dealAmount))} · ${d.status} · route:/deals/${d.id}`)
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
      const all = await storage.getContractsByOrg(orgId, user.id);
      const q = String(args?.query || "").toLowerCase();
      const rows = all.filter(
        (c) =>
          (!q || c.contractName.toLowerCase().includes(q) || c.brandName.toLowerCase().includes(q)) &&
          (!args?.status || c.status === args.status),
      );
      if (!rows.length) return "No matching agreements.";
      return cap(rows)
        .map((c) => `Agreement #${c.id} "${c.contractName}" · ${fmtINR(Number(c.contractValue))} · ${c.status} · route:/contracts/${c.id}`)
        .join("\n");
    }

    case "search_invoices": {
      const all = await storage.getBrandInvoicesByOrg(orgId, user.id);
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
        .map((i) => `${i.invoiceNumber} · ${i.brandName} · ${fmtINR(Number(i.dealAmount))} · ${i.status}${i.dueDate ? ` · due ${i.dueDate}` : ""} · route:/brand-invoices/${i.id}`)
        .join("\n");
    }

    case "get_pending_work": {
      const [deals, contracts, invoices] = await Promise.all([
        storage.getDealsByOrg(orgId, user.id),
        storage.getContractsByOrg(orgId, user.id),
        storage.getBrandInvoicesByOrg(orgId, user.id),
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
        parts.push(`Unpaid invoices (${unpaid.length}, ${fmtINR(unpaid.reduce((s, i) => s + Number(i.dealAmount || 0), 0))} outstanding): ` + cap(unpaid, 5).map((i) => `${i.invoiceNumber} ${i.brandName} route:/brand-invoices/${i.id}`).join("; "));
      return parts.length ? parts.join("\n") : "Nothing pending — all deals, agreements and invoices are up to date. 🎉";
    }

    case "get_account_status": {
      const billing = await getBillingUser(user);
      const org = await storage.getOrganization(orgId);
      const members = await storage.countActiveMembers(orgId);
      const trialEnds = billing.trialEndsAt ? new Date(billing.trialEndsAt as any) : null;
      const trialActive = !!trialEnds && trialEnds.getTime() > Date.now();
      const plan = hasProAccess(billing)
        ? trialActive && billing.plan !== "pro"
          ? `Pro trial (ends ${trialEnds!.toLocaleDateString("en-IN", { day: "numeric", month: "short" })})`
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

// ── The one confirm-gated mutation ─────────────────────────────────────
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
