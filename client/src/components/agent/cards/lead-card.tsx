/** Leads the agent read or changed: each row is a link to the lead, with its stage and next step. */
import { Link } from "wouter";
import { ChevronRight, Target } from "lucide-react";
import type { AgentCard } from "@shared/agent";
import { StageBadge } from "@/components/leads/stage-badge";
import { CardShell } from "./card-shell";

interface Item { id: number; company: string; stage: string; value?: string | null; next?: { title: string; due?: string | null } | null; route: string }

export function LeadCard({ card }: { card: AgentCard }) {
  const d = card.data as { title?: string; leads?: Item[] };
  const leads = Array.isArray(d.leads) ? d.leads : [];
  if (!leads.length) return null;
  return (
    <CardShell label={d.title || "Leads"} icon={<Target className="h-3 w-3" />} testId="lead-card">
      <ul className="divide-y divide-border/60">
        {leads.map((l) => (
          <li key={l.id}>
            <Link href={l.route} className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-muted/40">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{l.company}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {l.next ? `Next: ${l.next.title}${l.next.due ? ` · ${l.next.due}` : ""}` : "No next step"}{l.value ? ` · ${l.value}` : ""}
                </span>
              </span>
              <StageBadge status={l.stage} />
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}
