/**
 * Who may READ what through an AI tool — one table, used by both the Copilot's
 * chat tools and the agent's tools.
 *
 * The REST list routes already narrow a custom-role member with
 * requireModuleRead; the chat tools queried storage directly and skipped that,
 * so an invoices-only member could list every deal and amount by asking. Each
 * tool is mapped to the modules whose records it can reveal, and the member
 * must be allowed to read ALL of them (built-in roles and the owner keep their
 * full scope, exactly as in canReadModule).
 *
 * Pure: no storage, so it is tested without a database.
 */
import { canReadLinkedRecord, canReadModule, memberCan } from "@shared/permissions";

type Module = "deals" | "quotations" | "agreements" | "invoices";
type Who = { orgRole?: string | null; customPermissions?: string[] | null };

/** A tool reveals records of these modules; "linked" = any module that references a deal. */
export const TOOL_READS: Record<string, readonly Module[] | "linked" | "none"> = {
  get_workflow_status: "linked",
  search_deals: ["deals"],
  search_quotations: ["quotations"],
  search_agreements: ["agreements"],
  search_invoices: ["invoices"],
  get_pending_work: ["deals", "agreements", "invoices"],
  get_account_status: "none",
  get_money_radar: ["agreements", "invoices"],
  get_deal_health: ["deals", "invoices"],
  run_protection_check: ["deals"],
  get_recent_activity: "none", // gated by the activity.view permission below
};

/** null when the member may use the tool's data; otherwise the reason. Unknown tools are denied. */
export function readDenial(tool: string, user: Who | null | undefined): string | null {
  const need = TOOL_READS[tool];
  if (need === undefined) return `unknown tool ${tool}.`;
  if (need === "none") {
    if (tool === "get_recent_activity" && !memberCan(user as any, "activity.view")) {
      return "this member's role doesn't include viewing the activity log.";
    }
    return null;
  }
  if (need === "linked") return canReadLinkedRecord(user) ? null : "this member's role doesn't include viewing deals.";
  for (const m of need) if (!canReadModule(user, m)) return `this member's role doesn't include viewing ${m}.`;
  return null;
}
