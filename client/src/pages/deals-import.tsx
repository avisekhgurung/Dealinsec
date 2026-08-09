/**
 * Import deals — dedicated bulk-import page (modeled on the reference flow).
 *
 * Download the full-field CSV template → fill it (up to 3 deliverables per
 * deal in fixed column blocks — foolproof in Excel/Sheets; only the first
 * is required) → drop the file → review the parsed + validated preview →
 * import. Creation goes through the normal POST /api/deals, so credits,
 * permissions and the trial behave exactly like manual creation; an
 * out-of-credits error stops the loop with the honest reason instead of
 * failing every remaining row the same way.
 */
import { useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BottomNav } from "@/components/bottom-nav";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { parseCsv, toCsv, downloadCsv, unguardCell } from "@/lib/csv";
import { dealTypeOptions } from "@shared/dealTypeTaxonomy";
import { useUpgradeModal } from "@/components/upgrade-modal";
import { parseApiError, isUpgradeError } from "@/lib/api-error";
import {
  ArrowLeft, UploadCloud, Download, FileSpreadsheet, CheckCircle2,
  AlertTriangle, Loader2, ChevronRight, Plus, X,
} from "lucide-react";

const uuid = () =>
  (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// ── Template ───────────────────────────────────────────────────────────
const DELIVERABLE_BLOCKS = 3;
const TEMPLATE_HEADERS = [
  "client_name", "deal_title", "deal_type", "amount", "start_date", "end_date",
  "deliverable_mode",
  ...Array.from({ length: DELIVERABLE_BLOCKS }, (_, i) => [
    `deliverable${i + 1}_scope`, `deliverable${i + 1}_type`, `deliverable${i + 1}_qty`,
    `deliverable${i + 1}_frequency`, `deliverable${i + 1}_notes`,
  ]).flat(),
];

function downloadTemplate() {
  const rows = [
    [
      "Skyline Developers LLP", "3BHK Turnkey Interiors", "Interior Design", "850000",
      "2026-09-01", "2026-12-31", "all",
      "Full home interiors", "Turnkey design & execution", "1", "One-time", "Modular kitchen included",
      "3D renders", "Design visualisation", "4", "One-time", "",
      "", "", "", "", "",
    ],
    [
      "Verma Constructions", "Site Supervision Phase 2", "Construction", "460000",
      "2026-09-15", "2027-03-31", "all",
      "Site supervision", "Monthly supervision", "6", "Per month", "",
      "", "", "", "", "",
      "", "", "", "", "",
    ],
  ];
  downloadCsv("dealinsec-deals-template.csv", toCsv(TEMPLATE_HEADERS, rows));
}

// ── Row parsing / validation ───────────────────────────────────────────
interface ParsedDeal {
  row: number;
  brandName: string;
  dealTitle: string;
  dealType: string;
  dealAmount: number;
  startDate: string;
  endDate: string;
  deliverableMode: "all" | "any_one";
  deliverables: { id: string; platform: string; contentType: string; quantity: number; frequency: string; notes?: string }[];
  errors: string[];
}

/** Accepts YYYY-MM-DD, DD-MM-YYYY or DD/MM/YYYY → ISO, else null. */
function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

function parseRows(records: Record<string, string>[]): ParsedDeal[] {
  const typeSet = new Set<string>(dealTypeOptions as readonly string[]);
  return records.map((r, i) => {
    const get = (k: string) => unguardCell((r[k] ?? "").trim());
    const errors: string[] = [];
    const brandName = get("client_name");
    const dealTitle = get("deal_title");
    if (!brandName) errors.push("client_name is required");
    if (!dealTitle) errors.push("deal_title is required");
    let dealType = get("deal_type") || "Custom";
    if (!typeSet.has(dealType)) dealType = "Custom";
    const dealAmount = parseInt(get("amount").replace(/[^0-9]/g, ""), 10);
    if (!Number.isFinite(dealAmount) || dealAmount <= 0) errors.push("amount must be a positive number");
    const startDate = normalizeDate(get("start_date"));
    const endDate = normalizeDate(get("end_date"));
    if (!startDate) errors.push("start_date must be YYYY-MM-DD or DD-MM-YYYY");
    if (!endDate) errors.push("end_date must be YYYY-MM-DD or DD-MM-YYYY");
    const modeRaw = get("deliverable_mode").toLowerCase();
    const deliverableMode = modeRaw === "any_one" || modeRaw === "any one" ? "any_one" as const : "all" as const;
    const deliverables: ParsedDeal["deliverables"] = [];
    for (let b = 1; b <= DELIVERABLE_BLOCKS; b++) {
      const scope = get(`deliverable${b}_scope`);
      if (!scope) continue;
      const qty = parseInt(get(`deliverable${b}_qty`) || "1", 10);
      deliverables.push({
        id: uuid(),
        platform: scope,
        contentType: get(`deliverable${b}_type`) || scope,
        quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
        frequency: get(`deliverable${b}_frequency`) || "One-time",
        notes: get(`deliverable${b}_notes`) || undefined,
      });
    }
    if (!deliverables.length) errors.push("deliverable1_scope is required (at least one deliverable)");
    return {
      row: i + 2, // +1 header, +1 human 1-indexing
      brandName, dealTitle, dealType,
      dealAmount: Number.isFinite(dealAmount) ? dealAmount : 0,
      startDate: startDate ?? "", endDate: endDate ?? "",
      deliverableMode, deliverables, errors,
    };
  });
}

// ── Page ───────────────────────────────────────────────────────────────
type ImportResult = { row: number; title: string; ok: boolean; reason?: string };

export default function DealsImportPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { openUpgradeModal } = useUpgradeModal();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedDeal[]>([]);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<ImportResult[] | null>(null);

  const valid = useMemo(() => parsed.filter((p) => p.errors.length === 0), [parsed]);
  const invalid = parsed.length - valid.length;

  const readFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast({ title: "CSV only", description: "Download the template and fill it in — Excel/Sheets can save as CSV.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const records = parseCsv(String(reader.result ?? ""));
      if (!records.length) {
        toast({ title: "No rows found", description: "The file seems empty — keep the header row and add your deals under it.", variant: "destructive" });
        return;
      }
      setFileName(file.name);
      setResults(null);
      setParsed(parseRows(records));
    };
    reader.readAsText(file);
  };

  const runImport = async () => {
    setImporting(true);
    const out: ImportResult[] = [];
    let stoppedForCredits = false;
    for (const d of valid) {
      if (stoppedForCredits) {
        out.push({ row: d.row, title: d.dealTitle, ok: false, reason: "Monthly deal limit reached" });
        continue;
      }
      try {
        await apiRequest("POST", "/api/deals", {
          brandName: d.brandName,
          dealTitle: d.dealTitle,
          dealType: d.dealType,
          dealAmount: d.dealAmount,
          startDate: d.startDate,
          endDate: d.endDate,
          deliverables: d.deliverables,
          deliverableMode: d.deliverableMode,
          standardTermIds: [],
        });
        out.push({ row: d.row, title: d.dealTitle, ok: true });
      } catch (err) {
        const parsedErr = parseApiError(err);
        if (isUpgradeError(parsedErr)) {
          stoppedForCredits = true;
          out.push({ row: d.row, title: d.dealTitle, ok: false, reason: "Monthly deal limit reached" });
        } else {
          out.push({ row: d.row, title: d.dealTitle, ok: false, reason: parsedErr.error || "Could not create" });
        }
      }
    }
    await queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
    await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    setResults(out);
    setImporting(false);
    const ok = out.filter((r) => r.ok).length;
    if (stoppedForCredits) {
      toast({ title: `Imported ${ok} deal${ok !== 1 ? "s" : ""} — monthly limit reached`, description: "Your plan's deal allowance ran out mid-import.", variant: "destructive" });
      openUpgradeModal({ feature: "deals" });
    } else {
      toast({ title: `Imported ${ok} of ${valid.length} deal${valid.length !== 1 ? "s" : ""}` });
    }
  };

  return (
    <div className="min-h-screen bg-background pb-20 lg:pb-12">
      <header className="glass-header sticky top-0 z-40 lg:border-b lg:border-neutral-200/60 dark:lg:border-neutral-800/60">
        <div className="px-4 py-4 lg:max-w-[1600px] lg:mx-auto lg:px-8">
          <Link href="/deals" className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline mb-1">
            <ArrowLeft className="w-3.5 h-3.5" /> Deals
          </Link>
          <h1 className="text-xl lg:text-2xl font-bold tracking-tight">Import deals</h1>
          <p className="hidden lg:block text-sm text-muted-foreground mt-0.5">
            Create many deals at once from the DealInSec CSV template — every field, up to {DELIVERABLE_BLOCKS} deliverables per deal.
          </p>
        </div>
      </header>

      <main className="px-4 py-6 space-y-5 animate-fade-in lg:max-w-4xl lg:mx-auto lg:px-8 lg:py-8">
        {/* Mode tabs — CSV here, single-deal form is the other path */}
        <div className="flex gap-2">
          <span className="px-3.5 py-2 rounded-xl text-sm font-bold text-white gradient-btn">CSV — bulk upload</span>
          <Link href="/deals/new">
            <button className="px-3.5 py-2 rounded-xl text-sm font-semibold border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors">
              Single deal — form
            </button>
          </Link>
        </div>

        {/* Step 1 — template */}
        <Card className="glass-card border-0">
          <CardContent className="p-5 lg:p-6 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm lg:text-base">1 · Download the CSV template</p>
              <p className="text-xs lg:text-sm text-muted-foreground mt-0.5 leading-relaxed">
                All deal fields plus {DELIVERABLE_BLOCKS} deliverable blocks (scope, type, qty, frequency, notes) —
                only the first deliverable is required. Two example rows included; replace them with your deals.
              </p>
            </div>
            <Button variant="outline" className="shrink-0 font-semibold border-primary/40 text-primary" onClick={downloadTemplate} data-testid="download-template">
              <Download className="w-4 h-4 mr-2" /> Download template
            </Button>
          </CardContent>
        </Card>

        {/* Step 2 — upload */}
        <Card className="glass-card border-0">
          <CardContent className="p-5 lg:p-6">
            <p className="font-semibold text-sm lg:text-base mb-1">2 · Upload your filled CSV</p>
            <p className="text-xs lg:text-sm text-muted-foreground mb-4">
              We'll show a review of every row — nothing is created until you confirm.
            </p>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault(); setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) readFile(f);
              }}
              className={`rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
                dragOver ? "border-primary bg-primary/[0.04]" : "border-border"
              }`}
              data-testid="import-dropzone"
            >
              <UploadCloud className={`w-9 h-9 mx-auto mb-3 ${dragOver ? "text-primary" : "text-muted-foreground/50"}`} />
              <p className="text-sm font-semibold">Drag and drop your file here</p>
              <p className="text-xs text-muted-foreground my-2">or</p>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ""; }} data-testid="import-file-input" />
              <Button className="gradient-btn text-white font-semibold" onClick={() => fileRef.current?.click()} data-testid="choose-file">
                Choose file
              </Button>
              <p className="text-[11px] text-muted-foreground mt-3">Accepted file type: .csv</p>
              {fileName && (
                <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400 mt-2 inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" /> {fileName}
                  <button onClick={() => { setFileName(null); setParsed([]); setResults(null); }} aria-label="Remove file" className="text-muted-foreground hover:text-foreground"><X className="w-3 h-3" /></button>
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Step 3 — review + import */}
        {parsed.length > 0 && !results && (
          <Card className="glass-card border-0">
            <CardContent className="p-5 lg:p-6">
              <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                <div>
                  <p className="font-semibold text-sm lg:text-base">3 · Review &amp; import</p>
                  <p className="text-xs lg:text-sm text-muted-foreground mt-0.5">
                    {valid.length} ready{invalid > 0 ? ` · ${invalid} row${invalid !== 1 ? "s" : ""} with problems (skipped)` : ""}
                  </p>
                </div>
                <Button
                  className="gradient-btn text-white font-bold"
                  disabled={!valid.length || importing}
                  onClick={runImport}
                  data-testid="run-import"
                >
                  {importing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                  Import {valid.length} deal{valid.length !== 1 ? "s" : ""}
                </Button>
              </div>
              <div className="rounded-xl border border-border/60 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/40 text-left">
                        {["Row", "Client", "Deal", "Type", "Amount", "Dates", "Deliverables", "Status"].map((h) => (
                          <th key={h} className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {parsed.map((d) => (
                        <tr key={d.row} className={d.errors.length ? "bg-rose-500/[0.04]" : ""}>
                          <td className="px-3 py-2.5 text-muted-foreground tabular-nums">{d.row}</td>
                          <td className="px-3 py-2.5 font-medium whitespace-nowrap max-w-[160px] truncate">{d.brandName || "—"}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap max-w-[200px] truncate">{d.dealTitle || "—"}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">{d.dealType}</td>
                          <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">₹{d.dealAmount.toLocaleString("en-IN")}</td>
                          <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{d.startDate || "?"} → {d.endDate || "?"}</td>
                          <td className="px-3 py-2.5 tabular-nums">{d.deliverables.length}</td>
                          <td className="px-3 py-2.5">
                            {d.errors.length ? (
                              <span className="inline-flex items-start gap-1.5 text-xs text-rose-600 dark:text-rose-400 max-w-[240px]">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {d.errors.join("; ")}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Ready
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {results && (
          <Card className="glass-card border-0">
            <CardContent className="p-5 lg:p-6">
              <p className="font-semibold text-sm lg:text-base mb-3">
                Imported {results.filter((r) => r.ok).length} of {results.length} deal{results.length !== 1 ? "s" : ""}
              </p>
              <ul className="space-y-1.5 mb-4">
                {results.map((r) => (
                  <li key={r.row} className="flex items-center gap-2 text-sm">
                    {r.ok
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      : <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />}
                    <span className="truncate">{r.title}</span>
                    {!r.ok && <span className="text-xs text-muted-foreground">— {r.reason}</span>}
                  </li>
                ))}
              </ul>
              <Link href="/deals">
                <Button className="gradient-btn text-white font-semibold">
                  Go to Deals <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
