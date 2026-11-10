/**
 * Zee, "business briefing": what needs the person, from the records themselves.
 *
 * Every item comes from the app's own source of truth, through the services the dashboard uses:
 *   computeBriefing (server/copilot/insights.ts)   overdue invoices, due this week, ready to invoice, deal next steps
 *   listFollowUps   (server/services/leads.ts)     lead follow-ups overdue and due today, in the workspace's timezone
 *   listOutreachQueue (server/sales/outreach.ts)   drafts waiting for the person's approval
 *   listCampaigns   (server/campaigns/service.ts)  campaigns: drafts to read, a queue that paused itself, what came back
 *   listInbox       (server/mail/inbox.ts)         HOW MANY replies wait to be read or read as interested — counts only,
 *                                                  never a subject, a sender or a word of an email
 * An invoice is "overdue" only when its due date has passed and it isn't paid (the radar's own rule). Nothing is
 * estimated. An empty day is reported as an empty day.
 *
 * While DEAL_SUITE_HIDDEN (shared/flags.ts) is on, the money half of the briefing — overdue invoices, invoices due
 * this week, agreements ready to invoice and deal next steps — is not read at all. Those four can only ever be
 * empty with the suite hidden, so reading them costs four database round-trips to report nothing, and any item
 * they produced would link to a page the product no longer shows. Follow-ups and outreach drafts are unaffected:
 * they are the find-clients half, and they are what Zee is for now. Flip the flag back and the money half returns
 * with it, unchanged.
 *
 * The model may add a two-sentence summary ("Zee's take") written ONLY from the items above. It is checked: any
 * figure or currency amount it mentions must appear in the items, or it is dropped and the plain summary stands.
 */
import { formatMoney } from "@shared/money";
import { resolveLocaleSettings } from "@shared/schema";
import type { LeagueReport } from "@shared/ai-league";
import { DEAL_SUITE_HIDDEN } from "@shared/flags";
import type { Briefing } from "../../copilot/insights";
import type { StepOutcome, TaskCtx, TaskHandler } from "./types";

type Result<T> = ({ ok: true } & T) | { ok: false; status: number; code: string; message: string };
interface FollowUp { id: number; title: string; due: string; leadId: number; companyName: string }
export interface ZeeDeps {
  briefing(user: unknown): Promise<Briefing>;
  followUps(user: unknown): Promise<Result<{ today: string; overdue: FollowUp[]; dueToday: FollowUp[] }>>;
  waitingDrafts(user: unknown): Promise<Result<{ items: { message: { id: number; status: string }; lead: { id: number; companyName: string } }[] }>>;
  locale(user: unknown): Promise<{ currency: string; locale: string }>;
  /** The workspace's outreach campaigns with their numbers (server/campaigns/service.ts). Optional: without it the briefing is what it was. */
  campaigns?(user: unknown): Promise<Result<{ campaigns: ZeeCampaign[] }>>;
  /**
   * How many conversations stand where, counted from the reply labels the fixed rules gave (server/mail/reply-rules.ts).
   * COUNTS ONLY: no subject, sender or word of any email reaches this task, so none can reach a model through it.
   */
  replies?(user: unknown): Promise<Result<{ counts: { needs_review?: number; interested?: number } }>>;
  /** A short summary from the facts, or null (not configured, over budget, or failed: the plain summary stands). */
  summarize?(user: unknown, facts: string): Promise<{ text: string; tokensIn: number; tokensOut: number } | null>;
}

export interface ZeeCampaign {
  id: number; name: string; status: string; preparing: boolean; prepareStop: string | null; prepareStopLabel: string | null; sending: boolean; sendStop: string | null; sendStopLabel: string | null;
  counts: { queued: number; draft: number; approved: number; sent: number; replied: number; bounced: number };
  rates: { reply: number | null; bounce: number | null };
}
const campaignHref = (id: number) => `/outbound?view=campaigns&campaign=${id}`;
const INBOX = "/outbound?view=inbox";
const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * What a campaign needs from the person, and how it is doing, as briefing items. Only what the rows say:
 *   needs you   sending paused by something a person must fix; drafting stopped with leads still waiting; drafts to read
 *   info        what was sent and what came back, once anything was sent
 * A campaign the person paused or stopped themselves is their decision, not a problem to report.
 */
export function campaignItems(cs: ZeeCampaign[]): LeagueReport["items"] {
  const items: LeagueReport["items"] = [];
  const active = cs.filter((c) => c.status === "active");
  for (const c of active) if (!c.sending && c.sendStop && !["paused", "done"].includes(c.sendStop)) items.push({ title: `Campaign "${c.name}": sending paused`, detail: c.sendStopLabel ?? "It needs a look", href: campaignHref(c.id), status: "needs_you" });
  for (const c of active) if (!c.preparing && c.prepareStop && c.prepareStop !== "stopped" && c.counts.queued > 0) items.push({ title: `Campaign "${c.name}": drafting stopped`, detail: `${c.prepareStopLabel ?? "It needs a look"} · ${n(c.counts.queued, "lead")} still waiting`, href: campaignHref(c.id), status: "needs_you" });
  for (const c of active) if (c.counts.draft > 0) items.push({ title: `Campaign "${c.name}": ${n(c.counts.draft, "draft")} to review`, detail: "Read each one and approve it; nothing is sent until you do", href: campaignHref(c.id), status: "needs_you" });
  for (const c of active) if (c.counts.sent > 0) {
    const back = [`${c.counts.sent} sent`, `${n(c.counts.replied, "reply", "replies")}${c.rates.reply !== null ? ` (${c.rates.reply}%)` : ""}`, c.counts.bounced ? `${c.counts.bounced} bounced` : null, c.counts.approved ? `${c.counts.approved} approved, not sent` : null].filter(Boolean).join(" · ");
    items.push({ title: `Campaign "${c.name}"`, detail: back, href: campaignHref(c.id), status: "info" });
  }
  return items;
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
      const suiteVisible: boolean = !DEAL_SUITE_HIDDEN;
      const off = { ok: false as const, status: 503, code: "unavailable", message: "Not set up" };
      const [b, fu, q, loc, camp, rep] = await Promise.all([
        suiteVisible ? deps.briefing(ctx.user) : Promise.resolve(null),
        deps.followUps(ctx.user),
        deps.waitingDrafts(ctx.user).catch(() => ({ ok: false as const, status: 503, code: "unavailable", message: "Outreach isn't set up" })),
        deps.locale(ctx.user),
        // Campaigns and the inbox are extras: a server without them, or a failure reading them, never fails the briefing.
        deps.campaigns ? deps.campaigns(ctx.user).catch(() => off) : Promise.resolve(null),
        deps.replies ? deps.replies(ctx.user).catch(() => off) : Promise.resolve(null),
      ]);
      await ctx.event("records_read", b ? "Read your invoices, agreements, deals, follow-ups and outreach" : "Read your follow-ups and outreach");
      const money = (m: number) => formatMoney(m, loc.currency, loc.locale);
      const items: LeagueReport["items"] = [];
      if (b) for (const i of b.radar.overdue.invoices) items.push({ title: `Overdue: ${i.invoiceNumber} · ${i.brandName}`, detail: `${money(i.amountMinor)}, ${i.daysOverdue} day${i.daysOverdue === 1 ? "" : "s"} past due`, href: `/brand-invoices/${i.id}`, status: "needs_you" });
      // A reply is a person waiting: it goes before everything except money that is already late.
      const toReview = rep?.ok ? Number(rep.counts.needs_review ?? 0) : 0, interested = rep?.ok ? Number(rep.counts.interested ?? 0) : 0;
      if (toReview > 0) items.push({ title: `${n(toReview, "reply", "replies")} to read`, detail: "The rules couldn't tell what they mean. Read each one and say what it is", href: INBOX, status: "needs_you" });
      if (interested > 0) items.push({ title: `${n(interested, "conversation")} read as interested`, detail: "Answer these first", href: INBOX, status: "needs_you" });
      const fuOverdue = fu.ok ? fu.overdue : [], fuToday = fu.ok ? fu.dueToday : [];
      for (const f of [...fuOverdue, ...fuToday]) items.push({ title: `Follow up: ${f.companyName}`, detail: `${f.title} · due ${f.due}${f.due < (fu.ok ? fu.today : "") ? " (overdue)" : " (today)"}`, href: `/leads/${f.leadId}`, status: "needs_you" });
      const drafts = q.ok ? q.items.filter((x) => x.message.status === "draft" || x.message.status === "approved") : [];
      for (const d of drafts.slice(0, 5)) items.push({ title: `Message waiting for you: ${d.lead.companyName}`, detail: d.message.status === "approved" ? "Approved, not sent yet" : "Draft to review and approve", href: `/leads/${d.lead.id}`, status: "needs_you" });
      const campaigns = camp?.ok ? camp.campaigns : [];
      const campaignDrafts = campaigns.filter((c) => c.status === "active").reduce((sum, c) => sum + c.counts.draft, 0);
      items.push(...campaignItems(campaigns));
      if (b) for (const i of b.radar.dueThisWeek.invoices) items.push({ title: `Due this week: ${i.invoiceNumber} · ${i.brandName}`, detail: `${money(i.amountMinor)}, due ${String(i.dueDate).slice(0, 10)}`, href: `/brand-invoices/${i.id}`, status: "info" });
      if (b) for (const c of b.radar.readyToInvoice.contracts) items.push({ title: `Ready to invoice: ${c.brandName}`, detail: `${money(c.remainingMinor)} of a signed agreement not invoiced yet`, href: `/deals/${c.dealId}`, status: "info" });
      if (b) for (const a of b.nextActions.filter((x) => x.urgency !== "green").slice(0, 5)) items.push({ title: `${a.brandName}: ${a.action}`, detail: a.dealTitle, href: a.route, status: a.urgency === "red" ? "needs_you" : "info" });

      const needs = items.filter((i) => i.status === "needs_you").length;
      const counts = [
        ...(b ? [{ label: "Overdue invoices", value: b.radar.overdue.count }] : []),
        { label: "Follow-ups due", value: fuOverdue.length + fuToday.length },
        { label: "Messages waiting", value: drafts.length },
        ...(rep?.ok ? [{ label: "Replies to read", value: toReview }] : []),
        ...(camp?.ok && campaigns.length ? [{ label: "Campaign drafts to review", value: campaignDrafts }] : []),
        ...(b ? [{ label: "Due this week", value: b.radar.dueThisWeek.count }, { label: "Ready to invoice", value: b.radar.readyToInvoice.count }] : []),
      ];
      const plain = needs === 0 && items.length === 0
        ? b
          ? "All clear: nothing is overdue, no follow-up is due and no message is waiting for you."
          : "All clear: no follow-up is due and no message is waiting for you."
        : [b && b.radar.overdue.count ? `${b.radar.overdue.count} overdue invoice${b.radar.overdue.count === 1 ? "" : "s"} (${money(b.radar.overdue.totalMinor)})` : null,
          fuOverdue.length + fuToday.length ? `${fuOverdue.length + fuToday.length} follow-up${fuOverdue.length + fuToday.length === 1 ? "" : "s"} due` : null,
          toReview ? `${n(toReview, "reply", "replies")} to read` : null,
          interested ? `${n(interested, "conversation")} read as interested` : null,
          drafts.length ? `${drafts.length} message${drafts.length === 1 ? "" : "s"} waiting for your approval` : null,
          campaigns.some((c) => c.status === "active" && !c.sending && c.sendStop && !["paused", "done"].includes(c.sendStop)) ? "a campaign's sending is paused" : null,
          b && b.radar.dueThisWeek.count ? `${b.radar.dueThisWeek.count} invoice${b.radar.dueThisWeek.count === 1 ? "" : "s"} due this week` : null,
          b && b.radar.readyToInvoice.count ? `${b.radar.readyToInvoice.count} agreement${b.radar.readyToInvoice.count === 1 ? "" : "s"} ready to invoice` : null,
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
