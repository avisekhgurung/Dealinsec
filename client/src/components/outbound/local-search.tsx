/**
 * Local businesses in a city ("dentists in Siliguri"), from Google Maps listings (POST /api/outbound/local/search).
 *
 * The listings are shown here and held only in this component's memory: DealInSec doesn't store them (Google's terms;
 * shared/local-discovery.ts). From a listing the person can
 *   - have DealInSec research the website it gives (the normal research, from the site itself), or
 *   - save it to Leads under a name they type, with a link back to the listing (only the place ID is kept).
 * Every result is attributed to Google Maps; a missing website is an observation about the listing, never a verdict.
 */
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { ExternalLink, Globe, Loader2, MapPin, Phone, Search, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useUpgradeModal } from "@/components/upgrade-modal";
import { trackEvent } from "@/lib/analytics";
import { isUpgradeError, parseApiError } from "@/lib/api-error";
import { leadCall, leadError, refreshLeads } from "@/lib/leads";
import { COUNTRY_NAME, OUTBOUND_RUNS_URL } from "@/lib/outbound";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { NO_WEBSITE_NOTE, WEBSITE_FILTERS, type LocalResult, type WebsiteFilter } from "@shared/local-discovery";
import { OUTBOUND_USAGE_URL } from "./usage-note";

export const LOCAL_SEARCH_URL = "/api/outbound/local/search";
export const LOCAL_RESEARCH_URL = "/api/outbound/local/research";
export const LOCAL_LEAD_URL = "/api/outbound/local/lead";

export interface LocalFields { category: string; city: string; country: string; website: WebsiteFilter; max: number }

const WEBSITE_LABEL: Record<WebsiteFilter, string> = { any: "Any", with: "Website listed", without: "No website listed" };
const STATUS_LABEL: Record<string, string> = { CLOSED_TEMPORARILY: "Temporarily closed (per the listing)", CLOSED_PERMANENTLY: "Permanently closed (per the listing)" };

/** The required attribution: the words "Google Maps", unchanged and untranslated. */
function GoogleMapsAttribution({ className }: { className?: string }) {
  return <span className={cn("text-xs text-muted-foreground", className)} data-testid="google-maps-attribution">Listings from <span translate="no" className="font-medium text-foreground/80">Google Maps</span></span>;
}

export function LocalSearch({ fields, onChange, blocked, maxCompanies, onResearchStarted }: {
  fields: LocalFields; onChange: (f: LocalFields) => void; blocked: string | null; maxCompanies: number;
  onResearchStarted: (runId: string) => void;
}) {
  const { toast } = useToast();
  const { openUpgradeModal } = useUpgradeModal();
  // The current listings: memory only, replaced by the next search, gone when the page closes.
  const [results, setResults] = useState<LocalResult[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [naming, setNaming] = useState<{ placeId: string; name: string } | null>(null);
  const [saved, setSaved] = useState<Record<string, number>>({});
  const set = (patch: Partial<LocalFields>) => onChange({ ...fields, ...patch });
  const refusal = (title: string) => (e: unknown) => {
    if (isUpgradeError(parseApiError(e))) openUpgradeModal({ feature: "outbound" });
    else toast({ title, description: leadError(e), variant: "destructive" });
    void queryClient.invalidateQueries({ queryKey: [OUTBOUND_USAGE_URL] });
  };

  const search = useMutation({
    mutationFn: () => leadCall<{ runId: string; results: LocalResult[] }>("POST", LOCAL_SEARCH_URL, fields),
    onSuccess: (r) => {
      // Counts only: never the business type, the city or a listing.
      trackEvent("outbound_local_search", { results: r.results.length, website: fields.website });
      setResults(r.results); setPicked(new Set()); setNaming(null);
      void queryClient.invalidateQueries({ queryKey: [OUTBOUND_USAGE_URL] });
    },
    onError: refusal("Couldn't search local businesses"),
  });
  const research = useMutation({
    mutationFn: () => leadCall<{ runId: string; queued: number; skipped: number }>("POST", LOCAL_RESEARCH_URL, {
      category: fields.category, city: fields.city, country: fields.country,
      places: (results ?? []).filter((r) => picked.has(r.placeId) && r.website).map((r) => ({ placeId: r.placeId, website: r.website! })),
    }),
    onSuccess: (r) => {
      trackEvent("outbound_local_research", { queued: r.queued });
      if (r.skipped) toast({ title: `Researching ${r.queued} website${r.queued === 1 ? "" : "s"}`, description: `${r.skipped} more didn't fit in what's left of your plan's researched prospects.` });
      void queryClient.invalidateQueries({ queryKey: [OUTBOUND_RUNS_URL] }); void queryClient.invalidateQueries({ queryKey: [OUTBOUND_USAGE_URL] });
      setPicked(new Set());
      onResearchStarted(r.runId);
    },
    onError: refusal("Couldn't start the research"),
  });
  const saveLead = useMutation({
    mutationFn: (v: { placeId: string; companyName: string }) => leadCall<{ leadId: number; existing: boolean }>("POST", LOCAL_LEAD_URL, { ...v, location: fields.city }),
    onSuccess: (r, v) => {
      trackEvent("outbound_local_lead", { existing: r.existing });
      setSaved((s) => ({ ...s, [v.placeId]: r.leadId })); setNaming(null); refreshLeads();
      toast({ title: r.existing ? "Already in your leads" : "Saved to Leads", description: r.existing ? undefined : "With a link to the Google Maps listing. Nothing is sent." });
    },
    onError: (e) => toast({ title: "Couldn't save the lead", description: leadError(e), variant: "destructive" }),
  });

  const researchable = (results ?? []).filter((r) => r.website && !r.existing?.prospectId);
  const pickLimit = Math.max(1, maxCompanies);
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else if (n.size < pickLimit) n.add(id); return n; });
  const ready = fields.category.trim().length >= 2 && fields.city.trim().length >= 2;
  const field = "h-10 w-full rounded-md border bg-background px-3 text-sm";

  return (
    <div className="space-y-3" data-testid="local-search">
      <form className="grid grid-cols-2 gap-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto] lg:items-end"
        onSubmit={(e) => { e.preventDefault(); if (ready && !blocked && !search.isPending) search.mutate(); }}>
        <label className="col-span-2 flex min-w-0 flex-col gap-1 text-xs font-medium sm:col-span-1">Type of business
          <Input value={fields.category} onChange={(e) => set({ category: e.target.value })} maxLength={80} placeholder="dentists" className="h-10" data-testid="local-category" />
        </label>
        <label className="col-span-2 flex min-w-0 flex-col gap-1 text-xs font-medium sm:col-span-1">City or area
          <Input value={fields.city} onChange={(e) => set({ city: e.target.value })} maxLength={60} placeholder="Siliguri" className="h-10" data-testid="local-city" />
        </label>
        <label className="col-span-2 flex min-w-0 flex-col gap-1 text-xs font-medium sm:col-span-1">Country
          <select value={fields.country} onChange={(e) => set({ country: e.target.value })} className={field} data-testid="local-country">
            {Object.entries(COUNTRY_NAME).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs font-medium">Website
          <select value={fields.website} onChange={(e) => set({ website: e.target.value as WebsiteFilter })} className={field} data-testid="local-website">
            {WEBSITE_FILTERS.map((w) => <option key={w} value={w}>{WEBSITE_LABEL[w]}</option>)}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs font-medium">Show up to
          <select value={fields.max} onChange={(e) => set({ max: Number(e.target.value) })} className={cn(field, "lg:w-20")} data-testid="local-max">
            {[5, 10, 20].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <Button type="submit" disabled={!ready || !!blocked || search.isPending} className="gradient-btn col-span-2 h-10 self-end text-white sm:col-span-1" data-testid="local-find">
          {search.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}Find local businesses
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">One search uses one AI Outbound search credit. Listings are shown, not saved: research a website or save a business to Leads to keep it. Nobody is contacted.</p>

      {search.isPending && <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-hidden>{Array.from({ length: 6 }, (_, i) => <li key={i} className="h-28 animate-pulse rounded-xl border bg-muted/40" />)}</ul>}

      {results && !search.isPending && (
        <section className="space-y-2" aria-label="Local businesses found" data-testid="local-results">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">{results.length ? `${results.length} listing${results.length === 1 ? "" : "s"} for ${fields.category} in ${fields.city}` : "No listings matched"}</p>
            <GoogleMapsAttribution />
          </div>
          {!results.length && <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Nothing matched that search. Try a broader type of business, a nearby city, or Website: "Any".</p>}
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" data-testid="local-cards">
            {results.map((r) => {
              const leadId = saved[r.placeId] ?? r.existing?.leadId;
              const canPick = !!r.website && !r.existing?.prospectId;
              return (
                <li key={r.placeId} className={cn("flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-3", picked.has(r.placeId) && "border-emerald-500 ring-1 ring-emerald-500/40")} data-testid="local-card">
                  <div className="flex min-w-0 items-start gap-2">
                    {canPick && <Checkbox checked={picked.has(r.placeId)} onCheckedChange={() => toggle(r.placeId)} aria-label={`Research ${r.name}'s website`} className="mt-0.5" data-testid="local-pick" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium" title={r.name}>{r.name}</p>
                      {r.category && <p className="truncate text-xs text-muted-foreground">{r.category}</p>}
                    </div>
                  </div>
                  {r.address && <p className="flex min-w-0 items-start gap-1.5 text-xs text-muted-foreground"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /><span className="line-clamp-2">{r.address}</span></p>}
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {r.website ? <a href={r.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-w-0 items-center gap-1 text-emerald-700 hover:underline dark:text-emerald-400"><Globe className="h-3.5 w-3.5 shrink-0" aria-hidden /><span className="truncate">{r.domain ?? "Website"}</span></a>
                      : <span className="text-muted-foreground" title={NO_WEBSITE_NOTE} data-testid="local-no-website">No website listed</span>}
                    {r.phone && <a href={`tel:${r.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><Phone className="h-3.5 w-3.5" aria-hidden />{r.phone}</a>}
                  </div>
                  {r.status && STATUS_LABEL[r.status] && <p className="text-xs font-medium text-amber-700 dark:text-amber-400">{STATUS_LABEL[r.status]}</p>}
                  {!r.website && <p className="text-[11px] leading-snug text-muted-foreground">{NO_WEBSITE_NOTE}</p>}
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                    <a href={r.mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1 rounded-md border px-2.5 text-xs hover:bg-muted" data-testid="local-maps-link"><ExternalLink className="h-3.5 w-3.5" aria-hidden />Open in Google Maps</a>
                    {r.existing?.prospectId && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800 dark:bg-sky-950/50 dark:text-sky-300" data-testid="local-existing-prospect">Already researched</span>}
                    {leadId ? <Link href={`/leads/${leadId}`} className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 hover:underline dark:bg-emerald-950/50 dark:text-emerald-300" data-testid="local-existing-lead">In Leads</Link>
                      : naming?.placeId !== r.placeId && <Button type="button" variant="ghost" size="sm" className="h-9 px-2.5 text-xs" onClick={() => setNaming({ placeId: r.placeId, name: "" })} data-testid="local-save-lead"><UserPlus className="mr-1 h-3.5 w-3.5" />Save to Leads</Button>}
                  </div>
                  {naming?.placeId === r.placeId && !leadId && (
                    <form className="space-y-1.5 rounded-lg border bg-muted/30 p-2" onSubmit={(e) => { e.preventDefault(); if (naming.name.trim().length >= 2) saveLead.mutate({ placeId: r.placeId, companyName: naming.name }); }}>
                      <label className="block text-xs font-medium" htmlFor={`name-${r.placeId}`}>Name for this lead</label>
                      <div className="flex gap-2">
                        <Input id={`name-${r.placeId}`} autoFocus value={naming.name} onChange={(e) => setNaming({ placeId: r.placeId, name: e.target.value })} maxLength={120} placeholder="Type the business name" className="h-9 min-w-0 flex-1 text-sm" data-testid="local-lead-name" />
                        <Button type="submit" size="sm" className="h-9" disabled={naming.name.trim().length < 2 || saveLead.isPending} data-testid="local-lead-save">{saveLead.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}</Button>
                      </div>
                      <p className="text-[11px] text-muted-foreground">You type the name: listings aren't copied into DealInSec. The lead keeps a link to this listing.</p>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
          {researchable.length > 0 && (
            <div className="sticky bottom-20 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur lg:bottom-4" data-testid="local-research-bar">
              <p className="text-xs text-muted-foreground">{picked.size ? `${picked.size} selected. ` : ""}DealInSec reads each website itself and checks it against your search, with evidence. Uses your researched prospects (up to {pickLimit} at a time).</p>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => setPicked(new Set(researchable.slice(0, pickLimit).map((r) => r.placeId)))}>Select {Math.min(pickLimit, researchable.length)} with websites</Button>
                <Button type="button" size="sm" className="gradient-btn h-9 text-white" disabled={!picked.size || research.isPending} onClick={() => research.mutate()} data-testid="local-research">
                  {research.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Research {picked.size || ""} selected website{picked.size === 1 ? "" : "s"}
                </Button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
