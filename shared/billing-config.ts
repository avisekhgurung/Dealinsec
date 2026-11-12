/**
 * Runtime billing configuration: the shapes, the defaults and the validation, kept pure (no database, no Express) so the
 * server cache, the admin routes, the wallet and the tests all read one definition.
 *
 * Every value here is a FALLBACK default. The truth is a row in billing_config (script/migrate-credits.ts), edited on
 * the admin screen without a deploy; environment variables and shared/outbound-plans.ts remain below that as the
 * fallback for a key with no row. Nothing in this file names an allowance or a price: plan allowances are read from
 * OUTBOUND_ALLOWANCE_DEFAULTS, pack prices live in credit_packs.
 */
import type { CreditKind } from "./schema";
import type { OutboundAllowance } from "./outbound-plans";

/** The allowance fields an admin may override per plan (maxCompanies stays a code/env value: it shapes a single search). */
export const ALLOWANCE_FIELDS = ["monthlySearches", "monthlyLists", "monthlySocialScans", "monthlyProspects", "monthlyDrafts", "monthlySends"] as const;
export type AllowanceField = (typeof ALLOWANCE_FIELDS)[number];
export type AllowanceOverrides = Partial<Record<AllowanceField, number>>;
/** Which plans carry an override. "free" and "pro" are the plans; trial and unlimited are never overridden here. */
export const OVERRIDABLE_TIERS = ["free", "pro"] as const;
export type OverridableTier = (typeof OVERRIDABLE_TIERS)[number];

export interface BillingConfig {
  /** Per-plan monthly allowance overrides; a missing field falls back to the environment, then OUTBOUND_ALLOWANCE_DEFAULTS. */
  allowances: Partial<Record<OverridableTier, AllowanceOverrides>>;
  /** The share of an allowance used at which the app starts warning (percent, 50–99). */
  warnPercent: number;
  /** Whether the app shows the warning at `warnPercent` and the exhausted notice at 100% (the admin's notification switches). */
  notify: { warn: boolean; exhausted: boolean };
  /** How many purchased credits one action spends (whole numbers, 1–5). The plan allowance always counts actions, not credits. */
  creditCost: Record<CreditKind, number>;
  /**
   * How much the workspace's AI + provider spend ceiling grows for each purchased credit spent in the window, in US
   * dollars, so a search someone paid for is not refused by a safety ceiling sized for the plan alone.
   */
  spendHeadroomUsd: Record<CreditKind, number>;
  /** The expiry months a NEW pack starts with in the admin form (a pack's own expiry is what a buyer is shown); null = never. */
  defaultExpiryMonths: number | null;
}

export const BILLING_CONFIG_DEFAULTS: Readonly<BillingConfig> = {
  allowances: {},
  warnPercent: 80,
  notify: { warn: true, exhausted: true },
  creditCost: { search: 1, draft: 1 },
  // A completed search cost about $0.07 on average and $0.24 at the 90th percentile (shared/outbound-plans.ts), a draft
  // about $0.002: the headroom covers the 90th percentile search and a few drafts' worth of rounding.
  spendHeadroomUsd: { search: 0.25, draft: 0.01 },
  defaultExpiryMonths: 12,
};

export const BILLING_CONFIG_KEYS = ["allowances", "warn_percent", "notify", "credit_cost", "spend_headroom_usd", "default_expiry_months"] as const;
export type BillingConfigKey = (typeof BILLING_CONFIG_KEYS)[number];

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isNum = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

/** Validate one config value for its key. Returns the clean value, or an error message for the admin. */
export function validateConfigValue(key: BillingConfigKey, value: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error });
  switch (key) {
    case "allowances": {
      if (!value || typeof value !== "object") return bad("allowances must be an object");
      const out: Partial<Record<OverridableTier, AllowanceOverrides>> = {};
      for (const [tier, fields] of Object.entries(value as Record<string, unknown>)) {
        if (!(OVERRIDABLE_TIERS as readonly string[]).includes(tier)) return bad(`allowances: unknown plan "${tier}"`);
        if (!fields || typeof fields !== "object") return bad(`allowances.${tier} must be an object`);
        const clean: AllowanceOverrides = {};
        for (const [f, n] of Object.entries(fields as Record<string, unknown>)) {
          if (!(ALLOWANCE_FIELDS as readonly string[]).includes(f)) return bad(`allowances.${tier}: unknown field "${f}"`);
          if (n === null || n === undefined) continue; // cleared: back to the fallback
          if (!isInt(n, 1, 100_000)) return bad(`allowances.${tier}.${f} must be a whole number from 1 to 100000`);
          clean[f as AllowanceField] = n;
        }
        out[tier as OverridableTier] = clean;
      }
      return { ok: true, value: out };
    }
    case "warn_percent":
      return isInt(value, 50, 99) ? { ok: true, value } : bad("warn percent must be a whole number from 50 to 99");
    case "notify": {
      const v = value as { warn?: unknown; exhausted?: unknown } | null;
      if (!v || typeof v.warn !== "boolean" || typeof v.exhausted !== "boolean") return bad("notify needs { warn: boolean, exhausted: boolean }");
      return { ok: true, value: { warn: v.warn, exhausted: v.exhausted } };
    }
    case "credit_cost": {
      const v = value as Record<string, unknown> | null;
      if (!v || !isInt(v.search, 1, 5) || !isInt(v.draft, 1, 5)) return bad("credit cost needs a whole number from 1 to 5 for search and draft");
      return { ok: true, value: { search: v.search, draft: v.draft } };
    }
    case "spend_headroom_usd": {
      const v = value as Record<string, unknown> | null;
      if (!v || !isNum(v.search, 0, 5) || !isNum(v.draft, 0, 5)) return bad("spend headroom needs a dollar amount from 0 to 5 for search and draft");
      return { ok: true, value: { search: v.search, draft: v.draft } };
    }
    case "default_expiry_months":
      return value === null || isInt(value, 1, 60) ? { ok: true, value } : bad("expiry must be 1 to 60 months, or empty for never");
  }
}

/** Build the effective config from stored rows: an invalid or missing row falls back to the default (never throws). */
export function configFromRows(rows: { key: string; value: unknown }[]): BillingConfig {
  const cfg: BillingConfig = JSON.parse(JSON.stringify(BILLING_CONFIG_DEFAULTS));
  for (const row of rows) {
    if (!(BILLING_CONFIG_KEYS as readonly string[]).includes(row.key)) continue;
    const key = row.key as BillingConfigKey;
    const checked = validateConfigValue(key, row.value);
    if (!checked.ok) continue;
    switch (key) {
      case "allowances": cfg.allowances = checked.value as BillingConfig["allowances"]; break;
      case "warn_percent": cfg.warnPercent = checked.value as number; break;
      case "notify": cfg.notify = checked.value as BillingConfig["notify"]; break;
      case "credit_cost": cfg.creditCost = checked.value as BillingConfig["creditCost"]; break;
      case "spend_headroom_usd": cfg.spendHeadroomUsd = checked.value as BillingConfig["spendHeadroomUsd"]; break;
      case "default_expiry_months": cfg.defaultExpiryMonths = checked.value as number | null; break;
    }
  }
  return cfg;
}

/** The allowance after the admin's overrides: only the six overridable fields change; maxCompanies stays as given. */
export function applyAllowanceOverrides(base: OutboundAllowance, o: AllowanceOverrides | undefined): OutboundAllowance {
  if (!o) return base;
  const next = { ...base };
  for (const f of ALLOWANCE_FIELDS) if (isInt(o[f], 1, 100_000)) next[f] = o[f]!;
  return next;
}

/** Used share of an allowance, 0–100 (a zero or unreadable limit reads as full, never as roomy). */
export const usedPercent = (used: number, limit: number): number =>
  !Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0 ? 100 : Math.min(100, Math.floor((100 * Math.max(0, used)) / limit));
