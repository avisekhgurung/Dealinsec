/**
 * The one place in Settings that shows and edits the saved ideal client and offer (client_profiles).
 * It reuses the same dialog as the Leads page and FitCard, so there is a single record and a single
 * form; this card just makes it discoverable. What's saved here feeds the fit check on every lead,
 * Client Radar's "Use my saved ideal client", and what an AI draft may say the sender offers.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pencil, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IdealClientDialog } from "@/components/leads/ideal-client-dialog";
import { useMoney } from "@/hooks/use-locale";
import { IDEAL_CLIENT_URL, type IdealClientResponse } from "@/lib/leads";
import { sizeWanted } from "@shared/fit";

export function IdealClientCard({ canEdit }: { canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const { money } = useMoney();
  const q = useQuery<IdealClientResponse>({ queryKey: [IDEAL_CLIENT_URL], retry: false });
  // Leads not set up on this server, or no permission to read them: the card simply isn't shown.
  if (q.isError) return null;
  const p = q.data?.profile;
  const rows: { label: string; value: string }[] = p ? [
    { label: "What you do", value: p.about ?? "" },
    { label: "What you sell", value: p.services.join(", ") },
    { label: "Industries you target", value: p.targetIndustries.join(", ") },
    { label: "Places you target", value: p.targetLocations.join(", ") },
    { label: "Never work with", value: p.exclusions.join(", ") },
    { label: "How big a company", value: sizeWanted(p.minEmployees, p.maxEmployees) },
    { label: "Smallest deal worth taking", value: p.minDealMinor ? money(p.minDealMinor) : "" },
  ].filter((r) => r.value) : [];
  return (
    <Card className="glass-card" data-testid="ideal-client-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><Target className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden />Ideal client &amp; what you offer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          One saved profile drives the rest: the fit check on every lead, Client Radar's "Use my saved ideal client",
          and what an AI-written message may say you offer — a draft never claims a service you haven't written here.
          A lead you've excluded is never written to, and one that doesn't match asks you first.
        </p>
        {q.data && (rows.length ? (
          <dl className="space-y-1.5" data-testid="ideal-client-summary">
            {rows.map((r) => (
              <div key={r.label} className="text-sm">
                <dt className="inline text-xs text-muted-foreground">{r.label}: </dt>
                <dd className="inline break-words">{r.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="ideal-client-empty">Not set yet. Until you describe what you offer, AI drafts can't mention your services.</p>
        ))}
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="ideal-client-edit">
            <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden />{rows.length ? "Edit" : "Set it up"}
          </Button>
        )}
      </CardContent>
      <IdealClientDialog open={open} onOpenChange={setOpen} />
    </Card>
  );
}
