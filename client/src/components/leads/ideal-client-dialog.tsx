/** What you sell and who you want to win. Short lists, typed with commas; every field is optional. */
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useMoney } from "@/hooks/use-locale";
import { useToast } from "@/hooks/use-toast";
import { IDEAL_CLIENT_URL, leadCall, leadError, refreshProfile, type IdealClientResponse } from "@/lib/leads";

const split = (v: string) => v.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
const join = (xs: string[]) => xs.join(", ");

export function IdealClientDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const { input } = useMoney();
  const { data } = useQuery<IdealClientResponse>({ queryKey: [IDEAL_CLIENT_URL], enabled: open });
  const [f, setF] = useState({ about: "", services: "", targetIndustries: "", targetLocations: "", exclusions: "", minDeal: "" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !data) return;
    const p = data.profile;
    setF({ about: p.about ?? "", services: join(p.services), targetIndustries: join(p.targetIndustries), targetLocations: join(p.targetLocations), exclusions: join(p.exclusions), minDeal: p.minDealMinor ? input(p.minDealMinor) : "" });
    setError(null);
  }, [open, data]);

  const save = useMutation({
    mutationFn: () => {
      const minDeal = f.minDeal.trim() ? Number(f.minDeal.replace(/,/g, "")) : null;
      if (minDeal !== null && !(minDeal > 0)) throw new Error("400: " + JSON.stringify({ error: "Minimum deal must be a positive number." }));
      return leadCall("PUT", IDEAL_CLIENT_URL, {
        about: f.about.trim(), services: split(f.services), targetIndustries: split(f.targetIndustries),
        targetLocations: split(f.targetLocations), exclusions: split(f.exclusions), minDealMajor: minDeal,
      });
    },
    onSuccess: () => { refreshProfile(); toast({ title: "Ideal client saved" }); onOpenChange(false); },
    onError: (e) => {
      // Nothing changed is not an error worth showing.
      if (leadError(e, "").includes("already how")) { onOpenChange(false); return; }
      setError(leadError(e, "Couldn't save."));
    },
  });

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const field = (k: Exclude<keyof typeof f, "about">, label: string, hint: string, props: Record<string, unknown> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`ic-${k}`} className="text-xs">{label}</Label>
      <Input id={`ic-${k}`} value={f[k]} onChange={set(k)} placeholder={hint} data-testid={`input-ic-${k}`} {...props} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Your ideal client</DialogTitle>
          <DialogDescription>Tell us who you want to work with. Each lead is then checked against this with plain rules, and nothing here is shared or sent anywhere.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ic-about" className="text-xs">What you do, and for whom</Label>
            <Textarea id="ic-about" rows={2} maxLength={600} value={f.about} onChange={set("about")} placeholder="I design websites for small logistics companies" data-testid="input-ic-about" />
          </div>
          {field("services", "What you sell", "Website design, Branding")}
          {field("targetIndustries", "Industries you want", "Logistics, Retail")}
          {field("targetLocations", "Where", "India, UK")}
          {field("minDeal", "Smallest deal worth taking", "50000", { inputMode: "decimal" })}
          {field("exclusions", "Never work with", "Gambling, Tobacco")}
          <p className="text-[11px] text-muted-foreground">Separate items with commas. Leave a field blank to leave it out.</p>
          {error && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400" data-testid="ic-error">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" className="gradient-btn text-white" disabled={save.isPending} data-testid="button-save-ic">{save.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
