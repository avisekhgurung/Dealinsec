/**
 * Import leads from a CSV. The file is read in the browser, columns are found
 * by name, every row is checked with the same rules the server uses, and the
 * person sees exactly what will be added (and what is held back, with the
 * row number from their sheet) before anything is sent. Rows go to the server
 * in batches; duplicates already in the pipeline are skipped and reported.
 */
import { useRef, useState } from "react";
import { FileUp, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { trackEvent } from "@/lib/analytics";
import { downloadCsv, parseCsv, toCsv } from "@/lib/csv";
import { leadCall, leadError, refreshLeads } from "@/lib/leads";
import { FIELD_LABEL, MAX_IMPORT_ROWS, TEMPLATE_HEADERS, TEMPLATE_ROWS, buildImportPlan, chunk, type ImportPlan } from "@shared/leads-import";

interface Outcome { added: number; skipped: { name: string; message: string }[]; stopped: string | null }

export function LeadImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const reset = () => { setFileName(""); setPlan(null); setOutcome(null); setProgress(0); };
  const close = (o: boolean) => { if (busy) return; if (!o) reset(); onOpenChange(o); };

  const readFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast({ title: "CSV only", description: "In Excel or Sheets, use Save as → CSV, or download our template.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const records = parseCsv(String(reader.result ?? ""));
      if (!records.length) { toast({ title: "No rows found", description: "Keep the header row and put one company on each row below it.", variant: "destructive" }); return; }
      setOutcome(null); setFileName(file.name); setPlan(buildImportPlan(records));
    };
    reader.readAsText(file);
  };

  const ready = plan ? plan.rows.filter((r) => r.lead) : [];
  const held = plan ? plan.rows.filter((r) => !r.lead) : [];

  const run = async () => {
    if (!ready.length) return;
    setBusy(true); setProgress(0);
    const out: Outcome = { added: 0, skipped: [], stopped: null };
    let sent = 0;
    for (const part of chunk(ready)) {
      try {
        const r = await leadCall<{ created: unknown[]; skipped: { companyName: string; message: string }[] }>("POST", "/api/leads/batch", { leads: part.map((p) => p.lead) });
        out.added += r.created.length;
        out.skipped.push(...r.skipped.map((s) => ({ name: s.companyName, message: s.message })));
      } catch (e) {
        out.stopped = leadError(e, "The import stopped part-way.");
        break;
      }
      sent += part.length; setProgress(sent);
    }
    setBusy(false); setOutcome(out); refreshLeads();
    if (out.added) trackEvent("lead_created", { source: "import", count: out.added });
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import leads</DialogTitle>
          <DialogDescription>Upload a CSV of companies. We find the columns by name, show you what will be added, and skip any company already in your pipeline.</DialogDescription>
        </DialogHeader>

        {!outcome && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" data-testid="lead-import-file"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ""; }} />
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy} data-testid="button-choose-csv"><FileUp className="mr-1.5 h-4 w-4" />{plan ? "Choose another file" : "Choose a CSV file"}</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => downloadCsv("dealinsec-leads-template.csv", toCsv(TEMPLATE_HEADERS, TEMPLATE_ROWS))}><Download className="mr-1.5 h-4 w-4" />Template</Button>
              {fileName && <span className="min-w-0 truncate text-xs text-muted-foreground">{fileName}</span>}
            </div>

            {plan && !plan.hasCompanyColumn && (
              <p role="alert" className="rounded-xl border border-rose-300/60 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-300" data-testid="import-no-company">
                We couldn't find a company column. Name one "Company" (or "Account", "Business", "Organisation") and try again.
              </p>
            )}

            {plan && plan.hasCompanyColumn && (
              <>
                <div className="rounded-xl border bg-muted/30 p-3 text-sm" data-testid="import-summary">
                  <p><b className="tabular-nums">{ready.length}</b> ready to add{held.length ? <> · <b className="tabular-nums text-rose-600 dark:text-rose-400">{held.length}</b> need fixing</> : null}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Using: {Object.entries(plan.mapping).filter(([, f]) => f).map(([h, f]) => `${FIELD_LABEL[f!]} ← ${h}`).join(" · ")}
                  </p>
                  {plan.ignored.length > 0 && <p className="mt-0.5 text-xs text-muted-foreground">Ignored: {plan.ignored.join(", ")}</p>}
                  {plan.tooMany && <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">Only the first {MAX_IMPORT_ROWS} rows are imported. Split the rest into another file.</p>}
                </div>
                {held.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Held back (fix in your sheet and re-upload)</p>
                    <ul className="space-y-1 text-xs" data-testid="import-held">
                      {held.slice(0, 6).map((r) => <li key={r.row} className="break-words"><span className="font-semibold">Row {r.row}</span> · {r.label}: <span className="text-rose-600 dark:text-rose-400">{r.errors.join("; ")}</span></li>)}
                      {held.length > 6 && <li className="text-muted-foreground">and {held.length - 6} more</li>}
                    </ul>
                  </div>
                )}
                {ready.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Preview</p>
                    <ul className="space-y-1 text-sm">
                      {ready.slice(0, 4).map((r) => <li key={r.row} className="truncate">{r.label}{r.lead?.website ? <span className="text-muted-foreground"> · {String(r.lead.website)}</span> : null}</li>)}
                      {ready.length > 4 && <li className="text-xs text-muted-foreground">and {ready.length - 4} more</li>}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {outcome && (
          <div className="space-y-2" data-testid="import-result">
            <p className="text-sm"><b className="tabular-nums">{outcome.added}</b> {outcome.added === 1 ? "lead" : "leads"} added{outcome.skipped.length ? <>, <b className="tabular-nums">{outcome.skipped.length}</b> skipped</> : ""}.</p>
            {outcome.stopped && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{outcome.stopped} Nothing after that point was added; the leads before it are saved.</p>}
            {outcome.skipped.length > 0 && (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {outcome.skipped.slice(0, 8).map((s, i) => <li key={i} className="break-words"><span className="font-semibold text-foreground">{s.name}</span>: {s.message}</li>)}
                {outcome.skipped.length > 8 && <li>and {outcome.skipped.length - 8} more</li>}
              </ul>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {outcome ? (
            <Button onClick={() => close(false)} data-testid="button-import-done">Done</Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => close(false)} disabled={busy}>Cancel</Button>
              <Button type="button" className="gradient-btn text-white" onClick={run} disabled={busy || !ready.length} data-testid="button-run-import">
                {busy ? `Importing… ${progress}/${ready.length}` : ready.length ? `Import ${ready.length} ${ready.length === 1 ? "lead" : "leads"}` : "Import"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
