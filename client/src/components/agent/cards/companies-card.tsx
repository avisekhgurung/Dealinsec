/**
 * Companies a search turned up. These are guesses from the open web, so each row
 * is labelled as one and nothing is added until the person presses Add (their own
 * click is the approval). Links open the company's site in a new tab.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Check, ExternalLink, Plus, Search } from "lucide-react";
import type { AgentCard } from "@shared/agent";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { trackEvent } from "@/lib/analytics";
import { leadCall, leadError, refreshLeads } from "@/lib/leads";
import { memberCan } from "@shared/permissions";
import { CardShell } from "./card-shell";

interface Item { name: string; domain: string; website: string; alreadyLead: number | null }

export function CompaniesCard({ card }: { card: AgentCard }) {
  const d = card.data as { query?: string; companies?: Item[]; remainingToday?: number };
  const items = Array.isArray(d.companies) ? d.companies : [];
  const { user } = useAuth();
  const { toast } = useToast();
  const canAdd = memberCan(user as any, "deals.create");
  const [added, setAdded] = useState<Record<string, number>>({});
  const add = useMutation({
    mutationFn: (c: Item) => leadCall<{ lead: { id: number } }>("POST", "/api/leads", { companyName: c.name, website: c.website }),
    onSuccess: (r, c) => { setAdded((p) => ({ ...p, [c.domain]: r.lead.id })); trackEvent("lead_created", { source: "discovery" }); refreshLeads(); toast({ title: "Lead added" }); },
    onError: (e) => toast({ title: "Couldn't add it", description: leadError(e), variant: "destructive" }),
  });
  if (!items.length) return null;

  return (
    <CardShell label="Companies found" icon={<Search className="h-3 w-3" />} testId="companies-card">
      <p className="border-b border-border/60 px-3.5 py-2 text-xs text-muted-foreground">
        For “{d.query}”. Names are guesses from page titles: check each site before adding.
      </p>
      <ul className="divide-y divide-border/60">
        {items.map((c) => {
          const leadId = c.alreadyLead ?? added[c.domain] ?? null;
          return (
            <li key={c.domain} className="flex items-center gap-2 px-3.5 py-2.5" data-testid={`company-${c.domain}`}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{c.name}</span>
                <a href={c.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-full items-center gap-1 text-xs text-primary hover:underline">
                  <span className="truncate">{c.domain}</span><ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              </span>
              {leadId ? (
                <Link href={`/leads/${leadId}`} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400"><Check className="h-3.5 w-3.5" />{c.alreadyLead ? "Already a lead" : "Added"}</Link>
              ) : canAdd ? (
                <Button size="sm" variant="outline" className="h-8 shrink-0" disabled={add.isPending} onClick={() => add.mutate(c)} aria-label={`Add ${c.name} as a lead`} data-testid={`add-company-${c.domain}`}>
                  <Plus className="mr-1 h-3.5 w-3.5" />Add
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="border-t border-border/60 px-3.5 py-1.5 text-[10px] text-muted-foreground">Search by Brave</p>
    </CardShell>
  );
}
