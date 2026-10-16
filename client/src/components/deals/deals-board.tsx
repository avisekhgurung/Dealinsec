/**
 * The Deals board: one column per deal status (Pending, Active, Completed),
 * each with its count, and a card per deal showing the client, the deal, its
 * value and where it is in its workflow.
 *
 * READ-ONLY on purpose. A deal's status is changed only by the flows that own
 * it on the server (creating the agreement makes it Active; "Mark as
 * completed" on the deal page makes it Completed), so there is no dragging
 * and nothing here writes. Every card is a plain link to the deal.
 *
 * On a phone the columns scroll sideways and snap; on a desktop they sit side
 * by side.
 */
import { Link } from "wouter";
import { groupDealsByStatus } from "@shared/deal-view";
import type { WorkflowPosition } from "@shared/deal-view";
import { recordNo, type Deal } from "@shared/schema";
import { StatusBadge } from "@/components/status-badge";
import { WorkflowChip } from "@/components/deals/workflow-chip";
import type { MoneyFormat } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

export function DealsBoard({
  deals,
  positions,
  fmt,
  filtered,
}: {
  deals: Deal[];
  /** Each deal's workflow position, or null when it isn't known (cards then show no position). */
  positions: Map<number, WorkflowPosition> | null;
  fmt: MoneyFormat;
  /** A search or date filter is narrowing the board: empty columns say so. */
  filtered: boolean;
}) {
  const columns = groupDealsByStatus(deals);
  return (
    <div
      className="relative -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 scroll-px-4 lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-5 lg:overflow-visible lg:px-0 lg:pb-0"
      data-testid="deals-board"
    >
      {columns.map((col) => {
        const headingId = `deals-board-${col.status.toLowerCase().replace(/\W+/g, "-")}`;
        const totalMinor = col.deals.reduce((s, d) => s + Number(d.dealAmountMinor || 0), 0);
        return (
          <section
            key={col.status}
            aria-labelledby={headingId}
            className="flex w-[85%] shrink-0 snap-start flex-col rounded-2xl border border-border/60 bg-muted/30 p-2.5 sm:w-[46%] lg:w-auto"
            data-testid={`board-column-${col.status.toLowerCase()}`}
          >
            <header className="flex items-center justify-between gap-2 px-1.5 pb-2.5 pt-1">
              <h2 id={headingId} className="sr-only">
                {col.status}: {col.deals.length} {col.deals.length === 1 ? "deal" : "deals"}
              </h2>
              <div className="flex items-center gap-2" aria-hidden="true">
                <StatusBadge status={col.status} size="compact" />
                <span className="text-xs font-semibold tabular-nums text-muted-foreground">{col.deals.length}</span>
              </div>
              {col.deals.length > 0 && (
                <span className="text-xs font-semibold tabular-nums text-muted-foreground">{fmt.money(totalMinor)}</span>
              )}
            </header>

            {col.deals.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-foreground">
                No {col.status.toLowerCase()} deals{filtered ? " match" : ""}
              </p>
            ) : (
              <ul role="list" className="flex flex-col gap-2">
                {col.deals.map((deal) => {
                  const pos = positions?.get(deal.id) ?? null;
                  return (
                    <li key={deal.id}>
                      <Link
                        href={`/deals/${deal.id}`}
                        aria-label={`Deal: ${deal.dealTitle}, ${deal.brandName}, ${fmt.money(deal.dealAmountMinor)}${pos ? `, ${pos.label}` : ""}`}
                        className={cn(
                          "block rounded-xl border border-border/60 bg-card p-3 shadow-sm outline-none transition-colors",
                          "hover:border-border hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-emerald-500/60",
                        )}
                        data-testid={`board-card-${deal.id}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="min-w-0 truncate text-sm font-semibold">{deal.brandName}</p>
                          <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">{recordNo("deal", deal.id)}</span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{deal.dealTitle}</p>
                        <div className="mt-2.5 flex items-center justify-between gap-2">
                          {pos ? <WorkflowChip position={pos} /> : <span />}
                          <span className="shrink-0 text-sm font-bold tabular-nums text-primary">{fmt.money(deal.dealAmountMinor)}</span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
