/**
 * Zee, "business briefing": what needs the person, from the records themselves.
 *
 * Every item comes from the app's own source of truth, through the services the dashboard uses:
 *   computeBriefing (server/copilot/insights.ts)   overdue invoices, due this week, ready to invoice, deal next steps
 *   listFollowUps   (server/services/leads.ts)     lead follow-ups overdue and due today, in the workspace's timezone
 *   listOutreachQueue (server/sales/outreach.ts)   drafts waiting for the person's approval
 * An invoice is "overdue" only when its due date has passed and it isn't paid (the radar's own rule). Nothing is
 * estimated. An empty day is reported as an empty day.
 *
 * The model may add a two-sentence summary ("Zee's take") written ONLY from the items above. It is checked: any
 * figure or currency amount it mentions must appear in the items, or it is dropped and the plain summary stands.
 */
import { formatMoney } from "@shared/money";
import { resolveLocaleSettings } from "@shared/schema";
import type { LeagueReport } from "@shared/ai-league";
import type { Briefing } from "../../copilot/insights";
import type { StepOutcome, TaskCtx, TaskHandler } from "./types";

type Result<T> = ({ ok: true } & T) | { ok: false; status: number; code: string; message: string };
interface FollowUp { id: number; title: string; due: string; leadId: number; companyName: string }
export interface ZeeDeps {
  briefing(user: unknown): Promise<Briefing>;
  followUps(user: unknown): Promise<Result<{ today: string; overdue: FollowUp[]; dueToday: FollowUp[] }>>;
  waitingDrafts(user: unknown): Promise<Result<{ items: { message: { id: number; status: string }; lead: { id: number; companyName: string } }[] }>>;
  locale(user: unknown): Promise<{ currency: string; locale: string }>;
  /** A short summary from the facts, or null (not configured, over budget, or failed: the plain summary stands). */
  summarize?(user: unknown, facts: string): Promise<{ text: string; tokensIn: number; tokensOut: number } | null>;
}

/** Numbers in a text (digits, with separators), for the summary check. */
const figures = (t: string) => (t.match(/\d[\d,.]*/g) ?? []).map((x) => x.replace(/[,.]+$/, "").replace(/,/g, ""));
/** True when every figure in `text` appears in `facts`, and it names no currency amount the facts don't. */
export function summaryIsGrounded(text: string, facts: string): boolean {
  const known = new Set(figures(facts));
  return figures(text).every((f) => known.has(f));
}

export function zeeTask(deps: ZeeDeps): TaskHandler {
  return {
    async step(ctx: TaskCtx): Promise<StepOutcome> {
      const [b, fu, q, loc] = await Promise.all([
        deps.briefing(ctx.user),
        deps.followUps(ctx.user),
        deps.waitingDrafts(ctx.user).catch(() => ({ ok: false as const, status: 503, code: "unavailable", message: "Outreach isn't set up" })),
        deps.locale(ctx.user),
      ]);
      await ctx.event("records_read", "Read your invoices, agreements, deals, follow-ups and outreach");
      const money = (m: number) => formatMoney(m, loc.currency, loc.locale);
      const items: LeagueReport["items"] = [];
      for (const i of b.radar.overdue.invoices) items.push({ title: `Overdue: ${i.invoiceNumber} · ${i.brandName}`, detail: `${money(i.amountMinor)}, ${i.daysOverdue} day${i.daysOverdue === 1 ? "" : "s"} past due`, href: `/brand-invoices/${i.id}`, status: "needs_you" });
      const fuOverdue = fu.ok ? fu.overdue : [], fuToday = fu.ok ? fu.dueToday : [];
      for (const f of [...fuOverdue, ...fuToday]) items.push({ title: `Follow up: ${f.companyName}`, detail: `${f.title} · due ${f.due}${f.due < (fu.ok ? fu.today : "") ? " (overdue)" : " (today)"}`, href: `/leads/${f.leadId}`, status: "needs_you" });
      const drafts = q.ok ? q.items.filter((x) => x.message.status === "draft" || x.message.status === "approved") : [];
      for (const d of drafts.slice(0, 5)) items.push({ title: `Message waiting for you: ${d.lead.companyName}`, detail: d.message.status === "approved" ? "Approved, not sent yet" : "Draft to review and approve", href: `/leads/${d.lead.id}`, status: "needs_you" });
      for (const i of b.radar.dueThisWeek.invoices) items.push({ title: `Due this week: ${i.invoiceNumber} · ${i.brandName}`, detail: `${money(i.amountMinor)}, due ${String(i.dueDate).slice(0, 10)}`, href: `/brand-invoices/${i.id}`, status: "info" });
      for (const c of b.radar.readyToInvoice.contracts) items.push({ title: `Ready to invoice: ${c.brandName}`, detail: `${money(c.remainingMinor)} of a signed agreement not invoiced yet`, href: `/deals/${c.dealId}`, status: "info" });
      for (const a of b.nextActions.filter((x) => x.urgency !== "green").slice(0, 5)) items.push({ title: `${a.brandName}: ${a.action}`, detail: a.dealTitle, href: a.route, status: a.urgency === "red" ? "needs_you" : "info" });

      const needs = items.filter((i) => i.status === "needs_you").length;
      const counts = [
        { label: "Overdue invoices", value: b.radar.overdue.count }, { label: "Follow-ups due", value: fuOverdue.length + fuToday.length },
        { label: "Messages waiting", value: drafts.length }, { label: "Due this week", value: b.radar.dueThisWeek.count }, { label: "Ready to invoice", value: b.radar.readyToInvoice.count },
      ];
      const plain = needs === 0 && items.length === 0
        ? "All clear: nothing is overdue, no follow-up is due and no message is waiting for you."
        : [b.radar.overdue.count ? `${b.radar.overdue.count} overdue invoice${b.radar.overdue.count === 1 ? "" : "s"} (${money(b.radar.overdue.totalMinor)})` : null,
          fuOverdue.length + fuToday.length ? `${fuOverdue.length + fuToday.length} follow-up${fuOverdue.length + fuToday.length === 1 ? "" : "s"} due` : null,
          drafts.length ? `${drafts.length} message${drafts.length === 1 ? "" : "s"} waiting for your approval` : null,
          b.radar.dueThisWeek.count ? `${b.radar.dueThisWeek.count} invoice${b.radar.dueThisWeek.count === 1 ? "" : "s"} due this week` : null,
          b.radar.readyToInvoice.count ? `${b.radar.readyToInvoice.count} agreement${b.radar.readyToInvoice.count === 1 ? "" : "s"} ready to invoice` : null,
        ].filter(Boolean).join(" · ");

      let summary: string | null = null;
      if (items.length && deps.summarize) {
        const facts = items.map((i) => `- ${i.title}${i.detail ? `: ${i.detail}` : ""}`).join("\n");
        const s = await deps.summarize(ctx.user, facts).catch(() => null);
        if (s) {
          ctx.addUsage(s.tokensIn, s.tokensOut);
          const text = s.text.replace(/\s+/g, " ").trim().slice(0, 400);
          if (text && summaryIsGrounded(text, facts)) summary = text;
          else await ctx.event("summary_dropped", "A written summary was left out because it mentioned something not in your records");
        }
      }
      const report: LeagueReport = {
        headline: items.length ? `${needs} thing${needs === 1 ? "" : "s"} need${needs === 1 ? "s" : ""} you today` : "All clear today",
        counts, items, summary: summary ?? plain,
        next: items[0]?.href ? { label: "Start with the first one", href: items[0].href } : null,
        notes: [...(fu.ok ? [] : ["Follow-ups couldn't be read this time."]), ...(q.ok ? [] : ["Outreach drafts couldn't be read this time."])],
      };
      return { kind: "finish", status: fu.ok && q.ok ? "completed" : "partial", report };
    },
  };
}

/** The workspace's money settings for the briefing (the org's currency, the reader's locale), as computeBriefing uses. */
export const localeOf = (org: Parameters<typeof resolveLocaleSettings>[0], user: Parameters<typeof resolveLocaleSettings>[1]) => {
  const s = resolveLocaleSettings(org, user);
  return { currency: s.currency, locale: s.locale };
};
