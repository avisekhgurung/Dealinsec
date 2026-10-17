/**
 * The prospect workspace: every prospect the organization's searches found, as a table. Search, filters, sort and page
 * live in the URL and are evaluated on the server (GET /api/outbound/prospects); the browser only ever holds one page.
 *
 * Selection is explicit about its scope: ticked rows (kept across pages), or "all N matching these filters", frozen
 * when chosen so prospects found later never join it. Changing the search or a filter clears any selection.
 * Bulk actions are the safe ones only: export (CSV or XLSX, after a confirmation that names the scope and the count),
 * clear the selection, open a prospect's details. Nothing here contacts anyone or changes a prospect.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, ExternalLink, Filter, Loader2, PanelRightOpen, RotateCcw, Search, SearchX, X } from "lucide-react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { EXPORT_URL, PREPARE_OUTREACH_URL, WORKSPACE_URL, countryName } from "@/lib/outbound";
import { leadCall, leadError, refreshLeads } from "@/lib/leads";
import { PREPARE_MAX, type PrepareOutcome } from "@shared/outreach-safety";
import { cn } from "@/lib/utils";
import {
  CONTACT_LABEL, CONTACT_LEVEL, EMAIL_LABEL, EMAIL_STATUS, ICP_FIT, ICP_FIT_LABEL, MAX_EXPORT_ROWS, NO_SELECTION, PAGE_SIZES, PHONE_LABEL, PHONE_STATUS,
  READINESS, READINESS_LABEL, SIZE_BUCKETS, afterFiltersChange, exportLimits, exportScopeOf, filtersKey, hasActiveFilters, isSelected, parseWorkspaceQuery,
  selectAllMatching, selectionCount, toggleId, togglePage, workspaceParams,
  type ExportPreset, type Selection, type SortField, type WorkspaceFacets, type WorkspaceFilters, type WorkspaceQuery, type WorkspaceRow, type WorkspaceSummary,
} from "@shared/prospect-workspace";

interface WorkspaceResponse { rows: WorkspaceRow[]; page: number; pageCount: number; pageSize: number; summary: WorkspaceSummary; facets: WorkspaceFacets; asOf: string; truncated: boolean }

const READY_TONE: Record<string, string> = {
  ready: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  qualified: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  needs_evidence: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  stale: "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
  not_a_fit: "border-border bg-muted text-muted-foreground", rejected: "border-border bg-muted text-muted-foreground",
};
const FIT_TONE: Record<string, string> = { match: "text-emerald-700 dark:text-emerald-400", partial: "text-sky-700 dark:text-sky-400", not_qualified: "text-muted-foreground", unknown: "text-muted-foreground" };
const SIZE_LABEL: Record<string, string> = { "1-10": "1–10 people", "11-50": "11–50 people", "51-200": "51–200 people", "201+": "201+ people", unknown: "Size not stated" };
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const evidenceDate = (r: WorkspaceRow) => {
  const e = r.latestEvidence;
  if (!e) return null;
  const d = new Date(e.at);
  return e.precision === "year" ? `${d.getUTCFullYear()} (year only)` : e.precision === "month" ? d.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" }) : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

/** The server's error, readable: "409: {json}" → status, code, message, count. */
function apiFailure(err: unknown): { status: number | null; code: string | null; message: string; count?: number } {
  const m = String((err as Error)?.message ?? "").match(/^(\d{3}):\s*([\s\S]*)$/);
  if (!m) return { status: null, code: null, message: "The connection failed. Nothing was exported; try again." };
  try { const b = JSON.parse(m[2]); return { status: Number(m[1]), code: b?.code ?? null, message: typeof b?.error === "string" ? b.error : "Something went wrong.", count: typeof b?.count === "number" ? b.count : undefined }; }
  catch { return { status: Number(m[1]), code: null, message: "Something went wrong on our side. Nothing was exported; try again." }; }
}

function MultiFilter<T extends string>({ label, values, options, labels, onChange, testId }: { label: string; values: T[] | undefined; options: readonly T[]; labels: (v: T) => string; onChange: (v: T[]) => void; testId: string }) {
  const on = values ?? [];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("h-8 gap-1.5", on.length && "border-emerald-600 text-emerald-800 dark:text-emerald-300")} data-testid={`filter-${testId}`}>
          {label}{on.length ? <span className="rounded-full bg-emerald-600 px-1.5 text-[10px] font-semibold text-white">{on.length}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-2">
        <fieldset>
          <legend className="sr-only">{label}</legend>
          {options.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">No values yet.</p>}
          {options.map((o) => (
            <label key={o} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
              <Checkbox checked={on.includes(o)} onCheckedChange={(c) => onChange(c ? [...on, o] : on.filter((x) => x !== o))} aria-label={labels(o)} />
              <span className="min-w-0 truncate">{labels(o)}</span>
            </label>
          ))}
        </fieldset>
        {on.length > 0 && <Button variant="ghost" size="sm" className="mt-1 h-7 w-full text-xs" onClick={() => onChange([])}>Clear</Button>}
      </PopoverContent>
    </Popover>
  );
}

function DateRange({ label, from, to, onChange, testId }: { label: string; from?: string; to?: string; onChange: (from?: string, to?: string) => void; testId: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium">{label}</p>
      <div className="flex items-center gap-1.5">
        <Input type="date" value={from ?? ""} onChange={(e) => onChange(e.target.value || undefined, to)} className="h-8 text-xs" aria-label={`${label} from`} data-testid={`${testId}-from`} />
        <span className="text-xs text-muted-foreground">to</span>
        <Input type="date" value={to ?? ""} onChange={(e) => onChange(from, e.target.value || undefined)} className="h-8 text-xs" aria-label={`${label} to`} data-testid={`${testId}-to`} />
      </div>
    </div>
  );
}

const SORTABLE: Partial<Record<string, SortField>> = { company: "name", domain: "domain", country: "country", fit: "icpFit", readiness: "readiness", evidence: "evidence", count: "evidenceCount", created: "created" };

export function ProspectWorkspace({ canExport, onOpen, onPrepared }: { canExport: boolean; /** focus "evidence": open the brief at its evidence. */ onOpen: (row: WorkspaceRow, focus?: "evidence") => void; onPrepared?: () => void }) {
  const { toast } = useToast();
  const search = useSearch();
  const [location, navigate] = useLocation();
  // Read leniently: a hand-edited or outdated address drops what isn't valid instead of failing.
  const query: WorkspaceQuery = useMemo(() => (parseWorkspaceQuery(Object.fromEntries(new URLSearchParams(search)), false) as { ok: true; query: WorkspaceQuery }).query, [search]);
  const qs = new URLSearchParams(workspaceParams(query)).toString();
  const setQuery = (next: Partial<WorkspaceQuery>) => {
    const merged = { ...query, ...next };
    // A new search, filter or sort starts at the first page.
    if (next.filters || next.sort || next.dir || next.pageSize) merged.page = 1;
    const params = new URLSearchParams({ view: "prospects", ...workspaceParams(merged) });
    navigate(`${location}?${params.toString()}`, { replace: true });
  };
  const setFilters = (f: WorkspaceFilters) => setQuery({ filters: Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && !v.length))) as WorkspaceFilters });
  const patch = (p: Partial<WorkspaceFilters>) => setFilters({ ...query.filters, ...p });

  const q = useQuery<WorkspaceResponse>({ queryKey: [`${WORKSPACE_URL}${qs ? `?${qs}` : ""}`], placeholderData: keepPreviousData, retry: 1 });
  const data = q.data;

  // The search box writes to the URL after a pause, so typing doesn't send a request per key.
  const [text, setText] = useState(query.filters.q ?? "");
  useEffect(() => { setText(query.filters.q ?? ""); }, [query.filters.q]);
  useEffect(() => {
    const t = setTimeout(() => { if ((text.trim() || undefined) !== query.filters.q) patch({ q: text.trim() || undefined }); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  // Selection: cleared whenever the filters change, so a bulk action never reaches rows the person can't see.
  const [sel, setSel] = useState<Selection>(NO_SELECTION);
  const lastFilters = useRef(query.filters);
  useEffect(() => {
    // Read the previous filters now: the updater below runs later, after the ref already holds the new ones.
    const prev = lastFilters.current, next = query.filters;
    lastFilters.current = next;
    setSel((s) => afterFiltersChange(s, prev, next));
  }, [filtersKey(query.filters)]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = data?.rows ?? [];
  const pageIds = rows.map((r) => r.id);
  const pageAll = sel.mode === "filter" || (pageIds.length > 0 && pageIds.every((id) => isSelected(sel, id)));
  const pageSome = !pageAll && pageIds.some((id) => isSelected(sel, id));
  const count = selectionCount(sel);
  const filtered = data?.summary.filtered ?? 0;
  const active = hasActiveFilters(query.filters);

  // Export: always confirmed in a dialog that names the scope, the count and the format.
  const [dialog, setDialog] = useState<null | { selection: Selection; label: string }>(null);
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const [preset, setPreset] = useState<ExportPreset>("full");
  const [busy, setBusy] = useState(false);
  const askExport = (selection: Selection, label: string) => setDialog({ selection, label });

  // Prepare drafts: ticked prospects only (never "all matching"), at most PREPARE_MAX, confirmed first. Nothing is sent.
  const names = useRef(new Map<number, string>());
  for (const r of data?.rows ?? []) names.current.set(r.id, r.name);
  const [prepareOpen, setPrepareOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState<PrepareOutcome[] | null>(null);
  const runPrepare = async () => {
    if (sel.mode !== "ids") return;
    setPreparing(true);
    try {
      const r = await leadCall<{ results: PrepareOutcome[] }>("POST", PREPARE_OUTREACH_URL, { prospectIds: sel.ids });
      setPrepared(r.results); setPrepareOpen(false); setSel(NO_SELECTION);
      void refreshLeads(); void q.refetch();
    } catch (e) {
      toast({ title: "Drafts weren't prepared", description: leadError(e), variant: "destructive" });
    } finally {
      setPreparing(false);
    }
  };
  const runExport = async () => {
    if (!dialog) return;
    const scope = exportScopeOf(dialog.selection);
    if (!scope) return;
    setBusy(true);
    try {
      const res = await apiRequest("POST", EXPORT_URL, { format, preset, scope, sort: query.sort, dir: query.dir, confirmed: true });
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `prospects.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      const n = Number(res.headers.get("X-Export-Count") ?? selectionCount(dialog.selection));
      toast({ title: `Exported ${n} prospect${n === 1 ? "" : "s"}`, description: `${name} is downloading.` });
      setDialog(null);
    } catch (e) {
      const f = apiFailure(e);
      // The frozen selection no longer matches: close the dialog (its count is stale) and show the current list.
      if (f.code === "selection_changed") { setSel(NO_SELECTION); setDialog(null); void q.refetch(); }
      toast({ title: "Export didn't finish", description: f.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const sortBy = (field: SortField) => setQuery({ sort: field, dir: query.sort === field ? (query.dir === "asc" ? "desc" : "asc") : field === "evidence" || field === "evidenceCount" || field === "readiness" || field === "icpFit" || field === "created" ? "desc" : "asc" });
  const head = (key: string, label: string, className?: string) => {
    const field = SORTABLE[key];
    if (!field) return <th key={key} scope="col" className={cn("whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground", className)}>{label}</th>;
    const on = query.sort === field;
    return (
      <th key={key} scope="col" aria-sort={on ? (query.dir === "asc" ? "ascending" : "descending") : "none"} className={cn("whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground", className)}>
        <button onClick={() => sortBy(field)} className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground" data-testid={`sort-${key}`}>
          {label}{on ? (query.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
        </button>
      </th>
    );
  };

  const f = query.filters;
  const chips: { label: string; clear: () => void }[] = [];
  if (f.q) chips.push({ label: `“${f.q}”`, clear: () => { setText(""); patch({ q: undefined }); } });
  const listChip = <T extends string>(key: keyof WorkspaceFilters, label: string, name: (v: T) => string) => { const v = f[key] as T[] | undefined; if (v?.length) chips.push({ label: `${label}: ${v.map(name).join(", ")}`, clear: () => patch({ [key]: undefined } as Partial<WorkspaceFilters>) }); };
  listChip("readiness", "Readiness", (v) => READINESS_LABEL[v as keyof typeof READINESS_LABEL]);
  listChip("icpFit", "ICP fit", (v) => ICP_FIT_LABEL[v as keyof typeof ICP_FIT_LABEL]);
  listChip("country", "Country", (v) => countryName(v));
  listChip("contact", "Contact", (v) => CONTACT_LABEL[v as keyof typeof CONTACT_LABEL]);
  listChip("email", "Email", (v) => EMAIL_LABEL[v as keyof typeof EMAIL_LABEL]);
  listChip("phone", "Phone", (v) => PHONE_LABEL[v as keyof typeof PHONE_LABEL]);
  listChip("size", "Size", (v) => SIZE_LABEL[v]);
  listChip("source", "Found via", (v) => v);
  if (f.location) chips.push({ label: `Location: ${f.location}`, clear: () => patch({ location: undefined }) });
  if (f.industry) chips.push({ label: `Industry: ${f.industry}`, clear: () => patch({ industry: undefined }) });
  if (f.evidenceFrom || f.evidenceTo) chips.push({ label: `Evidence ${f.evidenceFrom ?? "…"} – ${f.evidenceTo ?? "…"}`, clear: () => patch({ evidenceFrom: undefined, evidenceTo: undefined }) });
  if (f.createdFrom || f.createdTo) chips.push({ label: `Found ${f.createdFrom ?? "…"} – ${f.createdTo ?? "…"}`, clear: () => patch({ createdFrom: undefined, createdTo: undefined }) });
  if (f.inLeads) chips.push({ label: f.inLeads === "yes" ? "In Leads" : "Not in Leads", clear: () => patch({ inLeads: undefined }) });
  const moreCount = [f.location, f.industry, f.size?.length, f.phone?.length, f.source?.length, f.evidenceFrom || f.evidenceTo, f.createdFrom || f.createdTo, f.inLeads].filter(Boolean).length;
  const reset = () => { setText(""); setQuery({ filters: {} }); };
  const activeFilterCount = [f.readiness?.length, f.icpFit?.length, f.country?.length, f.contact?.length, f.email?.length].filter(Boolean).length + moreCount;
  /** The filter controls, once: in the bar from tablets up, in a drawer on phones. */
  const filterControls = (
    <>
        <MultiFilter label="Readiness" testId="readiness" values={f.readiness} options={READINESS} labels={(v) => READINESS_LABEL[v]} onChange={(v) => patch({ readiness: v })} />
        <MultiFilter label="ICP fit" testId="icp" values={f.icpFit} options={ICP_FIT} labels={(v) => ICP_FIT_LABEL[v]} onChange={(v) => patch({ icpFit: v })} />
        <MultiFilter label="Country" testId="country" values={f.country} options={(data?.facets.countries ?? []).map((c) => c.value)} labels={(v) => `${countryName(v)} (${data?.facets.countries.find((c) => c.value === v)?.count ?? 0})`} onChange={(v) => patch({ country: v })} />
        <MultiFilter label="Contact" testId="contact" values={f.contact} options={CONTACT_LEVEL} labels={(v) => CONTACT_LABEL[v]} onChange={(v) => patch({ contact: v })} />
        <MultiFilter label="Email" testId="email" values={f.email} options={EMAIL_STATUS} labels={(v) => EMAIL_LABEL[v]} onChange={(v) => patch({ email: v })} />
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className={cn("h-8 gap-1.5", moreCount && "border-emerald-600")} data-testid="filter-more"><Filter className="h-3.5 w-3.5" />More{moreCount ? <span className="rounded-full bg-emerald-600 px-1.5 text-[10px] font-semibold text-white">{moreCount}</span> : null}</Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs font-medium">Location<TextFilter value={f.location} onChange={(v) => patch({ location: v })} placeholder="e.g. Austin" testId="filter-location" /></label>
              <label className="space-y-1 text-xs font-medium">Industry / market<TextFilter value={f.industry} onChange={(v) => patch({ industry: v })} placeholder="e.g. SaaS" testId="filter-industry" /></label>
            </div>
            <div className="flex flex-wrap gap-2">
              <MultiFilter label="Company size" testId="size" values={f.size} options={SIZE_BUCKETS} labels={(v) => SIZE_LABEL[v]} onChange={(v) => patch({ size: v })} />
              <MultiFilter label="Phone" testId="phone" values={f.phone} options={PHONE_STATUS} labels={(v) => PHONE_LABEL[v]} onChange={(v) => patch({ phone: v })} />
              <MultiFilter label="Found via" testId="source" values={f.source} options={(data?.facets.sources ?? []).map((c) => c.value)} labels={(v) => v} onChange={(v) => patch({ source: v })} />
            </div>
            <DateRange label="Latest evidence date" testId="evidence" from={f.evidenceFrom} to={f.evidenceTo} onChange={(a, b) => patch({ evidenceFrom: a, evidenceTo: b })} />
            <DateRange label="Found on" testId="created" from={f.createdFrom} to={f.createdTo} onChange={(a, b) => patch({ createdFrom: a, createdTo: b })} />
            <div className="space-y-1">
              <p className="text-xs font-medium">In Leads</p>
              <Select value={f.inLeads ?? "any"} onValueChange={(v) => patch({ inLeads: v === "any" ? undefined : (v as "yes" | "no") })}>
                <SelectTrigger className="h-8 text-xs" aria-label="In Leads"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="any">Any</SelectItem><SelectItem value="yes">Added to Leads</SelectItem><SelectItem value="no">Not added</SelectItem></SelectContent>
              </Select>
            </div>
          </PopoverContent>
        </Popover>
        {(active || chips.length > 0) && <Button variant="ghost" size="sm" className="h-8" onClick={reset} data-testid="filters-reset"><RotateCcw className="mr-1 h-3.5 w-3.5" />Reset filters</Button>}
    </>
  );

  const s = data?.summary;
  const scopeWord = active ? "in this view" : "in your workspace";
  const notSetUp = q.error && /PROSPECTS_NOT_SETUP/.test(String((q.error as Error).message));

  return (
    <section className="min-w-0 space-y-3" aria-labelledby="workspace-title" data-testid="prospect-workspace">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="workspace-title" className="text-base font-semibold">Prospects</h2>
          <p className="text-xs text-muted-foreground">Every company your searches found, with the evidence behind each one. Nothing here contacts anyone.</p>
        </div>
        {canExport && (
          <Button size="sm" variant="outline" disabled={!data || filtered === 0 || filtered > MAX_EXPORT_ROWS} title={filtered > MAX_EXPORT_ROWS ? `Exports are limited to ${MAX_EXPORT_ROWS} prospects; narrow the filters` : undefined}
            onClick={() => data && askExport(selectAllMatching(query.filters, data.asOf, filtered), active ? `All ${filtered} prospects matching your filters` : `All ${filtered} prospects`)} data-testid="export-filtered">
            <Download className="mr-1.5 h-4 w-4" />Export {active ? "filtered" : "all"}{data ? ` (${filtered})` : ""}
          </Button>
        )}
      </div>

      {s && (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="workspace-summary">
          {[
            { n: s.filtered, label: active ? `match your filters (of ${s.all})` : "prospects" },
            { n: s.ready, label: `ready ${scopeWord}` },
            { n: s.needsReview, label: `need evidence or review` },
            { n: s.withDecisionMaker, label: "with a named decision maker" },
            { n: s.verifiedEmail, label: "with a provider-verified email" },
          ].map((x) => (
            // Label (dt) before value (dd) for assistive tech; shown number first.
            <div key={x.label} className="flex flex-col-reverse rounded-xl border px-3 py-2"><dt className="text-[11px] leading-tight text-muted-foreground">{x.label}</dt><dd className="text-lg font-bold tabular-nums leading-tight">{x.n}</dd></div>
          ))}
        </dl>
      )}
      {data?.truncated && <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400"><AlertTriangle className="h-3.5 w-3.5" />Showing your newest prospects only; the oldest ones aren't included in this table or its counts.</p>}

      <div className="flex flex-wrap items-center gap-2" role="search">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search company or domain" className="h-8 pl-8 text-sm" maxLength={100} aria-label="Search company or domain" data-testid="workspace-search" />
        </div>
        {/* Phones: the filters live in a drawer, so the list stays readable; from tablets up they sit in the bar. */}
        <div className="hidden md:contents">{filterControls}</div>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className={cn("h-9 gap-1.5 md:hidden", activeFilterCount && "border-emerald-600")} data-testid="filters-drawer"><Filter className="h-4 w-4" />Filters{activeFilterCount ? <span className="rounded-full bg-emerald-600 px-1.5 text-[10px] font-semibold text-white">{activeFilterCount}</span> : null}</Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto" data-testid="filters-sheet">
            <SheetHeader><SheetTitle>Filter prospects</SheetTitle></SheetHeader>
            <div className="flex flex-wrap items-center gap-2 pt-3">{filterControls}</div>
          </SheetContent>
        </Sheet>
      </div>
      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Active filters" data-testid="active-filters">
          {chips.map((c) => <li key={c.label}><span className="inline-flex max-w-[20rem] items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-xs"><span className="truncate">{c.label}</span><button onClick={c.clear} aria-label={`Remove filter ${c.label}`}><X className="h-3 w-3" /></button></span></li>)}
        </ul>
      )}

      {/* The selection: its scope and count, always spelled out. */}
      {count > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50/70 px-3 py-2 text-sm dark:border-emerald-800 dark:bg-emerald-950/30" role="status" data-testid="selection-bar">
          <span className="font-medium" data-testid="selection-scope">
            {sel.mode === "filter" ? `All ${count} prospects matching ${hasActiveFilters(sel.filters) ? "these filters" : "the workspace"} are selected (as of ${new Date(sel.asOf).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}; prospects found later aren't included).` : `${count} prospect${count === 1 ? "" : "s"} selected${count > pageIds.filter((id) => isSelected(sel, id)).length ? " (some on other pages)" : ""}.`}
          </span>
          {sel.mode === "ids" && pageAll && filtered > count && data && filtered <= MAX_EXPORT_ROWS && (
            <Button variant="ghost" size="sm" className="h-auto p-0 underline underline-offset-2" onClick={() => setSel(selectAllMatching(query.filters, data.asOf, filtered))} data-testid="select-all-matching">Select all {filtered} matching {active ? "these filters" : "prospects"}</Button>
          )}
          <span className="ml-auto flex gap-2">
 {canExport && sel.mode === "ids" && <Button size="sm" variant="outline" onClick={() => setPrepareOpen(true)} disabled={count > PREPARE_MAX} title={count > PREPARE_MAX ? `Prepare drafts for up to ${PREPARE_MAX} prospects at a time` : undefined} data-testid="prepare-drafts">Prepare drafts</Button>}
            {canExport && <Button size="sm" onClick={() => askExport(sel, sel.mode === "filter" ? `All ${count} prospects matching ${hasActiveFilters(sel.filters) ? "your filters" : "the workspace"}` : `${count} selected prospect${count === 1 ? "" : "s"}`)} disabled={count > MAX_EXPORT_ROWS} data-testid="export-selected"><Download className="mr-1.5 h-4 w-4" />Export selected</Button>}
            <Button size="sm" variant="outline" onClick={() => setSel(NO_SELECTION)} data-testid="selection-clear">Clear selection</Button>
          </span>
        </div>
      )}

      {notSetUp ? (
        <p className="rounded-2xl border px-4 py-10 text-center text-sm text-muted-foreground">AI Outbound isn't switched on for this workspace yet.</p>
      ) : q.isError && !data && apiFailure(q.error).status === 403 ? (
        // A permission refusal: retrying can't help, so say why instead.
        <div className="rounded-2xl border px-4 py-8 text-center" role="alert" data-testid="workspace-forbidden">
          <p className="text-sm font-medium">You don't have access to prospects.</p>
          <p className="mt-1 text-xs text-muted-foreground">{apiFailure(q.error).message} Ask your organization owner if you need it.</p>
        </div>
      ) : q.isError && !data ? (
        <div className="rounded-2xl border border-destructive/40 px-4 py-8 text-center" role="alert" data-testid="workspace-error">
          <p className="text-sm font-medium">The prospects couldn't be loaded.</p>
          <p className="mt-1 text-xs text-muted-foreground">{apiFailure(q.error).status === 400 ? "One of the filters in the address isn't valid. Reset the filters." : "Nothing was changed. Try again."}</p>
          <div className="mt-3 flex justify-center gap-2"><Button size="sm" variant="outline" onClick={() => void q.refetch()} data-testid="workspace-retry"><RotateCcw className="mr-1.5 h-4 w-4" />Retry</Button>{active && <Button size="sm" variant="ghost" onClick={reset}>Reset filters</Button>}</div>
        </div>
      ) : !data ? (
        <div className="divide-y rounded-xl border" aria-busy="true" aria-label="Loading prospects">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5" aria-hidden>
              <Skeleton className="h-4 w-4 shrink-0 rounded" />
              <Skeleton className="h-4 w-40 shrink-0" />
              <Skeleton className="hidden h-3 w-28 shrink-0 sm:block" />
              <Skeleton className="hidden h-3 w-20 shrink-0 md:block" />
              <Skeleton className="ml-auto h-5 w-20 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
      ) : data.summary.all === 0 ? (
        <p className="rounded-2xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground" data-testid="workspace-empty">No prospects yet. Companies appear here once a search has checked them.</p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed px-4 py-10 text-center" data-testid="workspace-no-match">
          <SearchX className="mx-auto mb-2 h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">No prospects match these filters.</p>
          <p className="mt-1 text-xs text-muted-foreground">{s ? `${s.all} prospect${s.all === 1 ? "" : "s"} in your workspace; none fit every filter you chose.` : "None fit every filter you chose."} Remove a filter, or reset them all.</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={reset}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Reset filters</Button>
        </div>
      ) : (
        <>
        {/* Phones and tablets: one card per prospect (two columns on a tablet), nothing to scroll sideways; the table on laptops up. */}
        <ul className={cn("grid gap-2 sm:grid-cols-2 lg:hidden", q.isFetching && "opacity-70")} aria-busy={q.isFetching} aria-label="Prospects" data-testid="workspace-cards">
          {rows.map((r) => {
            const on = isSelected(sel, r.id);
            return (
              <li key={r.id} className={cn("rounded-xl border p-3", on && "border-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20")} data-testid={`workspace-card-${r.id}`}>
                <div className="flex items-start gap-3">
                  <Checkbox className="mt-1" checked={on} disabled={sel.mode === "filter"} onCheckedChange={() => setSel((cur) => toggleId(cur, r.id))} aria-label={`Select ${r.name}`} />
                  <div className="min-w-0 flex-1">
                    <button onClick={() => onOpen(r)} className="block max-w-full truncate text-left text-[15px] font-semibold hover:underline">{r.name}</button>
                    <a href={r.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-full items-center gap-1 text-xs text-muted-foreground hover:underline"><span className="truncate">{r.domain}</span><ExternalLink className="h-3 w-3 shrink-0" /></a>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{[r.country ? countryName(r.country) : null, r.industry, r.companySize].filter(Boolean).join(" · ") || "Location and industry not known"}</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className={cn("rounded-full border px-2 py-0.5 font-medium", READY_TONE[r.readiness])}>{READINESS_LABEL[r.readiness]}</span>
                  <span className={cn("rounded-full border px-2 py-0.5 font-medium", FIT_TONE[r.icpFit])}>ICP: {ICP_FIT_LABEL[r.icpFit]}</span>
                  <span className={cn("rounded-full border px-2 py-0.5", r.emailStatus === "verified" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>{EMAIL_LABEL[r.emailStatus]}</span>
                  {r.phoneStatus !== "none" && <span className="rounded-full border px-2 py-0.5 text-muted-foreground">{PHONE_LABEL[r.phoneStatus]}</span>}
                </div>
                {r.contact && <p className="mt-1.5 truncate text-xs">{r.contact.name}{r.contact.title ? ` · ${r.contact.title}` : ""}</p>}
                <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
                  <span className="text-[11px] text-muted-foreground">{evidenceDate(r) ? `Latest evidence ${evidenceDate(r)}` : "No dated evidence"} · {r.evidenceCount} finding{r.evidenceCount === 1 ? "" : "s"}</span>
                  <Button size="sm" variant="outline" className="h-9 shrink-0" onClick={() => onOpen(r)} aria-label={`Open details for ${r.name}`} data-testid={`open-card-${r.id}`}>Open</Button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className={cn("relative hidden overflow-x-auto rounded-xl border lg:block", q.isFetching && "opacity-70")} aria-busy={q.isFetching}>
          <table className="w-full min-w-[1400px] border-collapse text-sm" data-testid="workspace-table">
            <thead className="bg-muted">
              <tr className="border-b">
                <th scope="col" className="sticky left-0 z-10 w-10 bg-muted px-3 py-2">
                  <Checkbox checked={pageAll ? true : pageSome ? "indeterminate" : false} disabled={sel.mode === "filter"} onCheckedChange={() => setSel((cur) => togglePage(cur, pageIds))} aria-label="Select every prospect on this page" data-testid="select-page" />
                </th>
                {head("company", "Company", "sticky left-10 z-10 bg-muted min-w-[12rem]")}
                {head("domain", "Website")}
                {head("country", "Country")}
                {head("industry", "Industry / market")}
                {head("size", "Size")}
                {head("contact", "Contact")}
                {head("role", "Role")}
                {head("email", "Email")}
                {head("phone", "Phone")}
                {head("fit", "ICP fit")}
                {head("readiness", "Readiness")}
                {head("evidence", "Latest evidence")}
                {head("count", "Evidence")}
                {head("created", "Found")}
                <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const on = isSelected(sel, r.id);
                return (
                  <tr key={r.id} className={cn("border-b last:border-0 hover:bg-muted/30", on && "bg-emerald-50/50 dark:bg-emerald-950/20")} data-testid={`workspace-row-${r.id}`}>
                    <td className="sticky left-0 z-[1] w-10 bg-background px-3 py-2">
                      <Checkbox checked={on} disabled={sel.mode === "filter"} onCheckedChange={() => setSel((cur) => toggleId(cur, r.id))} aria-label={`Select ${r.name}`} />
                    </td>
                    <td className="sticky left-10 z-[1] max-w-[16rem] bg-background px-3 py-2">
                      <button onClick={() => onOpen(r)} className="block max-w-full truncate text-left font-medium hover:underline" title={r.name}>{r.name}</button>
                    </td>
                    <td className="max-w-[12rem] px-3 py-2"><a href={r.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-full items-center gap-1 truncate text-xs text-muted-foreground hover:underline" title={r.website}><span className="truncate">{r.domain}</span><ExternalLink className="h-3 w-3 shrink-0" /></a></td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">{r.country ? countryName(r.country) : <Missing />}</td>
                    <td className="max-w-[12rem] truncate px-3 py-2 text-xs" title={[r.industry, r.serves && `serves ${r.serves}`].filter(Boolean).join(" · ")}>{r.industry ?? <Missing />}</td>
                    <td className="max-w-[8rem] truncate px-3 py-2 text-xs" title={r.companySize ?? undefined}>{r.companySize ?? <Missing />}</td>
                    <td className="max-w-[10rem] truncate px-3 py-2 text-xs" title={r.contact?.name}>{r.contact ? <>{r.contact.name}{r.contactLevel === "employee" && <span className="ml-1 text-muted-foreground">(employee)</span>}</> : <Missing label="No named person" />}</td>
                    <td className="max-w-[10rem] truncate px-3 py-2 text-xs" title={r.contact?.title ?? undefined}>{r.contact?.title ?? <Missing />}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs"><span className={cn(r.emailStatus === "verified" ? "text-emerald-700 dark:text-emerald-400" : r.emailStatus === "none" && "text-muted-foreground")}>{EMAIL_LABEL[r.emailStatus]}</span></td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs"><span className={cn(r.phoneStatus === "none" && "text-muted-foreground")}>{PHONE_LABEL[r.phoneStatus]}</span></td>
                    <td className={cn("whitespace-nowrap px-3 py-2 text-xs font-medium", FIT_TONE[r.icpFit])} title={[...r.icpMatch, ...r.icpUnmatched].join("\n") || undefined}>{ICP_FIT_LABEL[r.icpFit]}</td>
                    <td className="whitespace-nowrap px-3 py-2"><span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", READY_TONE[r.readiness])} title={r.readinessBlockers.join("\n") || undefined}>{READINESS_LABEL[r.readiness]}</span></td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs" title={r.latestEvidence ? `${r.latestEvidence.title}: ${r.latestEvidence.claim}` : undefined}>{evidenceDate(r) ?? <Missing label="No dated evidence" />}</td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums">{r.evidenceCount > 0 ? <button onClick={() => onOpen(r, "evidence")} className="rounded px-1 underline-offset-2 hover:bg-muted hover:underline" aria-label={`Show the evidence for ${r.name} (${r.evidenceCount})`} data-testid={`evidence-${r.id}`}>{r.evidenceCount}</button> : r.evidenceCount}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground" title={`Updated ${shortDate(r.updatedAt)}`}>{shortDate(r.createdAt)}</td>
                    <td className="px-3 py-2"><Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onOpen(r)} aria-label={`Open details for ${r.name}`} data-testid={`open-${r.id}`}><PanelRightOpen className="h-4 w-4" /></Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      {data && rows.length > 0 && (
        <nav className="flex flex-wrap items-center justify-between gap-2 text-xs" aria-label="Pages">
          <span className="text-muted-foreground">{(data.page - 1) * data.pageSize + 1}–{(data.page - 1) * data.pageSize + rows.length} of {filtered}</span>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-muted-foreground">Rows
              <Select value={String(query.pageSize)} onValueChange={(v) => setQuery({ pageSize: Number(v) })}>
                <SelectTrigger className="h-7 w-[4.5rem] text-xs" aria-label="Rows per page"><SelectValue /></SelectTrigger>
                <SelectContent>{PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <Button size="sm" variant="outline" className="h-7 px-2" disabled={data.page <= 1} onClick={() => setQuery({ page: data.page - 1 })} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
            <span className="tabular-nums">Page {data.page} of {data.pageCount}</span>
            <Button size="sm" variant="outline" className="h-7 px-2" disabled={data.page >= data.pageCount} onClick={() => setQuery({ page: data.page + 1 })} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </nav>
      )}

      <AlertDialog open={prepareOpen} onOpenChange={(o) => !o && !preparing && setPrepareOpen(false)}>
        <AlertDialogContent data-testid="prepare-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Prepare outreach drafts</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1 text-sm">
                <p>For each of the <span className="font-medium text-foreground">{count} selected prospect{count === 1 ? "" : "s"}</span> that is Ready and has an email address, DealInSec adds it to Leads with its evidence and writes one first-message draft from its confirmed facts.</p>
                <p>Nothing is sent or approved. Each draft waits under Outreach for you to read, edit and approve, and you send it from your own email app. Prospects on your do-not-contact list are skipped.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={preparing}>Cancel</AlertDialogCancel>
            <Button onClick={() => void runPrepare()} disabled={preparing} data-testid="prepare-confirm">{preparing && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Prepare drafts</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!prepared} onOpenChange={(o) => !o && setPrepared(null)}>
        <AlertDialogContent data-testid="prepare-results">
          <AlertDialogHeader>
            <AlertDialogTitle>{prepared?.filter((r) => r.outcome === "drafted").length ?? 0} draft{prepared?.filter((r) => r.outcome === "drafted").length === 1 ? "" : "s"} ready for review</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <ul className="max-h-72 space-y-1.5 overflow-y-auto text-sm">
                {(prepared ?? []).map((r) => (
                  <li key={r.prospectId} className="flex items-start gap-2">
                    <span className={cn("mt-0.5 shrink-0 rounded-full border px-1.5 text-[10px] font-semibold uppercase", r.outcome === "drafted" ? "border-emerald-300 text-emerald-700 dark:text-emerald-400" : r.outcome === "failed" ? "border-red-300 text-red-700 dark:text-red-400" : "border-border text-muted-foreground")}>{r.outcome}</span>
                    <span className="min-w-0"><span className="font-medium text-foreground">{names.current.get(r.prospectId) ?? `Prospect ${r.prospectId}`}</span>{r.outcome !== "drafted" && <span className="block text-xs">{r.message}</span>}</span>
                  </li>
                ))}
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            {onPrepared && (prepared ?? []).some((r) => r.outcome === "drafted") && <Button onClick={() => { setPrepared(null); onPrepared(); }} data-testid="prepare-review">Review drafts</Button>}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!dialog} onOpenChange={(o) => !o && !busy && setDialog(null)}>
        <AlertDialogContent data-testid="export-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Export prospects</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1 text-sm">
                <p><span className="font-medium text-foreground">{dialog?.label}</span>{dialog?.selection.mode === "filter" ? ", as they were when you selected them. Prospects found since aren't included." : "."}</p>
                {dialog && exportLimits(selectionCount(dialog.selection)).large && <p className="text-amber-700 dark:text-amber-400">That's a large export ({selectionCount(dialog.selection)} rows). It may take a few seconds.</p>}
                <p className="text-xs">The file holds what's stored for each prospect: company details, the named contact and where they came from, ICP fit, readiness and its blockers, and the latest dated evidence with its source. Treat it as personal data.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset className="space-y-2"><legend className="text-xs font-semibold">Format</legend>
              <RadioGroup value={format} onValueChange={(v) => setFormat(v as "csv" | "xlsx")}>
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="csv" />CSV (UTF-8)</label>
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="xlsx" />Excel (.xlsx)</label>
              </RadioGroup>
            </fieldset>
            <fieldset className="space-y-2"><legend className="text-xs font-semibold">Columns</legend>
              <RadioGroup value={preset} onValueChange={(v) => setPreset(v as ExportPreset)}>
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="full" />Companies and contacts</label>
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="companies" />Companies only (no named people)</label>
              </RadioGroup>
            </fieldset>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button onClick={() => void runExport()} disabled={busy} data-testid="export-confirm">{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}Export {dialog ? selectionCount(dialog.selection) : ""}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** A text filter that writes to the URL after a pause, not on every key. */
function TextFilter({ value, onChange, placeholder, testId }: { value?: string; onChange: (v: string | undefined) => void; placeholder: string; testId: string }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => { setV(value ?? ""); }, [value]);
  useEffect(() => {
    const t = setTimeout(() => { if ((v.trim() || undefined) !== value) onChange(v.trim() || undefined); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  return <Input value={v} onChange={(e) => setV(e.target.value)} maxLength={80} className="h-8 text-xs" placeholder={placeholder} data-testid={testId} />;
}

function Missing({ label = "Not found" }: { label?: string }) {
  return <span className="text-muted-foreground/70" title={label}>—<span className="sr-only">{label}</span></span>;
}
