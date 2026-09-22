import { sql } from 'drizzle-orm';
import { pgTable, text, integer, bigint, boolean, json, serial, varchar, timestamp, index, jsonb, unique, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { dealTypeOptions as TAXONOMY_DEAL_TYPES } from "./dealTypeTaxonomy";

// Legacy enum options — kept for backward compat with existing UI helpers.
// New deals can store any string here (validated client-side against taxonomy).
export const platformOptions = ["Instagram", "YouTube", "Twitter", "Facebook"] as const;
export const contentTypeOptions = ["Reel", "Video", "Story", "Post"] as const;
export const frequencyOptions = [
  "One-time",
  "Per week",
  "Per month",
  "Per quarter",
  "Per event",
  "Per session",
  "Per day",
  "Per hour",
] as const;

export const dealTypeOptions = TAXONOMY_DEAL_TYPES;
export type DealTypeOption = (typeof dealTypeOptions)[number];

// Deliverable is now generic — `platform` and `contentType` accept any string
// (e.g. "Instagram"/"Reel" for Creator, "Wedding photography"/"Per shoot" for
// Service Vendor). Frontend validates against the taxonomy.
export const deliverableSchema = z.object({
  id: z.string(),
  platform: z.string().min(1),
  contentType: z.string().min(1),
  quantity: z.number().min(1),
  frequency: z.string().min(1),
  notes: z.string().optional(),
});

export type Deliverable = z.infer<typeof deliverableSchema>;

export const dealStatusOptions = ["Pending", "Active", "Completed"] as const;
export const contractStatusOptions = ["Signed", "Active", "Completed"] as const;
export const invoiceStatusOptions = ["Unpaid", "Paid"] as const;
export const userRoleOptions = ["influencer", "brand"] as const;

// ═══════════════════════════════════════════════════════════════════════
// LOCALE + MONEY PRIMITIVES
//
// DealInSec is no longer India-only. A freelancer picks a country and every
// amount, document and message follows that country's conventions. India is
// one country among many here — it is the DEFAULT, never a special case, so
// every row written before these columns existed reads back as IN/INR/en-IN/
// Asia/Kolkata and behaves exactly as it does today.
// ═══════════════════════════════════════════════════════════════════════

export interface CurrencyMeta {
  /** ISO-4217 alphabetic code. */
  code: string;
  /** Glyph for tight spaces only — input adornments, table headers. Real
   *  formatting goes through Intl with the user's locale, never this alone
   *  (locale decides symbol placement, grouping and the space, not us). */
  symbol: string;
  /** ISO-4217 minor-unit exponent — the number of decimal places the currency
   *  actually has. 2 for most, 0 for JPY (a yen has no sub-unit), 3 for the
   *  Gulf dinars. Anything converting between major and minor units MUST read
   *  this. `* 100` is the bug this field exists to prevent. */
  exponent: number;
  name: string;
}

/** The currencies we support. Adding one is a data row, not a code change —
 *  including a 0-exponent or 3-exponent currency, because every conversion
 *  derives its factor from `exponent`. */
export const CURRENCIES = {
  INR: { code: "INR", symbol: "₹",   exponent: 2, name: "Indian Rupee" },
  USD: { code: "USD", symbol: "$",   exponent: 2, name: "US Dollar" },
  GBP: { code: "GBP", symbol: "£",   exponent: 2, name: "Pound Sterling" },
  EUR: { code: "EUR", symbol: "€",   exponent: 2, name: "Euro" },
  AUD: { code: "AUD", symbol: "A$",  exponent: 2, name: "Australian Dollar" },
  CAD: { code: "CAD", symbol: "C$",  exponent: 2, name: "Canadian Dollar" },
  NZD: { code: "NZD", symbol: "NZ$", exponent: 2, name: "New Zealand Dollar" },
  SGD: { code: "SGD", symbol: "S$",  exponent: 2, name: "Singapore Dollar" },
  AED: { code: "AED", symbol: "د.إ", exponent: 2, name: "UAE Dirham" },
  CHF: { code: "CHF", symbol: "CHF", exponent: 2, name: "Swiss Franc" },
  ZAR: { code: "ZAR", symbol: "R",   exponent: 2, name: "South African Rand" },
  // Added Sep 2026 to bill the large freelance markets in their own money
  // (ISO-4217 exponents: VND/KRW/CLP are 0; KWD/BHD/OMR are 3).
  PKR: { code: "PKR", symbol: "Rs", exponent: 2, name: "Pakistani Rupee" },
  BDT: { code: "BDT", symbol: "৳", exponent: 2, name: "Bangladeshi Taka" },
  NPR: { code: "NPR", symbol: "Rs", exponent: 2, name: "Nepalese Rupee" },
  LKR: { code: "LKR", symbol: "Rs", exponent: 2, name: "Sri Lankan Rupee" },
  PHP: { code: "PHP", symbol: "₱", exponent: 2, name: "Philippine Peso" },
  IDR: { code: "IDR", symbol: "Rp", exponent: 2, name: "Indonesian Rupiah" },
  VND: { code: "VND", symbol: "₫", exponent: 0, name: "Vietnamese Dong" },
  THB: { code: "THB", symbol: "฿", exponent: 2, name: "Thai Baht" },
  MYR: { code: "MYR", symbol: "RM", exponent: 2, name: "Malaysian Ringgit" },
  HKD: { code: "HKD", symbol: "HK$", exponent: 2, name: "Hong Kong Dollar" },
  CNY: { code: "CNY", symbol: "CN¥", exponent: 2, name: "Chinese Yuan" },
  KRW: { code: "KRW", symbol: "₩", exponent: 0, name: "South Korean Won" },
  TWD: { code: "TWD", symbol: "NT$", exponent: 2, name: "New Taiwan Dollar" },
  SAR: { code: "SAR", symbol: "SAR", exponent: 2, name: "Saudi Riyal" },
  QAR: { code: "QAR", symbol: "QAR", exponent: 2, name: "Qatari Riyal" },
  KWD: { code: "KWD", symbol: "KWD", exponent: 3, name: "Kuwaiti Dinar" },
  BHD: { code: "BHD", symbol: "BHD", exponent: 3, name: "Bahraini Dinar" },
  OMR: { code: "OMR", symbol: "OMR", exponent: 3, name: "Omani Rial" },
  ILS: { code: "ILS", symbol: "₪", exponent: 2, name: "Israeli New Shekel" },
  TRY: { code: "TRY", symbol: "₺", exponent: 2, name: "Turkish Lira" },
  EGP: { code: "EGP", symbol: "E£", exponent: 2, name: "Egyptian Pound" },
  NGN: { code: "NGN", symbol: "₦", exponent: 2, name: "Nigerian Naira" },
  KES: { code: "KES", symbol: "KSh", exponent: 2, name: "Kenyan Shilling" },
  GHS: { code: "GHS", symbol: "GH₵", exponent: 2, name: "Ghanaian Cedi" },
  MAD: { code: "MAD", symbol: "MAD", exponent: 2, name: "Moroccan Dirham" },
  BRL: { code: "BRL", symbol: "R$", exponent: 2, name: "Brazilian Real" },
  MXN: { code: "MXN", symbol: "MX$", exponent: 2, name: "Mexican Peso" },
  COP: { code: "COP", symbol: "COL$", exponent: 2, name: "Colombian Peso" },
  CLP: { code: "CLP", symbol: "CLP$", exponent: 0, name: "Chilean Peso" },
  ARS: { code: "ARS", symbol: "ARS$", exponent: 2, name: "Argentine Peso" },
  PEN: { code: "PEN", symbol: "S/", exponent: 2, name: "Peruvian Sol" },
  PLN: { code: "PLN", symbol: "zł", exponent: 2, name: "Polish Złoty" },
  SEK: { code: "SEK", symbol: "kr", exponent: 2, name: "Swedish Krona" },
  NOK: { code: "NOK", symbol: "kr", exponent: 2, name: "Norwegian Krone" },
  DKK: { code: "DKK", symbol: "kr", exponent: 2, name: "Danish Krone" },
  CZK: { code: "CZK", symbol: "Kč", exponent: 2, name: "Czech Koruna" },
  HUF: { code: "HUF", symbol: "Ft", exponent: 2, name: "Hungarian Forint" },
  RON: { code: "RON", symbol: "lei", exponent: 2, name: "Romanian Leu" },
  // Exponent 0 — ¥1,250 is 1250 minor units, not 125000. Kept in the supported
  // set deliberately: it is the row that keeps the exponent logic honest.
  JPY: { code: "JPY", symbol: "¥",   exponent: 0, name: "Japanese Yen" },
} as const satisfies Record<string, CurrencyMeta>;

export type CurrencyCode = keyof typeof CURRENCIES;
export const currencyOptions = Object.keys(CURRENCIES) as CurrencyCode[];

/** India, and the exact values every pre-expansion row backfills to. */
export const DEFAULT_LOCALE_SETTINGS = {
  country: "IN",
  currency: "INR",
  locale: "en-IN",
  timezone: "Asia/Kolkata",
} as const satisfies LocaleSettings;

export interface LocaleSettings {
  /** ISO-3166-1 alpha-2. */
  country: string;
  currency: CurrencyCode;
  /** BCP-47. */
  locale: string;
  /** IANA tz database name. */
  timezone: string;
}

/** The columns carrying locale, on `users` and on `organizations` alike. */
export type LocaleFields = {
  country?: string | null;
  currency?: string | null;
  locale?: string | null;
  timezone?: string | null;
};

/** Currency metadata for a code, falling back to INR.
 *
 *  The fallback is deliberate and load-bearing: an unrecognised code can only
 *  mean corrupt or hand-edited data, and a money screen that renders in the
 *  wrong currency is recoverable while one that throws is not. Callers that
 *  need to KNOW a code is supported should test `code in CURRENCIES`. */
export function getCurrency(code?: string | null): CurrencyMeta {
  const normalized = code?.trim().toUpperCase();
  const key = (normalized && normalized in CURRENCIES ? normalized : DEFAULT_LOCALE_SETTINGS.currency) as CurrencyCode;
  return CURRENCIES[key];
}

/** The effective locale for a user or an organization row.
 *
 *  Each field falls back independently, because "existing Indian behaviour
 *  stays bit-identical" has to hold for half-populated rows too. */
export function getLocaleSettings(source?: LocaleFields | null): LocaleSettings {
  return {
    country: source?.country?.trim().toUpperCase() || DEFAULT_LOCALE_SETTINGS.country,
    currency: getCurrency(source?.currency).code as CurrencyCode,
    locale: source?.locale?.trim() || DEFAULT_LOCALE_SETTINGS.locale,
    timezone: source?.timezone?.trim() || DEFAULT_LOCALE_SETTINGS.timezone,
  };
}

/** Which locale a DOCUMENT prints in when a user belongs to an organization.
 *
 *  The org wins. Deals, agreements and invoices are owned by the organization
 *  (see the organizations comment below), so a member in Berlin raising an
 *  invoice for a Mumbai agency must not quietly print euros. A member's own
 *  row still drives their personal UI — pass the user alone for that. */
export function resolveLocaleSettings(
  org?: LocaleFields | null,
  user?: LocaleFields | null,
): LocaleSettings {
  return getLocaleSettings({
    country: org?.country || user?.country,
    currency: org?.currency || user?.currency,
    locale: org?.locale || user?.locale,
    timezone: org?.timezone || user?.timezone,
  });
}

// ── Minor units ────────────────────────────────────────────────────────
// EVERY money value stored, transported or validated by this app is an
// integer count of MINOR units — paise, cents, yen. Never a float, never a
// major unit. Whole rupees could not represent $1,250.50 or a €18.81 VAT
// line; floats cannot represent money at all.
//
// The property names carry the unit (`dealAmountMinor`, `rateMinor`) so a
// reader can never mistake one for the other, and so the compiler flags every
// site that still thinks in rupees rather than letting it be wrong silently.

/** 10**exponent for a currency: 100 for INR/USD/GBP, 1 for JPY. */
export function minorUnitFactor(currency?: string | null): number {
  return 10 ** getCurrency(currency).exponent;
}

/** Upper bound on any stored money value, in minor units.
 *
 *  1e11 minor units is ₹1,000,000,000 — the exact ceiling the whole-rupee
 *  schema enforced before this migration, preserved rather than widened. Well
 *  inside both int8 and Number.MAX_SAFE_INTEGER, so sums and tax products stay
 *  exact. Its real job is rejecting a fat-fingered extra zero. */
export const MAX_AMOUNT_MINOR = 100_000_000_000;

/** Major units as a human types them (1250.50) → minor units (125050).
 *
 *  Rounds, because binary floats cannot hold 19.99: `19.99 * 100` is
 *  1998.9999999999998, and truncating there loses a cent on every such amount.
 *  Throws rather than coercing a non-finite input — a money function that
 *  quietly returns 0 writes a free deal to the database. */
export function toMinor(major: number, currency?: string | null): number {
  if (!Number.isFinite(major)) {
    throw new RangeError(`toMinor: ${major} is not a finite amount`);
  }
  return Math.round(major * minorUnitFactor(currency));
}

/** Minor units → major, for DISPLAY and for seeding an edit field only.
 *
 *  The result is a float. Never store it, never sum a list of them — sum in
 *  minor units and convert once at the end, and send anything a human edited
 *  back through toMinor(). */
export function fromMinor(minor: number, currency?: string | null): number {
  return minor / minorUnitFactor(currency);
}

/** The shape every money field in a request body must satisfy: a non-negative
 *  integer count of minor units. The `.int()` is what stops a "1250.50" from
 *  ever reaching a bigint column. */
export const amountMinorSchema = z.number().int().nonnegative().max(MAX_AMOUNT_MINOR);

// ── Migration ledger ───────────────────────────────────────────────────
// One row per one-way data migration that has already run. Boot migrations
// that merely ADD something are naturally idempotent and need no entry; this
// table exists for the ones that REWRITE existing rows, where "has this run?"
// cannot be answered by looking at the data. A value heuristic ("this number
// looks too small to be paise") is not an answer — it guesses, and guessing
// wrong multiplies someone's invoices by a hundred twice.
//
// Declared here rather than left as a raw-SQL orphan so `drizzle-kit push`
// sees it and never proposes dropping it.
export const appMigrations = pgTable("app_migrations", {
  key: text("key").primaryKey(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  password: varchar("password"),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  coverImageUrl: varchar("cover_image_url"),
  phone: varchar("phone"),
  panNumber: varchar("pan_number"),
  gstNumber: varchar("gst_number"),
  digitalSignature: varchar("digital_signature"),
  /** Business rubber stamp / seal image. NOT stamp duty — see estamp* on
   *  contracts for that. Indian documents conventionally carry both a
   *  signature and a seal. */
  companySeal: varchar("company_seal"),
  billingAddress: varchar("billing_address"),
  accountHolderName: varchar("account_holder_name"),
  accountNumber: varchar("account_number"),
  ifscCode: varchar("ifsc_code"),
  bankName: varchar("bank_name"),
  onboardingComplete: boolean("onboarding_complete").notNull().default(false),
  // Legacy migration bucket: old paid ₹299 agreement credits became these.
  // Never expire, cover 1 deal + its quotation each, consumed only after the
  // monthly allowance runs out. Nothing sells these anymore (referrals still
  // grant them). NOTE: deliberately still mapped to the legacy "contract_credits"
  // SQL column — the deployed production build selects that column by name, so
  // renaming it in the DB would break prod auth. Only the TS property is renamed.
  purchasedDealCredits: integer("contract_credits").notNull().default(0),
  plan: varchar("plan").notNull().default("free"),
  // "monthly" | "yearly" — distinguishes PRO_MONTHLY vs PRO_YEARLY while
  // `plan`/`planExpiresAt` keep working unchanged (incl. hasActivePro).
  planTerm: varchar("plan_term"),
  planExpiresAt: timestamp("plan_expires_at"),
  // Free plan: 4 Deal Credits per month (1 credit = create 1 deal + generate
  // its quotation). Reset lazily: whenever credits are read/spent after
  // monthlyCreditsResetAt has passed, the balance is SET back to 4 (no
  // rollover) and the next reset scheduled a month out.
  monthlyDealCredits: integer("monthly_deal_credits").notNull().default(4),
  monthlyCreditsResetAt: timestamp("monthly_credits_reset_at")
    .notNull()
    .default(sql`now() + interval '1 month'`),
  // ₹99 Deal Boost: unlimited deals + quotations while this is in the future.
  // Never unlocks Pro features (agreements/invoices/payment tracking).
  dealBoostExpiresAt: timestamp("deal_boost_expires_at"),
  // ── 7-day Pro trial ──
  // trial_started_at doubles as the permanent "has consumed a trial" flag —
  // NEVER cleared, and trial_ends_at is immutable after the grant. Refund
  // paths (revokeProPlan / revokeDealBoost) must never touch these columns.
  // The ONLY writer is maybeStartTrial() in server/trial.ts (one atomic
  // guarded UPDATE). Both nullable, no default: the deployed createUser
  // doesn't supply them.
  trialStartedAt: timestamp("trial_started_at"),
  trialEndsAt: timestamp("trial_ends_at"),
  // Canonical mailbox (shared/email.ts) — one trial per real mailbox.
  // Indexed, NOT unique; login always uses the real `email`.
  emailCanonical: varchar("email_canonical", { length: 255 }),
  // Password reset: bcrypt hash of the emailed token + 30-min expiry.
  // Cleared on successful reset. Never store or log the raw token.
  resetTokenHash: varchar("reset_token_hash"),
  resetTokenExpiresAt: timestamp("reset_token_expires_at"),
  referralCode: varchar("referral_code").unique(),
  // ── Organization membership (single org per user) ──
  organizationId: varchar("organization_id"),
  orgRole: varchar("org_role").notNull().default("OWNER"), // OWNER | ADMIN | SALES | ACCOUNTS | CUSTOM
  // Set when orgRole is "CUSTOM": points at an org_roles row whose
  // permissions array is this member's whole grant (loaded onto the session
  // by isAuthenticated). Role deleted ⇒ member degrades to view-only.
  customRoleId: varchar("custom_role_id"),
  memberStatus: varchar("member_status").notNull().default("active"), // active | removed
  invitedBy: varchar("invited_by"),
  joinedAt: timestamp("joined_at"),
  role: varchar("role").notNull().default("influencer"),
  // ── Locale (see CURRENCIES / getLocaleSettings above) ──
  // Seeded at signup from the browser's resolved timezone plus an IP hint,
  // always user-editable. NOT NULL with the India defaults so every row that
  // predates these columns — and every insert from the deployed build, which
  // does not supply them — is IN/INR/en-IN/Asia/Kolkata and unchanged.
  country: varchar("country", { length: 2 }).notNull().default(DEFAULT_LOCALE_SETTINGS.country),
  currency: varchar("currency", { length: 3 }).notNull().default(DEFAULT_LOCALE_SETTINGS.currency),
  locale: varchar("locale", { length: 35 }).notNull().default(DEFAULT_LOCALE_SETTINGS.locale),
  timezone: varchar("timezone", { length: 64 }).notNull().default(DEFAULT_LOCALE_SETTINGS.timezone),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// ───────────────────────────────────────────────────────────────────────
// Organizations — every account belongs to one. All business data (deals,
// quotations, agreements, invoices) is owned by the organization; users are
// members with a role. Billing deliberately stays on the OWNER's user row
// (plan/planTerm/planExpiresAt/credits) so the hardened payment paths are
// untouched — the org resolves its entitlements through its owner.
// ───────────────────────────────────────────────────────────────────────

export const organizations = pgTable("organizations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  slug: varchar("slug").unique(),
  logo: varchar("logo"),
  industry: varchar("industry"),
  // Extra seats purchased beyond the plan's included seats (₹99/seat/month).
  // One shared expiry: rebuying resets the pack. Included seats are derived
  // from the owner's plan (free = 1, Pro = 5) via getSeatLimit().
  extraSeats: integer("extra_seats").notNull().default(0),
  extraSeatsExpiresAt: timestamp("extra_seats_expires_at"),
  // One-shot latch for seeding the default editable roles (Admin/Sales/
  // Accounts) into org_roles — a deleted default must never resurrect.
  rolesSeeded: boolean("roles_seeded").notNull().default(false),
  // ── Locale ──
  // The org's settings, not the member's, are what a DOCUMENT prints in — the
  // business data belongs to the organization, so the currency on an invoice
  // must not follow whichever member happened to raise it. See
  // resolveLocaleSettings(). Same India defaults, same reason.
  country: varchar("country", { length: 2 }).notNull().default(DEFAULT_LOCALE_SETTINGS.country),
  currency: varchar("currency", { length: 3 }).notNull().default(DEFAULT_LOCALE_SETTINGS.currency),
  locale: varchar("locale", { length: 35 }).notNull().default(DEFAULT_LOCALE_SETTINGS.locale),
  timezone: varchar("timezone", { length: 64 }).notNull().default(DEFAULT_LOCALE_SETTINGS.timezone),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = typeof organizations.$inferInsert;

// Owner-minted custom roles: a named subset of ASSIGNABLE_PERMISSIONS
// (shared/permissions.ts). Members reference one via users.custom_role_id.
export const orgRoles = pgTable("org_roles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id),
  name: varchar("name", { length: 40 }).notNull(),
  permissions: json("permissions").$type<string[]>().notNull().default(sql`'[]'::json`),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type OrgCustomRole = typeof orgRoles.$inferSelect;

export const invitations = pgTable("invitations", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id),
  email: varchar("email").notNull(),
  orgRole: varchar("org_role").notNull().default("SALES"),
  customRoleId: varchar("custom_role_id"),
  token: varchar("token").notNull().unique(),
  invitedBy: varchar("invited_by").references(() => users.id),
  status: varchar("status").notNull().default("pending"), // pending | accepted | revoked
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Invitation = typeof invitations.$inferSelect;
export type InsertInvitation = typeof invitations.$inferInsert;

export const activityLogs = pgTable("activity_logs", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id),
  userId: varchar("user_id").references(() => users.id),
  userName: varchar("user_name"),
  action: varchar("action").notNull(),       // e.g. "created", "updated", "removed"
  entityType: varchar("entity_type").notNull(), // "deal" | "quotation" | "agreement" | "invoice" | "member" | ...
  entityId: varchar("entity_id"),
  detail: varchar("detail"),                 // human line, e.g. "Deal: Sharma Residence"
  createdAt: timestamp("created_at").defaultNow(),
});

// Per-organization, per-financial-year invoice sequence (Indian FY starts
// 1 April). Gives clients INV-2627-0001 instead of an epoch-based string.
// ── Product feedback ─────────────────────────────────────────────────────
// Ratings and suggestions from inside the app. Stored for the record and
// emailed to the founder — with 9 users there is no dashboard worth building,
// but every opinion should land in an inbox.
export const feedback = pgTable("feedback", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  organizationId: varchar("organization_id"),
  rating: integer("rating").notNull(),
  category: varchar("category", { length: 24 }),
  message: text("message"),
  /** May this quote be published as a testimonial, with the author's name?
   *  Only true when the author explicitly ticked the box. */
  allowTestimonial: boolean("allow_testimonial").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const feedbackCategories = ["suggestion", "bug", "praise", "other"] as const;

export const insertFeedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  category: z.enum(feedbackCategories).optional(),
  message: z.string().trim().max(2000).optional(),
  allowTestimonial: z.boolean().optional(),
});
export type Feedback = typeof feedback.$inferSelect;

export const invoiceCounters = pgTable("invoice_counters", {
  organizationId: varchar("organization_id").notNull(),
  fy: varchar("fy", { length: 9 }).notNull(),
  lastNo: integer("last_no").notNull().default(0),
}, (t) => ({
  // Production has carried this composite key since the table was created, but
  // it was never declared here — so a database built from this schema had no
  // key at all, and generateOrgInvoiceNumber's ON CONFLICT (organization_id,
  // fy) upsert failed with "no unique or exclusion constraint matching", 500ing
  // every invoice. Declared so a fresh environment matches production; the
  // boot-gate migration adds it where it is missing.
  pk: primaryKey({ columns: [t.organizationId, t.fy] }),
}));

/** "2627" for FY 2026-27 — the label that goes in the invoice number. */
export function financialYearCode(d: Date = new Date()): string {
  const y = d.getFullYear();
  const startYear = d.getMonth() >= 3 ? y : y - 1; // April = month 3
  return `${String(startYear).slice(-2)}${String(startYear + 1).slice(-2)}`;
}

export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertActivityLog = typeof activityLogs.$inferInsert;

export const planOptions = ["free", "pro"] as const;
export const planTermOptions = ["monthly", "yearly"] as const;

// DealInSec Pro: subscription with the unlimited full workflow (agreements,
// invoices, payment tracking). A user is Pro while `plan` is "pro" and the
// expiry is in the future. `planExpiresAt` is a Date on the server but an ISO
// string once serialized over the API, so both are accepted — this helper is
// shared by server route guards and client UI.
export function hasActivePro(
  user?: { plan?: string | null; planExpiresAt?: Date | string | null } | null,
): boolean {
  if (!user || user.plan !== "pro" || !user.planExpiresAt) return false;
  const expires = new Date(user.planExpiresAt).getTime();
  return Number.isFinite(expires) && expires > Date.now();
}

// ₹99 Deal Boost: unlimited deals + quotations for a month. Same Date|string
// tolerance as hasActivePro. Does NOT unlock Pro-only features.
export function hasActiveDealBoost(
  user?: { dealBoostExpiresAt?: Date | string | null } | null,
): boolean {
  if (!user?.dealBoostExpiresAt) return false;
  const expires = new Date(user.dealBoostExpiresAt).getTime();
  return Number.isFinite(expires) && expires > Date.now();
}

// ── 7-day Pro trial ────────────────────────────────────────────────────
// All Pro features unlocked for TRIAL_DAYS after onboarding. Granted once
// per owner, ever, by server/trial.ts. Same Date|string tolerance as above.

export const TRIAL_DAYS = 7;

export function hasActiveTrial(
  user?: { trialEndsAt?: Date | string | null } | null,
): boolean {
  if (!user?.trialEndsAt) return false;
  const ends = new Date(user.trialEndsAt).getTime();
  return Number.isFinite(ends) && ends > Date.now();
}

/** THE entitlement helper. Every server gate and every client "can I do X"
 *  check uses this. Display code must NOT — it has to tell paid Pro and
 *  trial apart (a trialist never sees the same card as a paying customer). */
export function hasProAccess(
  user?: {
    plan?: string | null;
    planExpiresAt?: Date | string | null;
    trialEndsAt?: Date | string | null;
  } | null,
): boolean {
  return hasActivePro(user) || hasActiveTrial(user);
}

/** 0 when no active trial; otherwise 1..TRIAL_DAYS. UI renders 1 as
 *  "Last day", never "1 day left". */
export function getTrialDaysLeft(
  user?: { trialEndsAt?: Date | string | null } | null,
): number {
  if (!hasActiveTrial(user)) return 0;
  const d = Math.ceil((new Date(user!.trialEndsAt as any).getTime() - Date.now()) / 86_400_000);
  return Math.min(TRIAL_DAYS, Math.max(1, d));
}

export type SubscriptionType = "FREE" | "PRO_MONTHLY" | "PRO_YEARLY" | "TRIAL";
export type SubscriptionStatus = "ACTIVE" | "EXPIRED" | "FREE" | "TRIAL" | "TRIAL_EXPIRED";

type PlanFields = {
  plan?: string | null;
  planTerm?: string | null;
  planExpiresAt?: Date | string | null;
  trialStartedAt?: Date | string | null;
  trialEndsAt?: Date | string | null;
};

// Display only — never derive an entitlement from this (use hasProAccess).
// Paid Pro is checked FIRST so a Pro purchase mid-trial reads "Pro".
export function getSubscriptionType(user?: PlanFields | null): SubscriptionType {
  if (hasActivePro(user)) return user?.planTerm === "monthly" ? "PRO_MONTHLY" : "PRO_YEARLY";
  if (hasActiveTrial(user)) return "TRIAL";
  return "FREE";
}

/** True only for accounts that actually LIVED a trial and let it lapse.
 *  Migrated accounts were marked trial-consumed with started == ends, so the
 *  strict `>` keeps them plain FREE, never TRIAL_EXPIRED. */
export function hasLapsedTrial(user?: PlanFields | null): boolean {
  if (!user?.trialStartedAt || !user?.trialEndsAt || hasActiveTrial(user)) return false;
  return new Date(user.trialEndsAt).getTime() > new Date(user.trialStartedAt).getTime();
}

// Derived, not stored: ACTIVE = Pro in force; EXPIRED = was Pro, term lapsed
// (renew prompt); TRIAL/TRIAL_EXPIRED = trial in force / lapsed; FREE =
// never subscribed (or fully reverted). Display only — never an entitlement.
export function getSubscriptionStatus(user?: PlanFields | null): SubscriptionStatus {
  if (hasActivePro(user)) return "ACTIVE";
  if (user?.plan === "pro") return "EXPIRED";
  if (hasActiveTrial(user)) return "TRIAL";
  if (hasLapsedTrial(user)) return "TRIAL_EXPIRED";
  return "FREE";
}

// Deal Credits as displayed everywhere: the monthly allowance plus any legacy
// purchased/referral credits (spent only after monthly hits 0).
export function getDealCredits(
  user?: { monthlyDealCredits?: number | null; purchasedDealCredits?: number | null } | null,
): { monthly: number; purchased: number; total: number } {
  const monthly = user?.monthlyDealCredits ?? 0;
  const purchased = user?.purchasedDealCredits ?? 0;
  return { monthly, purchased, total: monthly + purchased };
}

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;

export const deals = pgTable("deals", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  organizationId: varchar("organization_id"),
  brandUserId: varchar("brand_user_id").references(() => users.id),
  brandName: text("brand_name").notNull(),
  dealTitle: text("deal_title").notNull(),
  dealType: varchar("deal_type").notNull().default("Custom"),
  /** Deal value in MINOR units of the owning org's currency — paise, cents.
   *  bigint, not integer: ×100 puts a ₹30 lakh deal at 3e8 and an int4 column
   *  tops out just past ₹2.14 crore. The SQL column name is unchanged; only
   *  the TS property is renamed, so the compiler flags every rupee-era read. */
  dealAmountMinor: bigint("deal_amount", { mode: "number" }).notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  deliverables: json("deliverables").$type<Deliverable[]>().notNull(),
  deliverableMode: varchar("deliverable_mode").notNull().default("all"),
  standardTermIds: json("standard_term_ids").$type<string[]>().default(sql`'[]'::json`),
  customTerms: text("custom_terms"),
  status: text("status").notNull().default("Pending"),
});

export const deliverableModeOptions = ["all", "any_one"] as const;

// Selectable standard T&Cs applied on quotations / deals.
// Wording is deal-type-neutral on purpose — these defaults appear on every deal
// type (creators, freelancers, consultants, service vendors), so they avoid
// creator-only words like "video" or "posting" and use "deliverables/work"
// instead. IDs are stable; only labels are looked up at render time.
/**
 * Standard terms, tagged with the document phases where they belong.
 * A term about QUOTATION VALIDITY has no business on an executed agreement —
 * the quotation's validity is spent the moment the agreement exists — so each
 * document filters to its own phase. `payment: true` marks terms that define
 * the payment structure: when any of these are selected, the agreement's
 * Compensation clause defers to them instead of printing its default schedule.
 */
export const STANDARD_TERMS = [
  { id: "validity_30", label: "This quotation is valid for 30 days from the date of issue.", phases: ["quotation"], payment: false },
  { id: "advance_50", label: "50% advance payment is required to confirm the project.", phases: ["quotation", "agreement"], payment: true },
  { id: "balance_7d", label: "The remaining 50% is due within 7 days of final delivery of the agreed deliverables.", phases: ["quotation", "agreement"], payment: true },
  { id: "revisions_2", label: "Up to 2 rounds of revisions are included. All change requests must be submitted together at one time.", phases: ["quotation", "agreement"], payment: false },
  { id: "cancellation", label: "If the project is cancelled after work has started, the advance payment is non-refundable. If the work has already been delivered, full payment may be required.", phases: ["quotation", "agreement"], payment: false },
] as const;

export type StandardTermId = typeof STANDARD_TERMS[number]["id"];
export type TermPhase = "quotation" | "agreement";

/** The standard terms that belong on a given document. */
export function termsForPhase(ids: readonly string[], phase: TermPhase) {
  return STANDARD_TERMS.filter((t) => ids.includes(t.id) && (t.phases as readonly string[]).includes(phase));
}

export const contracts = pgTable("contracts", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  organizationId: varchar("organization_id"),
  dealId: integer("deal_id").notNull().references(() => deals.id),
  contractName: text("contract_name").notNull(),
  brandName: text("brand_name").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  /** Agreed fee in MINOR units. See deals.dealAmountMinor. */
  contractValueMinor: bigint("contract_value", { mode: "number" }).notNull(),
  status: text("status").notNull().default("Pending"),
  exclusive: boolean("exclusive").notNull().default(true),
  proofFileName: text("proof_file_name"),
  proofFilePath: text("proof_file_path"),
  // Signer snapshot, captured when the agreement is created. The document
  // must always render the signature of the person who actually signed —
  // never the profile of whoever happens to be viewing it, and never a
  // signature the signer changed afterwards.
  signerUserId: varchar("signer_user_id"),
  signerName: varchar("signer_name"),
  signatureUrl: varchar("signature_url"),
  /** Seal captured at creation, for the same reason as signatureUrl: the
   *  document must not change when the profile changes. */
  sealUrl: varchar("seal_url"),
  // ── e-Stamp certificate ────────────────────────────────────────────────
  // DealInSec does NOT sell or issue stamp paper. The user buys an e-stamp
  // certificate themselves (SHCIL / their state portal) and records its
  // details here so the agreement can cite it. Storing the reference is
  // honest; generating one would not be.
  estampCertificateNo: varchar("estamp_certificate_no"),
  estampDate: varchar("estamp_date"),
  /** Duty paid, in MINOR units. Migrated alongside contractValueMinor rather
   *  than left in rupees because contract-pdf.tsx prints both through the SAME
   *  money formatter — a mixed pair there renders ₹500 of duty as ₹5.00. */
  estampAmountMinor: bigint("estamp_amount", { mode: "number" }),
  estampAuthority: varchar("estamp_authority"),
  signedByInfluencer: boolean("signed_by_influencer").notNull().default(false),
  signedByInfluencerDate: text("signed_by_influencer_date"),
  signedByBrand: boolean("signed_by_brand").notNull().default(false),
  signedDate: text("signed_date"),
  /** ISO-4217 code contractValueMinor and estampAmountMinor are denominated
   *  in, frozen when the agreement is created (issuingContext() in
   *  server/routes.ts). A signed agreement is evidence of what was agreed ON
   *  THE DAY, so it must keep printing ₹ even if the org's currency setting
   *  later reads something else — and a minor-unit amount means nothing
   *  without the currency it counts. Never client-writable.
   *
   *  Default 'INR' is what the additive migration backfills: every row that
   *  predates this column was issued by an INR org, which the minor-units
   *  migration's guard proves before it runs. */
  currency: varchar("currency", { length: 3 }).notNull().default(DEFAULT_LOCALE_SETTINGS.currency),

  // ── Client-facing e-signature (additive — see script/migrate-contract-esign.ts) ──
  // A parallel path to "signedByBrand" alongside the existing manual proof
  // upload, not a replacement for it: whichever happens first sets
  // signedByBrand/status the same way, so every downstream reader (Money
  // Radar, Deal Health, the workflow stepper) needs no change. These columns
  // ARE the audit record for the online path — who signed, with which
  // signature, when, from where.
  clientShareToken: varchar("client_share_token").unique(),
  clientSharedAt: timestamp("client_shared_at"),
  clientShareRevokedAt: timestamp("client_share_revoked_at"),
  clientShareViewCount: integer("client_share_view_count").notNull().default(0),
  /** The frozen, redacted content shown on the sign page — see
   *  shared/contractSign.ts. Never contains a tax id, bank field or the
   *  freelancer's own signature image. */
  clientSignShareSnapshot: jsonb("client_sign_share_snapshot"),
  clientSignedAt: timestamp("client_signed_at"),
  clientSignerName: varchar("client_signer_name"),
  clientSignerEmail: varchar("client_signer_email"),
  /** A drawn signature, captured as a PNG data URL at the moment of signing —
   *  never the freelancer's own signatureUrl, and never editable afterwards. */
  clientSignatureDataUrl: text("client_signature_data_url"),
  /** Best-effort provenance for the audit record, from the same
   *  Cloudflare-aware header read as the public quote endpoint. */
  clientSignerIp: varchar("client_signer_ip"),
  /** SHA-256 over the exact signed record — see shared/contractSign.ts
   *  computeDocumentHash(). Computed once, at the moment of signing, from
   *  fields that are never edited afterwards (the whole point of "signed
   *  means immutable"). A later mismatch would mean the stored row itself
   *  was altered outside the app — this is a tamper DETECTOR against that,
   *  not a cryptographic seal on the rendered PDF bytes; never claim more. */
  documentHash: varchar("document_hash"),
});

export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  organizationId: varchar("organization_id"),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceDate: text("invoice_date").notNull(),
  contractId: integer("contract_id").notNull().references(() => contracts.id),
  dealId: integer("deal_id").notNull().references(() => deals.id),
  brandName: text("brand_name").notNull(),
  influencerName: text("influencer_name").notNull(),
  contractFee: integer("contract_fee").notNull(),
  platformFee: integer("platform_fee").notNull(),
  totalAmount: integer("total_amount").notNull(),
  status: text("status").notNull().default("Unpaid"),
});

// The money fields are re-stated on every insert schema below. drizzle-zod
// infers a bare z.number() from a bigint column, which would accept 1250.50
// and hand Postgres a value it silently truncates; amountMinorSchema adds the
// .int() and the ceiling that make "minor units" enforceable rather than a
// naming convention.

export const insertDealSchema = createInsertSchema(deals)
  .omit({ id: true, status: true })
  .extend({ dealAmountMinor: amountMinorSchema });
export type InsertDeal = z.infer<typeof insertDealSchema>;
export type Deal = typeof deals.$inferSelect;

export const insertContractSchema = createInsertSchema(contracts)
  .omit({ id: true })
  .extend({
    contractValueMinor: amountMinorSchema,
    estampAmountMinor: amountMinorSchema.nullable().optional(),
  });
export type InsertContract = z.infer<typeof insertContractSchema>;
export type Contract = typeof contracts.$inferSelect;

export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoices.$inferSelect;

export const brandInvoices = pgTable("brand_invoices", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  organizationId: varchar("organization_id"),
  // NOT globally unique: every organisation runs its own series, so two
  // workspaces legitimately both hold INV-2627-0001. Uniqueness is the
  // (organization_id, invoice_number) constraint below — which is what
  // production has. A global unique here made the SECOND workspace's first
  // invoice fail on any database built from this schema.
  invoiceNumber: text("invoice_number").notNull(),
  invoiceDate: text("invoice_date").notNull(),
  dueDate: text("due_date"),
  dealId: integer("deal_id").notNull().references(() => deals.id),
  contractId: integer("contract_id").references(() => contracts.id),
  brandName: text("brand_name").notNull(),
  influencerName: text("influencer_name").notNull(),
  influencerEmail: text("influencer_email"),
  /** Invoice total in MINOR units. See deals.dealAmountMinor. */
  dealAmountMinor: bigint("deal_amount", { mode: "number" }).notNull(),
  invoiceType: varchar("invoice_type").notNull().default("full"),
  splitPercentage: integer("split_percentage"),
  notes: text("notes"),
  // Itemised lines composed on the invoice screen. Nullable: invoices raised
  // before the composer existed derive a single line from their deal, and the
  // detail page still renders those. hsnSac is carried now (optional) so a
  // Rule 46 GST invoice is a matter of adding tax columns, not a rewrite.
  lineItems: jsonb("line_items").$type<InvoiceLineItem[]>(),
  status: text("status").notNull().default("Unpaid"),
  /** Set by the server on Unpaid→Paid, cleared on undo. Never client-writable —
   *  a paid invoice printing "PAID · date" must reflect a recorded payment. */
  paidAt: timestamp("paid_at"),
  /** ISO-4217 code dealAmountMinor and every line item are denominated in,
   *  frozen at issue. Same reason and same 'INR' backfill as
   *  contracts.currency. Never client-writable: it is deliberately absent
   *  from the invoice PATCH allowlist. */
  currency: varchar("currency", { length: 3 }).notNull().default(DEFAULT_LOCALE_SETTINGS.currency),
}, (t) => ({
  // Per-ORG uniqueness, not global: INV-2627-0001 restarts for every business
  // each financial year. A global unique meant the second organisation to
  // raise an invoice collided on its very first one.
  orgInvoiceNumber: unique("brand_invoices_org_invoice_number_unique").on(t.organizationId, t.invoiceNumber),
}));

/** One billable row on an invoice. Amounts are MINOR units, matching
 *  dealAmountMinor — sub-unit precision is what makes a VAT line expressible.
 *
 *  The JSON keys were renamed from `rate`/`amount` along with the columns, and
 *  the stored documents were rewritten by the same migration. jsonb gets no
 *  help from the compiler at the storage layer, so the key rename is the only
 *  thing that turns a stale writer into a loud validation failure instead of a
 *  silent 100× error. */
export interface InvoiceLineItem {
  description: string;
  hsnSac?: string;
  /** A count of things, not money — never scaled by the minor-unit factor. */
  quantity: number;
  rateMinor: number;
  amountMinor: number;
}

export const invoiceLineItemSchema = z.object({
  description: z.string().trim().min(1, "Description is required").max(300),
  hsnSac: z.string().trim().max(12).optional(),
  quantity: z.number().int().positive().max(100000),
  rateMinor: amountMinorSchema,
  amountMinor: amountMinorSchema,
});

export const brandInvoiceTypeOptions = ["full", "advance", "final"] as const;

export const insertBrandInvoiceSchema = createInsertSchema(brandInvoices)
  .omit({ id: true })
  .extend({ dealAmountMinor: amountMinorSchema });
export type InsertBrandInvoice = z.infer<typeof insertBrandInvoiceSchema>;
export type BrandInvoice = typeof brandInvoices.$inferSelect;

// Tax & supporting documents attached to an invoice (GST invoice copy, TDS
// certificate, payment receipt, etc.). Centralises the paperwork creators
// otherwise scatter across email/WhatsApp, so tax filing is a single tap away.
export const invoiceDocumentCategories = [
  "GST Invoice",
  "TDS Certificate",
  "Form 16A",
  "Payment Receipt",
  "Bank Statement",
  "Purchase Order",
  "Other",
] as const;
export type InvoiceDocumentCategory = (typeof invoiceDocumentCategories)[number];

export const invoiceAttachments = pgTable("invoice_attachments", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  brandInvoiceId: integer("brand_invoice_id").notNull().references(() => brandInvoices.id),
  category: varchar("category").notNull().default("Other"),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  fileId: varchar("file_id"),          // ImageKit fileId, for later deletion (null for local uploads)
  fileSize: integer("file_size"),
  mimeType: varchar("mime_type"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertInvoiceAttachmentSchema = createInsertSchema(invoiceAttachments).omit({ id: true, createdAt: true });
export type InsertInvoiceAttachment = z.infer<typeof insertInvoiceAttachmentSchema>;
export type InvoiceAttachment = typeof invoiceAttachments.$inferSelect;

export const creditTransactionTypeOptions = ["grant", "purchase", "usage", "refund", "referral"] as const;

export const creditTransactions = pgTable("credit_transactions", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  delta: integer("delta").notNull(),
  type: varchar("type").notNull(),
  amount: integer("amount"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCreditTransactionSchema = createInsertSchema(creditTransactions).omit({ id: true, createdAt: true });
export type InsertCreditTransaction = z.infer<typeof insertCreditTransactionSchema>;
export type CreditTransaction = typeof creditTransactions.$inferSelect;

export const payuOrders = pgTable("payu_orders", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  orderId: varchar("order_id").notNull().unique(),
  amount: integer("amount").notNull(),
  credits: integer("credits").notNull(),
  // What the payment buys: "credits" (default) or "pro_plan" (annual Pro).
  purpose: varchar("purpose").notNull().default("credits"),
  status: varchar("status").notNull().default("pending"),
  payuTxnId: varchar("payu_txn_id"),
  payuHash: varchar("payu_hash"),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertPayuOrderSchema = createInsertSchema(payuOrders).omit({ id: true, createdAt: true, completedAt: true });
export type InsertPayuOrder = z.infer<typeof insertPayuOrderSchema>;
export type PayuOrder = typeof payuOrders.$inferSelect;

export const quotes = pgTable("quotes", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  organizationId: varchar("organization_id"),
  dealId: integer("deal_id").notNull().references(() => deals.id),
  status: varchar("status").notNull().default("draft"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),

  // ── Client-facing sharing (additive — see script/migrate-quote-share.ts) ──
  // A share link is a capability URL, not a password: it must be showable to
  // its owner again on reload (a real "copy link" button, like any other
  // product's share link), so the token itself is stored, not a hash of it —
  // unlike the password-reset token, which is a proof of mailbox control and
  // is looked up by email first. Its security is 192 bits of randomness plus
  // `shareRevokedAt`, not secrecy of the database.
  shareToken: varchar("share_token").unique(),
  /** The REDACTED content frozen at share time — see shared/quoteShare.ts.
   *  A client who opened the link keeps seeing the price they were quoted
   *  even if the deal is edited afterwards; PAN/GSTIN/bank fields are never
   *  in this object, because it is served with NO authentication. */
  shareSnapshot: jsonb("share_snapshot"),
  sharedAt: timestamp("shared_at"),
  shareRevokedAt: timestamp("share_revoked_at"),
  shareViewCount: integer("share_view_count").notNull().default(0),
  /** Soft signal only — "the client clicked Accept", never a signature. See
   *  agreement acceptance (Phase 6) for anything that needs to be relied on. */
  acceptedAt: timestamp("accepted_at"),
});

export const insertQuoteSchema = createInsertSchema(quotes).omit({ id: true, createdAt: true });
export type InsertQuote = z.infer<typeof insertQuoteSchema>;
export type Quote = typeof quotes.$inferSelect;

// Referrals table
export const referrals = pgTable("referrals", {
  id: serial("id").primaryKey(),
  referrerId: varchar("referrer_id").notNull().references(() => users.id),
  referredUserId: varchar("referred_user_id").notNull().references(() => users.id),
  status: varchar("status").notNull().default("completed"),
  creditAwarded: integer("credit_awarded").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertReferralSchema = createInsertSchema(referrals).omit({ id: true, createdAt: true });
export type InsertReferral = z.infer<typeof insertReferralSchema>;
export type Referral = typeof referrals.$inferSelect;

// Newsletter / waitlist email capture (from landing footer)
export const newsletterSubscribers = pgTable("newsletter_subscribers", {
  id: serial("id").primaryKey(),
  email: varchar("email").notNull().unique(),
  source: varchar("source").default("footer"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertNewsletterSchema = createInsertSchema(newsletterSubscribers).omit({ id: true, createdAt: true });
export type InsertNewsletterSubscriber = z.infer<typeof insertNewsletterSchema>;
export type NewsletterSubscriber = typeof newsletterSubscribers.$inferSelect;

// Documents saved from the public free tools (invoice, quotation, proforma,
// purchase order, service agreement). Standalone artifacts — NOT tied to a deal
// or credits — that a signed-in user chose to keep. `payload` holds the full
// in-browser form state so the document can be re-rendered/edited later.
export const TOOL_DOCUMENT_TYPES = [
  "invoice",
  "quotation",
  "proforma",
  "purchase_order",
  "agreement",
] as const;
export type ToolDocumentType = (typeof TOOL_DOCUMENT_TYPES)[number];

export const toolDocuments = pgTable("tool_documents", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  type: varchar("type").notNull(),
  title: varchar("title"),
  docNumber: varchar("doc_number"),
  partyName: varchar("party_name"),
  total: integer("total"),
  currency: varchar("currency").notNull().default("INR"),
  payload: jsonb("payload").notNull(),
  source: varchar("source").notNull().default("free_tool"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertToolDocumentSchema = createInsertSchema(toolDocuments).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertToolDocument = z.infer<typeof insertToolDocumentSchema>;
export type ToolDocument = typeof toolDocuments.$inferSelect;


// ── Human-facing record numbers ────────────────────────────────────────
// Short, unique, sortable identifiers built from each table's own serial id
// (no migration, no collisions — the id is already unique per record type).
// Shown everywhere a record is listed or opened so users and their clients
// can quote a reference: "DL-0042", "QT-0007", "AG-0015".
export const RECORD_PREFIX = {
  deal: "DL",
  quotation: "QT",
  agreement: "AG",
  invoice: "IN",
} as const;

export function recordNo(kind: keyof typeof RECORD_PREFIX, id: number | string): string {
  const n = Number(id);
  return `${RECORD_PREFIX[kind]}-${Number.isFinite(n) ? String(n).padStart(4, "0") : id}`;
}
