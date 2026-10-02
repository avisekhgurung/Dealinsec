/**
 * Policy layer: who may use which tool, and whether a change runs now or waits
 * for the user. Pure, so it is tested without a database.
 *
 * Order for every call: the user must be signed in with an organization, the
 * tool's own authorize() must pass (module read / permission / plan), and only
 * then does the risk class and autonomy level decide run-versus-approve.
 */
import { canReadLinkedRecord, canReadModule, memberCan, type Permission } from "@shared/permissions";
import { MAX_AUTONOMY, type AgentTool, type AgentUser, type AutonomyLevel, type Risk } from "./types";

export function normalizeAutonomy(x: unknown): AutonomyLevel {
  const n = Number(x);
  return n === 1 && MAX_AUTONOMY >= 1 ? 1 : 0;
}

export type Decision = "run" | "approve";

/** READ_ONLY always runs. SAFE_MUTATION runs only at level 1. A consequential
 *  mutation always asks, at every level. */
export function decide(risk: Risk, autonomy: AutonomyLevel, forceApproval = false): Decision {
  if (risk === "READ_ONLY") return "run";
  if (risk === "CONSEQUENTIAL_MUTATION") return "approve";
  return autonomy >= 1 && !forceApproval ? "run" : "approve";
}

/** null when the user may use the tool; otherwise the reason, in words the
 *  agent can relay. */
export function authorizeCall<I>(tool: AgentTool<I>, user: AgentUser | null | undefined, input: I): string | null {
  if (!user?.id || !user.organizationId) return "There is no organization on this account.";
  return tool.authorize(user, input);
}

// ── Reusable authorize() building blocks ───────────────────────────────────
// These are the same checks the REST routes apply (requireModuleRead,
// requireOrgPermission), so the agent can never read or do more than the
// member's own screens allow.

type Module = "deals" | "quotations" | "agreements" | "invoices";

/** Reads: every module named must be readable (custom roles are narrowed). */
export const needsRead = (...modules: Module[]) => (user: AgentUser): string | null => {
  for (const m of modules) {
    if (!canReadModule(user, m)) return `this member's role doesn't include viewing ${m}.`;
  }
  return null;
};

/** A single deal/agreement is readable when any module that references it is. */
export const needsLinkedRead = () => (user: AgentUser): string | null =>
  canReadLinkedRecord(user) ? null : "this member's role doesn't include viewing deals.";

export const needsPermission = (permission: Permission, what: string) => (user: AgentUser): string | null =>
  memberCan(user, permission) ? null : `your role doesn't allow ${what}. Ask your organization owner.`;

/** Combine several checks; the first failure wins. */
export const allOf = (...checks: ((user: AgentUser) => string | null)[]) => (user: AgentUser): string | null => {
  for (const c of checks) {
    const r = c(user);
    if (r) return r;
  }
  return null;
};
