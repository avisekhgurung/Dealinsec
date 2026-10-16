/**
 * Add a lead, or edit one: the same form for both. Only what the person types is sent; nothing is guessed.
 * The server decides whether the company is already a lead (same website, or same name when there is none); when
 * it is, it refuses with the existing lead's id, and the form links to that lead instead of showing an error.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { trackEvent } from "@/lib/analytics";
import { leadCall, leadError, refreshLeads, type LeadView } from "@/lib/leads";
import { duplicateLead } from "@shared/lead-view";

interface Form {
  companyName: string; website: string; industry: string; location: string; estValueMajor: string;
  contactName: string; contactRole: string; contactEmail: string; fitSummary: string;
}
const EMPTY: Form = { companyName: "", website: "", industry: "", location: "", estValueMajor: "", contactName: "", contactRole: "", contactEmail: "", fitSummary: "" };

const fromLead = (l: LeadView, valueMajor: string): Form => ({
  companyName: l.companyName, website: l.website ?? "", industry: l.industry ?? "", location: l.location ?? "", estValueMajor: valueMajor,
  contactName: l.contactName ?? "", contactRole: l.contactRole ?? "", contactEmail: l.contactEmail ?? "", fitSummary: l.fitSummary ?? "",
});

/** Only the fields the person filled in; a blank field on the edit form is "leave as is", not "clear". */
function payload(f: Form) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    const t = v.trim();
    if (!t) continue;
    out[k] = k === "estValueMajor" ? Number(t.replace(/,/g, "")) : t;
  }
  return out;
}

export function LeadFormDialog({
  open, onOpenChange, lead, valueMajor = "", onSaved,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  /** Present when editing. */
  lead?: LeadView; valueMajor?: string; onSaved?: (lead: LeadView) => void;
}) {
  const { toast } = useToast();
  const [f, setF] = useState<Form>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ existingId: number; message: string } | null>(null);
  useEffect(() => { if (open) { setF(lead ? fromLead(lead, valueMajor) : EMPTY); setError(null); setDuplicate(null); } }, [open, lead, valueMajor]);

  const save = useMutation({
    mutationFn: () => {
      const body = payload(f);
      if (body.estValueMajor !== undefined && !(Number(body.estValueMajor) > 0)) throw new Error("400: " + JSON.stringify({ error: "Estimated value must be a positive number." }));
      return lead ? leadCall<{ lead: LeadView }>("PATCH", `/api/leads/${lead.id}`, body) : leadCall<{ lead: LeadView }>("POST", "/api/leads", body);
    },
    onSuccess: (r) => {
      if (!lead) trackEvent("lead_created", { source: "manual" });
      refreshLeads();
      toast({ title: lead ? "Lead updated" : "Lead added" });
      onOpenChange(false);
      onSaved?.(r.lead);
    },
    onError: (e) => {
      // Already a lead: nothing was added or changed. Point at the one that exists rather than reporting a failure.
      const dup = duplicateLead(e);
      if (dup && dup.existingId !== lead?.id) { setDuplicate(dup); return; }
      setError(leadError(e, "Couldn't save the lead."));
    },
  });

  const set = (k: keyof Form) => (e: { target: { value: string } }) => { setF((p) => ({ ...p, [k]: e.target.value })); if (k === "companyName" || k === "website") setDuplicate(null); };
  const field = (k: keyof Form, label: string, props: Record<string, unknown> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`lead-${k}`} className="text-xs">{label}</Label>
      <Input id={`lead-${k}`} value={f[k]} onChange={set(k)} data-testid={`input-lead-${k}`} {...props} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{lead ? "Edit lead" : "Add a lead"}</DialogTitle>
          <DialogDescription>
            {lead ? "Change only what you know. Blank fields stay as they are." : "A company you want to win. Add only what you know: nothing is looked up or guessed."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); setError(null); setDuplicate(null); if (!lead && !f.companyName.trim()) { setError("Enter the company's name."); return; } save.mutate(); }} className="space-y-3">
          {field("companyName", "Company *", { autoFocus: !lead, maxLength: 120, required: !lead })}
          <div className="grid gap-3 sm:grid-cols-2">
            {field("website", "Website", { placeholder: "acme.com", inputMode: "url" })}
            {field("estValueMajor", "Estimated value", { inputMode: "decimal", placeholder: "50000" })}
            {field("industry", "Industry", { maxLength: 80 })}
            {field("location", "Location", { maxLength: 80 })}
            {field("contactName", "Contact name", { maxLength: 100 })}
            {field("contactRole", "Contact role", { maxLength: 100 })}
          </div>
          {field("contactEmail", "Contact email", { type: "email", inputMode: "email", placeholder: "Only if you have it" })}
          <div className="space-y-1.5">
            <Label htmlFor="lead-fitSummary" className="text-xs">Why they may need you</Label>
            <Textarea id="lead-fitSummary" value={f.fitSummary} onChange={set("fitSummary")} rows={3} maxLength={1000} data-testid="input-lead-fitSummary" />
          </div>
          {duplicate && (
            <div role="alert" className="flex gap-2.5 rounded-xl border border-amber-300/70 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200" data-testid="lead-form-duplicate">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="font-semibold">Already in your leads</p>
                <p className="mt-0.5 break-words">{duplicate.message} {lead ? "Nothing was changed." : "Nothing new was added."}</p>
                <Link href={`/leads/${duplicate.existingId}`} onClick={() => onOpenChange(false)} className="mt-1.5 inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline" data-testid="lead-form-duplicate-link">
                  Open the existing lead<ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </div>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400" data-testid="lead-form-error">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" className="gradient-btn text-white" disabled={save.isPending} data-testid="button-save-lead">
              {save.isPending ? "Saving…" : lead ? "Save changes" : "Add lead"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
