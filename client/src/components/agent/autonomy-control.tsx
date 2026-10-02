/**
 * How much the agent may do without asking. Level 0 asks before every change;
 * level 1 lets it make safe internal changes on its own. Sharing a link,
 * agreements, invoices, payments and changing an amount ALWAYS ask — that is
 * enforced on the server, so this switch cannot loosen it.
 */
import { useQuery } from "@tanstack/react-query";
import { SlidersHorizontal } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

export function AutonomyControl() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isOwner = (user as { orgRole?: string } | undefined)?.orgRole === "OWNER";
  const { data } = useQuery<{ autonomyLevel: number }>({ queryKey: ["/api/agent/settings"], staleTime: 60_000 });
  const level = data?.autonomyLevel ?? 0;

  const set = async (on: boolean) => {
    try {
      await apiRequest("PATCH", "/api/agent/settings", { autonomyLevel: on ? 1 : 0 });
      await queryClient.invalidateQueries({ queryKey: ["/api/agent/settings"] });
    } catch {
      toast({ title: "Couldn't change that setting." });
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Agent permissions" data-testid="agent-autonomy"
          className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-semibold text-foreground/80 transition hover:bg-muted/60">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{level === 1 ? "Safe changes: automatic" : "Asks before changes"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold">Make safe changes without asking</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {level === 1 ? "On: the agent may create a deal or a draft quotation, or edit a pending deal, on its own." : "Off: the agent asks before every change."}
            </p>
          </div>
          <Switch checked={level === 1} onCheckedChange={set} disabled={!isOwner} aria-label="Make safe changes without asking" data-testid="autonomy-switch" />
        </div>
        <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
          It <b>always asks</b> before sharing a link, creating an agreement or an invoice, recording a payment, or changing an amount.
        </p>
        {!isOwner && <p className="mt-2 text-xs text-muted-foreground">Only the workspace owner can change this.</p>}
      </PopoverContent>
    </Popover>
  );
}
