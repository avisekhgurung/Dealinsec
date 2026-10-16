/**
 * The dashboard's first block: what needs the person today, from their real records (shared/today-queue.ts decides
 * what goes in and in what order; this only loads the sources and draws the list).
 *
 * Honest by construction: a source that didn't load is named ("Some items couldn't be checked: …") with a way to try
 * again, and the panel says "All clear" only when every source the person can use was checked and nothing was found.
 * A module the person can't use, or one not set up on this server, is left out rather than reported as unknown.
 *
 * Shares query keys with the dashboard, the Get started checklist, the follow-ups panel and the outreach queue, so it
 * adds at most two requests of its own (follow-ups, outreach waiting list), and those are cached for those screens too.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  AlertCircle, AlertTriangle, ArrowRight, CalendarClock, CalendarDays, CheckCircle2, ChevronDown, Clock, FileSignature,
  FileText, Receipt, ReceiptText, RotateCw, Send, ShieldAlert, type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useAudience } from "@/hooks/use-audience";
import { useMoney } from "@/hooks/use-locale";
import { trackEvent } from "@/lib/analytics";
import { FOLLOWUPS_URL, OUTREACH_QUEUE_URL, type FollowUps } from "@/lib/leads";
import { fadeUp, stagger, staggerItem, useCalmMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { canSeeModule } from "@shared/permissions";
import { formatMoney } from "@shared/money";
import { httpErrorStatus } from "@shared/http-error-kind";
import { todayQueue, todaySummary, type TodayItem, type TodayKind, type TodayUrgency } from "@shared/today-queue";
import type { BrandInvoice, Contract, Deal, Quote } from "@shared/schema";

/** Only the fields of an outreach queue row this panel reads (client/src/components/outbound/outreach-queue.tsx owns the full shape). */
interface QueueRow {
  message: { id: number; status: string };
  lead: { id: number; companyName: string; doNotContact?: boolean };
  suppressed?: boolean;
}

/** The outreach queue's "Waiting for you" tab key: the same cache entry as that screen. */
const OUTREACH_WAITING_KEY = `${OUTREACH_QUEUE_URL}?status=waiting`;

/** No access, or the module isn't set up on this server: not the person's to check, so left out (not "unknown"). */
const unavailable = (err: unknown) => {
  if (!err) return false;
  const m = String((err as Error | null)?.message ?? "");
  return httpErrorStatus(err) === 403 || /[A-Z]+_NOT_SETUP/.test(m);
};

const KIND_ICON: Record<TodayKind, LucideIcon> = {
  overdue_invoices: Receipt,
  follow_ups: CalendarClock,
  awaiting_signature: FileSignature,
  ready_to_invoice: ReceiptText,
  due_soon_invoices: CalendarDays,
  approved_outreach: Send,
  quotes_awaiting: FileText,
  deal_terms: ShieldAlert,
};

/** Urgency is always words and an icon; colour only repeats it. */
const URGENCY: Record<TodayUrgency, { label: string; icon: LucideIcon; chip: string; tile: string }> = {
  now: {
    label: "Now", icon: AlertCircle,
    chip: "border-rose-300/70 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300",
    tile: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  },
  soon: {
    label: "Soon", icon: Clock,
    chip: "border-amber-300/70 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
    tile: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  next: {
    label: "Next", icon: ArrowRight,
    chip: "border-border bg-muted/60 text-muted-foreground",
    tile: "bg-muted text-muted-foreground",
  },
};

function TodayRow({ item, index, calm }: { item: TodayItem; index: number; calm: boolean }) {
  const Icon = KIND_ICON[item.kind];
  const u = URGENCY[item.urgency];
  const UrgencyIcon = u.icon;
  return (
    <motion.li variants={calm ? undefined : staggerItem(index)} data-testid={`today-item-${item.kind}`}>
      <Link
        href={item.href}
        onClick={() => trackEvent("today_item_clicked", { kind: item.kind, urgency: item.urgency })}
        className="group flex items-start gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
      >
        <span className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", u.tile)} aria-hidden>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-bold uppercase tracking-wider", u.chip)}>
              <UrgencyIcon className="h-3 w-3" aria-hidden />
              {u.label}
              <span className="sr-only">:</span>
            </span>
            <span className="text-sm font-semibold leading-snug text-foreground">{item.title}</span>
          </span>
          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground lg:text-[13px]">{item.detail}</span>
          <span className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 group-hover:underline dark:text-emerald-400 sm:hidden">
            {item.action} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </span>
        </span>
        <span className="hidden shrink-0 items-center gap-1 self-center text-xs font-semibold text-emerald-700 group-hover:underline dark:text-emerald-400 sm:inline-flex">
          {item.action} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </span>
      </Link>
    </motion.li>
  );
}

function TodaySkeleton() {
  return (
    <Card className="glass-card" data-testid="today-loading" aria-busy="true" aria-label="Loading what needs you today">
      <CardContent className="p-4 lg:p-5">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="mt-2 h-3.5 w-36" />
        <div className="mt-3 space-y-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-start gap-3 px-3 py-3">
              <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * @param hideWhenEmpty For a brand-new account: show the panel only when something real needs them, never a
 *   skeleton or an "All clear" they have done nothing to earn.
 */
export function TodayPanel({ hideWhenEmpty = false }: { hideWhenEmpty?: boolean }) {
  const { user } = useAuth();
  const audience = useAudience();
  const fmt = useMoney();
  const calm = useCalmMotion();
  const [expanded, setExpanded] = useState(false);

  const seeDeals = canSeeModule(user as any, "deals");
  const invoices = useQuery<BrandInvoice[]>({ queryKey: ["/api/brand-invoices"] });
  const contracts = useQuery<Contract[]>({ queryKey: ["/api/contracts"] });
  const quotes = useQuery<(Quote & { deal: Deal | null })[]>({ queryKey: ["/api/quotes"] });
  const followUps = useQuery<FollowUps>({ queryKey: [FOLLOWUPS_URL], enabled: seeDeals });
  const outreach = useQuery<{ items: QueueRow[] }>({ queryKey: [OUTREACH_WAITING_KEY], enabled: seeDeals, retry: false });
  // Protection Check over pending deals: the rule-based briefing (same cache as the agent's briefing).
  const briefing = useQuery<{ protection?: { withIssues: number; important: number } }>({ queryKey: ["/api/copilot/briefing"], enabled: seeDeals, staleTime: 60_000 });

  const sources = [invoices, contracts, quotes, followUps, outreach, briefing];
  if (!user) return null;
  if (sources.some((q) => q.isLoading)) return hideWhenEmpty ? null : <TodaySkeleton />;

  const can = {
    invoices: canSeeModule(user as any, "invoices") && !unavailable(invoices.error),
    agreements: canSeeModule(user as any, "agreements") && !unavailable(contracts.error),
    leads: seeDeals && !unavailable(followUps.error),
    outbound: seeDeals && !unavailable(outreach.error),
    quotations: canSeeModule(user as any, "quotations") && !unavailable(quotes.error),
    deals: seeDeals && !unavailable(briefing.error),
  };
  const ok = <T,>(q: { isError: boolean; data?: T }) => (q.isError || q.data == null ? null : q.data);
  const inv = ok(invoices), con = ok(contracts), quo = ok(quotes), fu = ok(followUps), out = ok(outreach);

  const queue = todayQueue(
    {
      invoices: inv && inv.map((i) => ({
        id: i.id, invoiceNumber: i.invoiceNumber, brandName: i.brandName, status: i.status, dueDate: i.dueDate,
        amountMinor: Number(i.dealAmountMinor || 0), currency: i.currency, dealId: i.dealId, contractId: i.contractId,
      })),
      agreements: con && con.map((c) => ({
        id: c.id, dealId: c.dealId, contractName: c.contractName, brandName: c.brandName, status: c.status,
        signedByBrand: c.signedByBrand, clientSignedAt: c.clientSignedAt, clientSharedAt: c.clientSharedAt,
        valueMinor: Number(c.contractValueMinor || 0), currency: c.currency,
      })),
      followUps: fu && { today: fu.today, overdue: fu.overdue, dueToday: fu.dueToday },
      outreach: out && out.items.map((r) => ({
        id: r.message.id, status: r.message.status, leadId: r.lead.id, companyName: r.lead.companyName,
        blocked: !!r.suppressed || !!r.lead.doNotContact,
      })),
      protection: briefing.isError || !briefing.data ? null : (briefing.data.protection ?? { withIssues: 0, important: 0 }),
      quotations: quo && quo.map((q) => ({
        id: q.id, dealId: q.dealId, brandName: q.deal?.brandName ?? "Your client", createdAt: q.createdAt,
        shareToken: q.shareToken, sharedAt: q.sharedAt, shareRevokedAt: q.shareRevokedAt, acceptedAt: q.acceptedAt,
        dealStatus: q.deal?.status ?? null,
      })),
    },
    new Date(),
    can,
    {
      // A record keeps the currency it was issued in; the org's own currency uses the app's formatter.
      money: (minor, currency) => (currency && currency !== fmt.currency ? formatMoney(minor, currency, fmt.locale) : fmt.money(minor)),
      party: audience.party,
    },
  );

  const total = queue.items.length + queue.overflow.length;
  // Nothing the person can use was checked at all: no verdict to give.
  if (!total && !queue.allClear && !queue.unknown.length) return null;
  if (hideWhenEmpty && !total) return null;

  const shown = expanded ? [...queue.items, ...queue.overflow] : queue.items;
  const failed = sources.filter((q) => q.isError && !unavailable(q.error));
  const retrying = failed.some((q) => q.isFetching);
  const retry = () => failed.forEach((q) => void q.refetch());

  return (
    <Card className="glass-card" data-testid="today-panel">
      <CardContent className="p-4 lg:p-5">
        <section aria-labelledby="today-title">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 id="today-title" className="text-base font-bold tracking-tight lg:text-lg">Today</h2>
              {queue.allClear ? (
                <motion.p
                  className="mt-1 flex items-center gap-2 text-sm text-muted-foreground"
                  variants={fadeUp}
                  initial={calm ? false : "hidden"}
                  animate="visible"
                  data-testid="today-all-clear"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" aria-hidden />
                  </span>
                  {todaySummary(queue)}
                </motion.p>
              ) : total > 0 ? (
                <p className="mt-0.5 text-sm text-muted-foreground" data-testid="today-summary">{todaySummary(queue)}</p>
              ) : null}
            </div>
          </div>

          {queue.unknown.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-300/60 bg-amber-50/70 px-3 py-2 text-sm dark:border-amber-900/50 dark:bg-amber-950/20" role="status" data-testid="today-unknown">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              <p className="min-w-0 flex-1 text-foreground">
                Some items couldn't be checked: {queue.unknown.join(", ")}.
              </p>
              <Button size="sm" variant="outline" className="h-8" onClick={retry} disabled={retrying} data-testid="today-retry">
                <RotateCw className={cn("mr-1.5 h-3.5 w-3.5", retrying && "animate-spin")} aria-hidden />Try again
              </Button>
            </div>
          )}

          {shown.length > 0 && (
            <motion.ul
              className="-mx-3 mt-2 divide-y divide-border/50"
              variants={stagger}
              initial={calm ? false : "hidden"}
              animate="visible"
            >
              {shown.map((item, i) => <TodayRow key={item.id} item={item} index={i} calm={calm} />)}
            </motion.ul>
          )}

          {queue.overflow.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="mt-1 inline-flex items-center gap-1 rounded-md px-1 py-1 text-xs font-semibold text-emerald-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-emerald-400"
              data-testid="today-more"
            >
              {expanded ? "Show fewer" : `Show ${queue.overflow.length} more`}
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} aria-hidden />
            </button>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
