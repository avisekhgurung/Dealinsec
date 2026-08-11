/**
 * Role-based access control for organizations.
 *
 * Permissions are DATA, not code: a role is just a named set of permission
 * strings, so adding a future role (Project Manager, Viewer, HR, custom) is
 * one entry in ROLE_PERMISSIONS — no route changes needed.
 *
 * Reads are org-scoped for every active member (everyone in the org can SEE
 * the org's deals/quotes/agreements/invoices). Permissions gate WRITES and
 * sensitive areas, matching the product spec:
 *   OWNER    — everything, incl. billing and org deletion
 *   ADMIN    — all business operations + team, but no billing / org deletion
 *   SALES    — deals, quotations, clients
 *   ACCOUNTS — invoices, payments; views agreements
 *
 * Shared by server middleware (requireOrgPermission) and client UI (hide
 * buttons the member can't use — the server remains the authority).
 */

export const orgRoleOptions = ["OWNER", "ADMIN", "SALES", "ACCOUNTS"] as const;
export type OrgRole = (typeof orgRoleOptions)[number];

export type Permission =
  | "deals.create"
  | "deals.edit"
  | "quotations.create"
  | "clients.manage"
  | "agreements.create"
  | "invoices.create"
  | "invoices.delete"  // split from invoices.create so custom roles can differ
  | "payments.manage"
  | "team.invite"
  | "team.manage"      // change roles, remove members
  | "org.settings"     // edit org profile
  | "org.delete"
  | "billing.manage"   // subscription, seats, purchases
  | "activity.view";

// NOTE: clients.manage is deliberately absent — no route checks it (clients
// are a field on deals, not a module). Kept in the type union only so any
// stored occurrence stays parseable.
const ALL: Permission[] = [
  "deals.create", "deals.edit", "quotations.create",
  "agreements.create", "invoices.create", "invoices.delete", "payments.manage",
  "team.invite", "team.manage", "org.settings", "org.delete",
  "billing.manage", "activity.view",
];

export const ROLE_PERMISSIONS: Record<OrgRole, Permission[]> = {
  OWNER: ALL,
  ADMIN: [
    "deals.create", "deals.edit", "quotations.create",
    "agreements.create", "invoices.create", "invoices.delete", "payments.manage",
    "team.invite", "team.manage", "org.settings", "activity.view",
  ],
  SALES: [
    "deals.create", "deals.edit", "quotations.create",
  ],
  ACCOUNTS: [
    "invoices.create", "invoices.delete", "payments.manage",
  ],
};

export function hasPermission(role: string | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  const perms = ROLE_PERMISSIONS[role as OrgRole];
  return !!perms && perms.includes(permission);
}

// ── Custom roles ───────────────────────────────────────────────────────
// The owner can mint org-scoped roles with any subset of
// ASSIGNABLE_PERMISSIONS (a member on one has users.org_role = "CUSTOM" +
// custom_role_id; their live permission set is attached to the session as
// customPermissions by isAuthenticated). memberCan() is THE permission
// check — server middleware and client UI both use it, so a custom role's
// matrix works everywhere without route changes.

/** Sentinel org_role value for members on a custom role. */
export const CUSTOM_ROLE = "CUSTOM";

/** What a custom role may be granted. org.delete and billing.manage stay
 *  owner-only: purchases activate on the payer's own user row, so a member
 *  with billing power would buy a plan that lands on the wrong account. */
export const ASSIGNABLE_PERMISSIONS: Permission[] = ALL.filter(
  (p) => p !== "org.delete" && p !== "billing.manage",
);

export function memberCan(
  user: { orgRole?: string | null; customPermissions?: string[] | null } | null | undefined,
  permission: Permission,
): boolean {
  if (!user) return false;
  if (user.orgRole === CUSTOM_ROLE || Array.isArray(user.customPermissions)) {
    return !!user.customPermissions?.includes(permission);
  }
  return hasPermission(user.orgRole, permission);
}

// ── Navigation shaping ─────────────────────────────────────────────────
// A member on a CUSTOM role should see an app that matches their job: an
// accounts person with only invoice permissions shouldn't wade past deals
// and quotations to reach their work. Built-in roles and the owner keep the
// full nav (their scope is broad by definition). Reads stay allowed
// server-side either way — this is navigation, not authorisation.
export const MODULE_PERMISSIONS: Record<string, Permission[]> = {
  deals: ["deals.create", "deals.edit"],
  quotations: ["quotations.create", "deals.create", "deals.edit"],
  agreements: ["agreements.create"],
  invoices: ["invoices.create", "invoices.delete", "payments.manage"],
};

/**
 * READ authority per module — the server-side counterpart to MODULE_PERMISSIONS.
 *
 * Hiding a nav item was never access control: an invoices-only member could
 * still GET /api/deals and read every client name and deal value in the
 * organisation. These lists decide who may READ each module, and they
 * deliberately include cross-module needs, because the workflow requires them:
 * you cannot raise an invoice without reading the agreement it comes from, and
 * you cannot write a quotation without reading its deal.
 *
 * Anything NOT listed is denied. Keep it that way.
 */
export const MODULE_READ: Record<string, Permission[]> = {
  // Quoting and agreement work both start from a deal.
  deals: ["deals.create", "deals.edit", "quotations.create", "agreements.create"],
  quotations: ["quotations.create", "deals.create", "deals.edit"],
  // Invoicing starts from an agreement, so invoice permissions grant read here.
  agreements: ["agreements.create", "invoices.create", "invoices.delete", "payments.manage"],
  invoices: ["invoices.create", "invoices.delete", "payments.manage"],
};

/** May this member read the module's records? Owners and built-in roles keep
 *  their existing scope; only CUSTOM roles are narrowed. */
export function canReadModule(
  user: { orgRole?: string | null; customPermissions?: string[] | null } | null | undefined,
  moduleKey: keyof typeof MODULE_READ,
): boolean {
  if (!user) return false;
  if (user.orgRole !== CUSTOM_ROLE) return true;
  const perms = MODULE_READ[moduleKey] ?? [];
  return perms.some((p) => !!user.customPermissions?.includes(p));
}

/** A single deal/agreement is readable when ANY module that legitimately
 *  references it is readable — an invoice screen has to name its deal. */
export function canReadLinkedRecord(
  user: { orgRole?: string | null; customPermissions?: string[] | null } | null | undefined,
): boolean {
  if (!user) return false;
  if (user.orgRole !== CUSTOM_ROLE) return true;
  return (["deals", "quotations", "agreements", "invoices"] as const).some((m) => canReadModule(user, m));
}

export function canSeeModule(
  user: { orgRole?: string | null; customPermissions?: string[] | null } | null | undefined,
  moduleKey: keyof typeof MODULE_PERMISSIONS,
): boolean {
  if (!user) return false;
  if (user.orgRole !== CUSTOM_ROLE) return true;
  const perms = MODULE_PERMISSIONS[moduleKey];
  return !perms || perms.some((p) => memberCan(user, p));
}

/** The permission matrix, module by module, for the role editor UI.
 *  "view" is not a row: reads are org-scoped for every active member by
 *  architecture (see file header) — the UI states that instead of faking
 *  a checkbox. */
export const PERMISSION_MATRIX: {
  module: string;
  items: { perm: Permission; label: string }[];
}[] = [
  { module: "Deals", items: [
    { perm: "deals.create", label: "Create" },
    { perm: "deals.edit", label: "Edit" },
  ]},
  { module: "Quotations", items: [
    { perm: "quotations.create", label: "Generate" },
  ]},
  { module: "Agreements", items: [
    { perm: "agreements.create", label: "Create & sign" },
  ]},
  { module: "Invoices", items: [
    { perm: "invoices.create", label: "Create" },
    { perm: "invoices.delete", label: "Delete" },
    { perm: "payments.manage", label: "Mark paid & track" },
  ]},
  { module: "Team", items: [
    { perm: "team.invite", label: "Invite members" },
    { perm: "team.manage", label: "Manage members" },
  ]},
  { module: "Organization", items: [
    { perm: "org.settings", label: "Edit settings" },
  ]},
  { module: "Activity", items: [
    { perm: "activity.view", label: "View log" },
  ]},
];

// ── Default role seeds ─────────────────────────────────────────────────
// Admin/Sales/Accounts are seeded into org_roles as ORDINARY editable,
// deletable rows (new orgs at creation; existing orgs lazily, once, via
// organizations.roles_seeded). Full flexibility — the owner can reshape or
// remove them. OWNER stays code-level: an org must always have exactly one
// root authority that holds billing.
export const DEFAULT_ROLE_SEEDS: { name: string; permissions: Permission[] }[] = [
  { name: "Admin",    permissions: ROLE_PERMISSIONS.ADMIN.filter((p) => ASSIGNABLE_PERMISSIONS.includes(p)) },
  { name: "Sales",    permissions: ROLE_PERMISSIONS.SALES.filter((p) => ASSIGNABLE_PERMISSIONS.includes(p)) },
  { name: "Accounts", permissions: ROLE_PERMISSIONS.ACCOUNTS.filter((p) => ASSIGNABLE_PERMISSIONS.includes(p)) },
];

/** Human labels for the team UI. */
export const ROLE_META: Record<OrgRole, { label: string; description: string }> = {
  OWNER: { label: "Owner", description: "Full access — billing, team, settings, everything." },
  ADMIN: { label: "Admin", description: "Runs the business + team. No billing or org deletion." },
  SALES: { label: "Sales", description: "Creates and edits deals, quotations and clients." },
  ACCOUNTS: { label: "Accounts", description: "Generates invoices and manages payments." },
};

/** Roles an inviter may assign (nobody invites a second OWNER). */
export const INVITABLE_ROLES: OrgRole[] = ["ADMIN", "SALES", "ACCOUNTS"];

// ── Seats ──────────────────────────────────────────────────────────────
// Free plan: 1 user. Pro (monthly or annual) AND the 7-day trial: 5
// included — the trial must sell the team workflow too (owner's call,
// 2026-08-08). Extra seats are purchased (₹199/seat/month) and live on the
// organization with one shared expiry. `owner` is the org owner's user row
// (billing lives there).
//
// Day-8 note: when the trial lapses this falls back to 1, which blocks NEW
// invites and accepts (both re-check the limit). Members who already joined
// keep their login, but every Pro feature dies with the owner's entitlement
// (getBillingUser) and deal creation drains the org's single free pool —
// so a lapsed trial's extra members cost nothing material.

export const PRO_INCLUDED_SEATS = 5;

export function getSeatLimit(
  owner: {
    plan?: string | null;
    planExpiresAt?: Date | string | null;
    trialEndsAt?: Date | string | null;
  } | null | undefined,
  org?: { extraSeats?: number | null; extraSeatsExpiresAt?: Date | string | null } | null,
): number {
  const proActive = !!owner && owner.plan === "pro" && !!owner.planExpiresAt &&
    new Date(owner.planExpiresAt).getTime() > Date.now();
  const trialActive = !!owner?.trialEndsAt &&
    new Date(owner.trialEndsAt).getTime() > Date.now();
  let seats = proActive || trialActive ? PRO_INCLUDED_SEATS : 1;
  if (org?.extraSeats && org.extraSeatsExpiresAt &&
      new Date(org.extraSeatsExpiresAt).getTime() > Date.now()) {
    seats += org.extraSeats;
  }
  return seats;
}
