/** Helpers the tool files share. Imports the database; never imported by tests. */
import { formatMoney } from "@shared/money";
import type { Deal, LocaleSettings } from "@shared/schema";
import { appUrl } from "../../emails";
import { storage } from "../../storage";
import { inOrg } from "../../copilot/tools";
import { copilotSettings } from "../../copilot/workflow";
import type { ToolContext, ToolOutcome } from "../types";

export { inOrg };

/** The turn's locale, read once per tool context. */
const settingsCache = new WeakMap<object, Promise<LocaleSettings>>();
export const settingsFor = (ctx: ToolContext): Promise<LocaleSettings> => {
  let p = settingsCache.get(ctx);
  if (!p) { p = copilotSettings(ctx.user as any); settingsCache.set(ctx, p); }
  return p;
};

/** A deal in the caller's organization, or null (a foreign id looks like an unknown one). */
export async function dealFor(ctx: ToolContext, dealId: number): Promise<Deal | null> {
  const deal = await storage.getDeal(dealId);
  return deal && inOrg(deal, ctx.user as any) ? deal : null;
}

export const money = (minor: number, s: LocaleSettings, currency?: string | null) =>
  formatMoney(minor, (currency as any) || s.currency, s.locale);

export const fail = (code: string, message: string, route?: string): Extract<ToolOutcome, { ok: false }> => ({ ok: false, code, message, route });

export const absoluteUrl = (path: string) => `${appUrl()}${path}`;

export const dateLabel = (d: string | Date | null | undefined) => {
  if (!d) return null;
  const t = new Date(d as any);
  return Number.isFinite(t.getTime()) ? t.toISOString().slice(0, 10) : null;
};
