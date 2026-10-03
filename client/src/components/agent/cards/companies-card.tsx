/**
 * Businesses a search turned up. A web index is not a company directory, so each
 * row says what it is:
 *   - a business's own website (link to its home page), or
 *   - a business found on SOMEONE ELSE's page (a directory or profile): the link goes
 *     to that page and its website is marked as not found yet.
 * Names are read from search results and may be wrong, so nothing is added until
 * the person presses Add (their own click is the approval), and where it was found
 * is saved on the lead as a note.
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

interface Item { name: string; kind: "site" | "listing"; domain: string | null; website: string | null; sourceUrl: string; sourceHost: string; alreadyLead: number | null }
const safeHref = (u: string | null) => (u && /^https?:\/\//i.test(u) ? u : undefined);
const keyOf = (c: Item) => `${c.name}|${c.sourceUrl}`;

export function CompaniesCard({ card }: { card: AgentCard }) {
  const d = card.data as { query?: string; companies?: Item[]; remainingToday?: number; provider?: string; reviewed?: boolean };
  const items = Array.isArray(d.companies) ? d.companies : [];
  const { user } = useAuth();
  const { toast } = useToast();
  const canAdd = memberCan(user as any, "deals.create");
  const [added, setAdded] = useState<Record<string, number>>({});
  const add = useMutation({
    mutationFn: async (c: Item) => {
      const r = await leadCall<{ lead: { id: number } }>("POST", "/api/leads", { companyName: c.name, ...(c.website ? { website: c.website } : {}) });
      // Where it was found, kept with the lead. Best effort: the lead is already saved.
      leadCall("POST", `/api/leads/${r.lead.id}/notes`, { text: `Found by company search on ${c.sourceHost}: ${c.sourceUrl}`.slice(0, 1000) }).catch(() => {});
      return r;
    },
    onSuccess: (r, c) => { setAdded((p) => ({ ...p, [keyOf(c)]: r.lead.id })); trackEvent("lead_created", { source: "discovery", kind: c.kind }); refreshLeads(); toast({ title: "Lead added" }); },
    onError: (e) => toast({ title: "Couldn't add it", description: leadError(e), variant: "destructive" }),
  });
  if (!items.length) return null;

  return (
    <CardShell label="Businesses found" icon={<Search className="h-3 w-3" />} testId="companies-card">
      <p className="border-b border-border/60 px-3.5 py-2 text-xs text-muted-foreground">
        For “{d.query}”. Names come from search results and may be wrong: check each before adding.
        {d.reviewed === false && " These results couldn't be reviewed automatically, so expect some that aren't businesses."}
      </p>
      <ul className="divide-y divide-border/60">
        {items.map((c) => {
          const leadId = c.alreadyLead ?? added[keyOf(c)] ?? null;
          const href = c.kind === "site" ? safeHref(c.website) : safeHref(c.sourceUrl);
          return (
            <li key={keyOf(c)} className="flex items-center gap-2 px-3.5 py-2.5" data-testid={`company-${c.kind}-${(c.domain ?? c.sourceHost)}`}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{c.name}</span>
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-full items-center gap-1 text-xs text-primary hover:underline">
                    <span className="truncate">{c.kind === "site" ? c.domain : `Found on ${c.sourceHost}`}</span><ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                ) : null}
                {c.kind === "listing" && <span className="block text-[11px] text-muted-foreground">Website not found yet</span>}
              </span>
              {leadId ? (
                <Link href={`/leads/${leadId}`} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400"><Check className="h-3.5 w-3.5" />{c.alreadyLead ? "Already a lead" : "Added"}</Link>
              ) : canAdd ? (
                <Button size="sm" variant="outline" className="h-8 shrink-0" disabled={add.isPending} onClick={() => add.mutate(c)} aria-label={`Add ${c.name} as a lead`} data-testid={`add-company-${c.kind}-${(c.domain ?? c.sourceHost)}`}>
                  <Plus className="mr-1 h-3.5 w-3.5" />Add
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {d.provider && <p className="border-t border-border/60 px-3.5 py-1.5 text-[10px] text-muted-foreground">Search by {d.provider}</p>}
    </CardShell>
  );
}
