/**
 * Quotations register — every quotation the organization has issued.
 *
 * Quotations were previously reachable only from inside a deal; this makes
 * them a first-class record like Deals / Agreements / Invoices, with the
 * summary-then-detail shape B2B users expect from a register.
 */
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { BottomNav } from "@/components/bottom-nav";
import { NotificationBell } from "@/components/notification-bell";
import { recordNo } from "@shared/schema";
import { DateRangeFilter, ALL_TIME, inRange, type DateRange } from "@/components/date-range-filter";
import { PickParentDialog } from "@/components/pick-parent-dialog";
import { memberCan } from "@shared/permissions";
import { useAuth } from "@/hooks/useAuth";
import { dealTypeMeta } from "@shared/dealTypeTaxonomy";
import type { Quote, Deal } from "@shared/schema";
import { FileText, Search, X, ChevronRight, Plus } from "lucide-react";

type QuoteRow = Quote & { deal: Deal | null };

const fmtDate = (s?: string | Date | null) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

export default function QuotationsPage() {
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>(ALL_TIME);
  const [pickOpen, setPickOpen] = useState(false);
  const { user } = useAuth();
  const canCreate = memberCan(user as any, "quotations.create");
  const { data: quotes = [], isLoading } = useQuery<QuoteRow[]>({ queryKey: ["/api/quotes"] });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return quotes.filter((r) => {
      if (!inRange(r.createdAt, dateRange)) return false;
      if (!q) return true;
      return (
        (r.deal?.brandName || "").toLowerCase().includes(q) ||
        (r.deal?.dealTitle || "").toLowerCase().includes(q) ||
        String(r.id).includes(q)
      );
    });
  }, [quotes, search, dateRange]);

  return (
    <div className="min-h-screen bg-background pb-20 lg:pb-12">
      <header className="glass-header sticky top-0 z-40 lg:border-b lg:border-neutral-200/60 dark:lg:border-neutral-800/60">
        <div className="px-4 py-4 lg:max-w-[1600px] lg:mx-auto lg:px-8 lg:py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-xl lg:text-2xl font-bold tracking-tight">Quotations</h1>
              <p className="hidden lg:block text-sm text-muted-foreground mt-0.5">
                {quotes.length} {quotes.length === 1 ? "quotation" : "quotations"} issued by your team
              </p>
            </div>
            <div className="flex items-center gap-2">
              <NotificationBell className="lg:hidden" />
              {canCreate && (
              <Button size="sm" className="gradient-btn text-white" onClick={() => setPickOpen(true)} data-testid="button-new-quotation">
                <Plus className="w-4 h-4 mr-1 lg:mr-1.5" />
                New<span className="hidden lg:inline">&nbsp;quotation</span>
              </Button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="px-4 py-5 space-y-4 animate-fade-in lg:max-w-[1600px] lg:mx-auto lg:px-8 lg:py-6 lg:space-y-5">
        {/* Analytics for quotations live on the Dashboard — this page is the register. */}

        {/* Search — capped on desktop; a full-bleed 1500px input reads as a
            layout bug, not a search box */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3 mb-4">
        <div className="relative flex-1 lg:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by client, deal or quotation number…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-9"
            data-testid="input-search-quotations"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex justify-end sm:justify-start shrink-0">
          <DateRangeFilter value={dateRange} onChange={setDateRange} />
        </div>
        </div>

        {/* Register */}
        <Card className="glass-card overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
              </div>
            ) : rows.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <div className="w-12 h-12 mx-auto rounded-2xl bg-muted flex items-center justify-center mb-3">
                  <FileText className="w-6 h-6 text-muted-foreground" />
                </div>
                <p className="font-semibold">
                  {search ? "No quotations match that search" : "No quotations yet"}
                </p>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                  {search
                    ? "Try a different client or deal name."
                    : "Open a deal and generate its quotation — it'll appear here for the whole team."}
                </p>
                {!search && canCreate && (
                  <Button size="sm" className="mt-4 gradient-btn text-white" onClick={() => setPickOpen(true)}>
                    Create a quotation
                  </Button>
                )}
              </div>
            ) : (
              <>
                {/* Desktop column headers */}
                <div className="hidden lg:grid grid-cols-[0.8fr_1.3fr_1.5fr_0.9fr_0.6fr_0.9fr_auto] gap-4 px-5 py-2.5 border-b border-border/60 bg-muted/30">
                  {["Quotation No.", "Client", "Deal", "Value", "Version", "Issued", ""].map((h, i) => (
                    <span key={i} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {h}
                    </span>
                  ))}
                </div>
                <div className="divide-y divide-border/50">
                  {rows.map((r) => (
                    <Link key={r.id} href={r.deal ? `/deals/${r.deal.id}/quote` : "/deals"} className="block">
                      <button
                        className="w-full text-left px-4 lg:px-5 py-3.5 hover:bg-muted/40 transition-colors lg:grid lg:grid-cols-[0.8fr_1.3fr_1.5fr_0.9fr_0.6fr_0.9fr_auto] lg:gap-4 lg:items-center"
                        data-testid={`quotation-row-${r.id}`}
                      >
                        {/* Quotation number — the permanent identity of this
                            record, the one to quote on a call. */}
                        <span className="block font-mono text-[11px] text-muted-foreground tabular-nums mb-0.5 lg:mb-0">
                          {recordNo("quotation", r.id)}
                        </span>
                        {/* Client */}
                        <span className="block font-semibold text-sm truncate">
                          {r.deal?.brandName || "—"}
                        </span>
                        {/* Deal (+ type chip) */}
                        <span className="lg:flex lg:items-center lg:gap-2 min-w-0">
                          <span className="block text-sm text-muted-foreground truncate">
                            {r.deal?.dealTitle || "Deal removed"}
                          </span>
                          {r.deal?.dealType && (
                            <span className="hidden lg:inline text-[11px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 whitespace-nowrap">
                              {(dealTypeMeta as any)[r.deal.dealType]?.emoji ?? "·"} {r.deal.dealType}
                            </span>
                          )}
                        </span>
                        {/* Value */}
                        <span className="block text-sm font-semibold text-primary tabular-nums mt-1 lg:mt-0">
                          ₹{Number(r.deal?.dealAmount || 0).toLocaleString("en-IN")}
                        </span>
                        {/* Version */}
                        <span className="hidden lg:block">
                          <Badge variant="secondary" className="text-[11px] font-medium">v{r.version}</Badge>
                        </span>
                        {/* Issued */}
                        <span className="block text-xs text-muted-foreground mt-1 lg:mt-0 whitespace-nowrap">
                          {fmtDate(r.createdAt)}
                        </span>
                        <ChevronRight className="hidden lg:block w-4 h-4 text-muted-foreground" />
                      </button>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </main>

      <PickParentDialog kind="quotation" open={pickOpen} onOpenChange={setPickOpen} />
      <BottomNav />
    </div>
  );
}
