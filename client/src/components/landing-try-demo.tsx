/**
 * The "try it" demo, no signup: the whole journey DealInSec runs, in three steps.
 *
 *  1. Find clients: the visitor describes who they want as clients, and sees the profile and the exact web searches
 *     Client Radar would run. It runs in the browser with Client Radar's own rules (shared/icp.ts parseIcpFallback and
 *     searchStrategies): no AI call, no web search, nothing sent or spent. Signing up carries the sentence over
 *     (lib/outbound-prefill.ts) and Client Radar opens on it.
 *  2. Close the deal: the real /api/ai/demo-deal pipeline (server/ai.ts extractDealDraft + the same
 *     analyzeDealProtections() the app uses) turns a pasted reply into a deal and checks what's missing. It writes
 *     nothing; signing up carries the draft over in the same shape create-deal.tsx's takeDealPrefill reads.
 *  3. Get paid: what the app does next with that deal (quotation, agreement, invoice, payment tracking), described
 *     from the deal just read, never with a figure it didn't state.
 *
 * Anything a message doesn't state is shown as "Not specified": the server drops placeholders and the page never fills a gap.
 */
import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, ArrowRight, CheckCircle2, FileCheck, FileText, Loader2, Plus, Radar, ReceiptText, Search, Sparkles, Wallet, X } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import { BRAND_GRADIENT } from "@/components/landing-shared";
import { ProtectionFindings, type Finding } from "@/components/protection-findings";
import { AUDIENCE_INTENT_KEY } from "@/lib/audience-intent";
import { setOutboundPrefill } from "@/lib/outbound-prefill";
import { NOT_SPECIFIED } from "@shared/audience";
import { COUNTRY_NAME, countryLabel, parseIcpFallback, searchStrategies, type Icp } from "@shared/icp";
import { OUTBOUND_ALLOWANCE_DEFAULTS, OUTBOUND_WINDOW_DAYS } from "@shared/outbound-plans";
import { cn } from "@/lib/utils";

type Step = "find" | "close" | "paid";
const STEPS: { value: Step; n: number; label: string; Icon: typeof Radar }[] = [
  { value: "find", n: 1, label: "Find clients", Icon: Radar },
  { value: "close", n: 2, label: "Close the deal", Icon: FileText },
  { value: "paid", n: 3, label: "Get paid", Icon: Wallet },
];

const TARGET_EXAMPLES = [
  "D2C skincare brands in India",
  "Dental clinics in Dubai",
  "SaaS startups in the US with 10–50 employees",
];
const REPLY_EXAMPLE =
  "Thanks for reaching out! We do need a new landing page for our launch. Budget is $1,500 and we need it in two weeks. We can discuss revisions later. Payment after launch.";
const REPLY_PLACEHOLDER = "Thanks for reaching out! We need a landing page for our launch. Budget is $1,500, two weeks, two revisions.";
const MAX_LEN = 600;
const FREE = OUTBOUND_ALLOWANCE_DEFAULTS.free;

interface Flag { id: string; priority: "high" | "attention"; level: Finding["level"]; title: string; detail: string; why: string; ask: string; suggestedTerm?: string }
interface DemoResult {
  draft: { client: string; project: string; amount: number; currency: string; timeline: string; deliverables: string[]; revisions: number | null; advancePercent: number | null; terms: string[] };
  amountLabel: string | null;
  protection: { flags: Flag[]; passes: string[] };
  warning: string | null;
}

const Chip = ({ children, onRemove, label }: { children: React.ReactNode; onRemove?: () => void; label?: string }) => (
  <span className="inline-flex items-center gap-1 rounded-full border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2.5 py-1 text-xs font-medium">
    {children}
    {onRemove && <button type="button" onClick={onRemove} aria-label={`Remove ${label ?? ""}`} className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"><X className="h-3 w-3" /></button>}
  </span>
);

const primaryBtn = "h-10 px-5 rounded-md text-white text-sm font-bold shadow-md shadow-emerald-500/25 disabled:opacity-50 inline-flex items-center justify-center gap-2";
const linkBtn = "text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1";

export function LandingTryDemo() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<Step>("find");
  const [deal, setDeal] = useState<DemoResult | null>(null);
  const started = useRef(false);
  const start = (source: string) => { if (!started.current) { started.current = true; trackEvent("demo_started", { step: source }); } };

  const go = (s: Step) => { setStep(s); trackEvent("demo_step_viewed", { step: s }); };

  return (
    <section id="try" className="py-16 sm:py-20 scroll-mt-20">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8">
          <p className="text-xs uppercase tracking-widest font-semibold text-emerald-600 dark:text-emerald-400 mb-3">Try it — no account needed</p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-balance">Find a client, close the deal, get paid.</h2>
          <p className="text-base text-neutral-600 dark:text-neutral-400 mt-2">Walk through what DealInSec does, step by step. Free, no signup.</p>
        </div>

        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xl shadow-emerald-900/5 overflow-hidden">
          <div className="h-1.5" style={{ background: BRAND_GRADIENT }} />
          <div role="tablist" aria-label="Demo steps" className="grid grid-cols-3 border-b border-neutral-200 dark:border-neutral-800">
            {STEPS.map(({ value, n, label, Icon }) => {
              const on = value === step;
              return (
                <button key={value} type="button" role="tab" aria-selected={on} aria-controls={`demo-panel-${value}`} id={`demo-tab-${value}`}
                  onClick={() => go(value)} data-testid={`demo-step-${value}`}
                  className={cn("flex items-center justify-center gap-2 px-2 py-3 text-xs sm:text-sm font-semibold transition-colors border-b-2 -mb-px",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500",
                    on ? "border-emerald-600 text-emerald-800 dark:text-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/30" : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200")}>
                  <span className={cn("hidden sm:inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px]", on ? "bg-emerald-600 text-white" : "bg-neutral-200 dark:bg-neutral-800")}>{n}</span>
                  <Icon className="h-4 w-4 sm:hidden" aria-hidden />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>

          <div className="p-5 sm:p-6" role="tabpanel" id={`demo-panel-${step}`} aria-labelledby={`demo-tab-${step}`}>
            {step === "find" && <FindClients onStart={() => start("find")} onNext={() => go("close")} onSignup={(request) => {
              setOutboundPrefill(request);
              try { sessionStorage.setItem(AUDIENCE_INTENT_KEY, "client_work"); } catch { /* onboarding just asks */ }
              trackEvent("signup_from_demo", { step: "find" });
              setLocation("/auth?mode=signup");
            }} />}
            {step === "close" && <CloseDeal result={deal} onResult={setDeal} onStart={() => start("close")} onNext={() => go("paid")} />}
            {step === "paid" && <GetPaid deal={deal} onBack={() => go("close")} />}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── 1. Find clients ─────────────────────────────────────────────────────── */

function FindClients({ onStart, onNext, onSignup }: { onStart: () => void; onNext: () => void; onSignup: (request: string) => void }) {
  const [text, setText] = useState("");
  const [icp, setIcp] = useState<Icp | null>(null);
  const [unclear, setUnclear] = useState(false);
  const [place, setPlace] = useState("");

  const plan = (input: string) => {
    const t = input.trim();
    if (t.length < 3) return;
    onStart();
    const parsed = parseIcpFallback(t);
    setIcp(parsed);
    setUnclear(!parsed);
    trackEvent("demo_outbound_planned", { understood: !!parsed });
  };
  const edit = (patch: Partial<Icp>) => setIcp((i) => (i ? { ...i, ...patch } : i));
  const addPlace = () => {
    const v = place.replace(/\s+/g, " ").trim().slice(0, 60);
    setPlace("");
    if (!v || !icp) return;
    const code = Object.entries(COUNTRY_NAME).find(([, name]) => name.toLowerCase() === v.toLowerCase())?.[0]
      ?? (/^[A-Za-z]{2}$/.test(v) && COUNTRY_NAME[v.toUpperCase()] ? v.toUpperCase() : null);
    if (code) { if (!icp.countries.includes(code) && icp.countries.length < 5) edit({ countries: [...icp.countries, code] }); }
    else if (!icp.locations.includes(v) && icp.locations.length < 5) edit({ locations: [...icp.locations, v] });
  };
  const searches = icp ? searchStrategies(icp) : [];
  const size = icp && (icp.employeeMin || icp.employeeMax)
    ? icp.employeeMin && icp.employeeMax ? `${icp.employeeMin}–${icp.employeeMax} people` : icp.employeeMax ? `up to ${icp.employeeMax} people` : `${icp.employeeMin}+ people`
    : null;

  return (
    <div>
      <label htmlFor="demo-target" className="text-sm font-semibold">Who do you want as clients?</label>
      <p className="text-xs text-neutral-500 mt-0.5 mb-2">The kind of business, and where. Client Radar researches real companies that fit.</p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input id="demo-target" value={text} onChange={(e) => setText(e.target.value.slice(0, 200))} onKeyDown={(e) => { if (e.key === "Enter") plan(text); }}
          placeholder="e.g. D2C skincare brands in India" data-testid="demo-target"
          className="flex-1 h-11 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-3.5 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 placeholder:text-neutral-400" />
        <button type="button" onClick={() => plan(text)} disabled={text.trim().length < 3} data-testid="demo-plan" className={cn(primaryBtn, "h-11")} style={{ background: BRAND_GRADIENT }}>
          <Search className="w-4 h-4" /> Plan the search
        </button>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {TARGET_EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => { setText(ex); plan(ex); }} data-testid="demo-target-example"
            className="rounded-full border border-dashed border-neutral-300 dark:border-neutral-700 px-2.5 py-1 text-xs text-neutral-600 dark:text-neutral-400 hover:border-emerald-400 hover:text-emerald-700">
            {ex}
          </button>
        ))}
      </div>
      {unclear && <p className="text-xs text-rose-600 mt-2">Name the kind of business you want, for example "dental clinics" or "D2C skincare brands".</p>}

      {icp && (
        <div className="mt-6 pt-6 border-t border-neutral-200 dark:border-neutral-800 space-y-5" data-testid="demo-plan-result">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-2">Your ideal client</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip>{icp.industry}</Chip>
              {size && <Chip>{size}</Chip>}
              {icp.targetMarket.map((m) => <Chip key={m}>serves {m}</Chip>)}
              {icp.countries.map((c) => <Chip key={c} label={countryLabel(c)} onRemove={() => edit({ countries: icp.countries.filter((x) => x !== c) })}>{countryLabel(c)}</Chip>)}
              {icp.locations.map((l) => <Chip key={l} label={l} onRemove={() => edit({ locations: icp.locations.filter((x) => x !== l) })}>{l}</Chip>)}
              {!icp.countries.length && !icp.locations.length && <Chip>Worldwide</Chip>}
              <span className="inline-flex items-center gap-1">
                <input value={place} onChange={(e) => setPlace(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addPlace(); }}
                  placeholder="Add a country or city" aria-label="Add a country or city" data-testid="demo-add-place"
                  className="h-7 w-40 rounded-full border border-neutral-300 dark:border-neutral-700 bg-transparent px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40" />
                <button type="button" onClick={addPlace} aria-label="Add place" className="text-emerald-700 dark:text-emerald-400"><Plus className="h-4 w-4" /></button>
              </span>
            </div>
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-2">Client Radar would search the web for</p>
            <ol className="space-y-1 text-sm" data-testid="demo-searches">
              {searches.map((q, i) => (
                <li key={q} className="flex items-start gap-2"><span className="text-xs text-neutral-400 tabular-nums mt-0.5 w-4">{i + 1}.</span><span className="font-medium">{q}</span></li>
              ))}
            </ol>
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-2">Then, for each company it finds</p>
            <ul className="grid sm:grid-cols-2 gap-2 text-sm">
              {[
                "Checks the company's own website against your ideal client",
                "Looks for recent, dated reasons to reach out now",
                "Finds named decision makers where they're public",
                "Scores each one 0–100, every fact with its source and date",
              ].map((t) => <li key={t} className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />{t}</li>)}
            </ul>
            <p className="text-xs text-neutral-500 mt-2.5">Nothing is contacted until you approve a message, and you send it from your own email.</p>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-1">
            <button type="button" onClick={() => onSignup(text.trim())} data-testid="demo-run-search" className={cn(primaryBtn, "h-11 px-6")} style={{ background: BRAND_GRADIENT }}>
              Run this search free <ArrowRight className="w-4 h-4" />
            </button>
            <p className="text-xs text-neutral-500">The free plan includes {FREE.monthlySearches} searches every {OUTBOUND_WINDOW_DAYS} days, no card. Your target carries over.</p>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[11px] text-neutral-500">This preview runs in your browser with no AI and sends nothing. In the app, AI reads more detail (company size, who they serve, who to contact) and runs the search for real.</p>
            <button type="button" onClick={onNext} className={linkBtn} data-testid="demo-next-close">A company replies — next step <ArrowRight className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 2. Close the deal ───────────────────────────────────────────────────── */

function CloseDeal({ result, onResult, onStart, onNext }: { result: DemoResult | null; onResult: (r: DemoResult) => void; onStart: () => void; onNext: () => void }) {
  const [, setLocation] = useLocation();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    onStart();
    trackEvent("ai_deal_analysis_started", { audience: "client_work" });
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/demo-deal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed, audience: "client_work" }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error || "Couldn't read that — try again."); return; }
      onResult(data);
      trackEvent("demo_completed", { audience: "client_work" });
      trackEvent("anonymous_draft_created", { audience: "client_work" });
      trackEvent("ai_deal_analysis_completed", { audience: "client_work" });
      if (data.protection?.flags?.length) trackEvent("protection_check_viewed", { flags: data.protection.flags.length, audience: "client_work" });
    } catch {
      setError("Couldn't reach the server — please try again.");
    } finally {
      setBusy(false);
    }
  };

  const createAccount = () => {
    if (!result) return;
    const d = result.draft;
    const today = new Date();
    const end = new Date(today.getTime() + 14 * 86_400_000);
    try {
      sessionStorage.setItem(
        "dis_deal_prefill",
        JSON.stringify({
          brandName: d.client || "",
          dealTitle: d.project,
          // "Custom" opens the form straight on the review step instead of the type picker: the demo never asked what
          // KIND of work this is, and making the visitor pick one now is the "start over" friction this handoff avoids.
          dealType: "Custom",
          dealAmount: d.amount || undefined,
          startDate: today.toISOString().slice(0, 10),
          endDate: end.toISOString().slice(0, 10),
          customTerms: d.terms.join("\n"),
        }),
      );
      sessionStorage.setItem(AUDIENCE_INTENT_KEY, "client_work");
    } catch { /* private-mode browsers: signup still works, just without the prefill */ }
    trackEvent("signup_from_demo", { step: "close" });
    setLocation("/auth?mode=signup");
  };

  const findings: Finding[] = (result?.protection.flags ?? []).map((f) => ({ id: f.id, level: f.level, title: f.title, why: f.why, ask: f.ask, suggestedTerm: f.suggestedTerm }));

  return (
    <div>
      <label htmlFor="demo-reply" className="text-sm font-semibold">A prospect replied. Paste their message.</label>
      <p className="text-xs text-neutral-500 mt-0.5 mb-2">We'll turn it into a deal and check what's missing before you agree.</p>
      <textarea id="demo-reply" value={text} onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))} placeholder={REPLY_PLACEHOLDER} rows={3} maxLength={MAX_LEN}
        data-testid="demo-textarea"
        className="w-full resize-none rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent p-3.5 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 placeholder:text-neutral-400" />
      <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
        <button type="button" onClick={() => { setText(REPLY_EXAMPLE); trackEvent("demo_open", { source: "example", step: "close" }); run(REPLY_EXAMPLE); }} data-testid="demo-try-example" className={linkBtn}>
          Try an example instead
        </button>
        <button type="button" disabled={!text.trim() || busy} onClick={() => run(text)} data-testid="demo-submit" className={primaryBtn} style={{ background: BRAND_GRADIENT }}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {busy ? "Reading…" : "See the deal"}
        </button>
      </div>
      {error && <p className="text-xs text-rose-600 mt-2">{error}</p>}
      <p className="mt-3 text-[11px] text-neutral-500">
        Pressing “See the deal” sends what you pasted to an AI service to read it. DealInSec doesn't store it. Prefer no AI?{" "}
        <a href="/tools/deal-risk-checker" className="font-semibold text-emerald-700 dark:text-emerald-400 hover:underline">The free Deal Risk Checker runs in your browser.</a>
      </p>

      {result && (
        <div className="mt-6 pt-6 border-t border-neutral-200 dark:border-neutral-800 space-y-5" data-testid="demo-result">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-2">Deal detected</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
              <div><span className="text-neutral-500">Client: </span><span className="font-semibold">{result.draft.client || <span className="font-normal text-neutral-500">{NOT_SPECIFIED}</span>}</span></div>
              <div><span className="text-neutral-500">Project: </span><span className="font-semibold">{result.draft.project}</span></div>
              <div><span className="text-neutral-500">Budget: </span>{result.amountLabel ? <span className="font-semibold tabular-nums">{result.amountLabel}</span> : <span className="text-neutral-500">{NOT_SPECIFIED}</span>}</div>
              <div><span className="text-neutral-500">Timeline: </span>{result.draft.timeline ? <span className="font-semibold">{result.draft.timeline}</span> : <span className="text-neutral-500">{NOT_SPECIFIED}</span>}</div>
              {result.draft.revisions != null && <div><span className="text-neutral-500">Revisions: </span><span className="font-semibold">{result.draft.revisions}</span></div>}
              {result.draft.advancePercent != null && <div><span className="text-neutral-500">Advance: </span><span className="font-semibold">{result.draft.advancePercent}%</span></div>}
            </div>
            {result.warning && <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400 mt-2.5"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {result.warning}</p>}
          </div>

          <ProtectionFindings findings={findings} passes={result.protection.passes} />

          <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
            <button type="button" onClick={createAccount} data-testid="demo-create-account" className={cn(primaryBtn, "w-full sm:w-auto h-11 px-6")} style={{ background: BRAND_GRADIENT }}>
              Create your free account <ArrowRight className="w-4 h-4" />
            </button>
            <p className="text-xs text-neutral-500">This exact draft carries over — nothing to retype.</p>
          </div>
          <div className="text-right"><button type="button" onClick={onNext} className={linkBtn} data-testid="demo-next-paid">Next: get paid <ArrowRight className="w-3.5 h-3.5" /></button></div>
        </div>
      )}
    </div>
  );
}

/* ── 3. Get paid ─────────────────────────────────────────────────────────── */

function GetPaid({ deal, onBack }: { deal: DemoResult | null; onBack: () => void }) {
  const d = deal?.draft;
  const project = d?.project || "your project";
  const amount = deal?.amountLabel ?? null;
  const steps = [
    { Icon: FileText, title: "Quotation", text: `A professional quotation for ${project}${amount ? ` at ${amount}` : ""}, with a link your client opens and accepts online.` },
    { Icon: FileCheck, title: "Agreement", text: "Drawn from the deal with your terms (scope, revisions, advance, ownership), and a link your client signs online." },
    { Icon: ReceiptText, title: "Invoice", text: d?.advancePercent ? `Split into a ${d.advancePercent}% advance and a final payment, straight from the agreement.` : "Single, or split into an advance and a final payment, straight from the agreement." },
    { Icon: Wallet, title: "Payment tracking", text: "Mark it paid and see what's paid, pending and overdue. A follow-up message is drafted for anything late." },
  ];
  return (
    <div data-testid="demo-paid">
      <p className="text-sm font-semibold">{deal ? `What happens next with ${project}` : "What happens after a client says yes"}</p>
      <p className="text-xs text-neutral-500 mt-0.5 mb-4">One deal carries through every document, so nothing is typed twice.</p>
      <ol className="space-y-3">
        {steps.map(({ Icon, title, text }, i) => (
          <li key={title} className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400"><Icon className="h-4 w-4" /></span>
            <div>
              <p className="text-sm font-semibold"><span className="text-neutral-400 tabular-nums mr-1">{i + 1}.</span>{title}</p>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">{text}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-[11px] text-neutral-500 mt-4">DealInSec records payments; it never collects or moves your clients' money. Agreements, invoices and payment tracking are part of Pro.</p>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mt-5">
        <a href="/auth?mode=signup" onClick={() => trackEvent("signup_from_demo", { step: "paid" })} data-testid="demo-paid-signup" className={cn(primaryBtn, "h-11 px-6")} style={{ background: BRAND_GRADIENT }}>
          Start free <ArrowRight className="w-4 h-4" />
        </a>
        {!deal && <button type="button" onClick={onBack} className={linkBtn}>Try it with a real reply first</button>}
      </div>
    </div>
  );
}
