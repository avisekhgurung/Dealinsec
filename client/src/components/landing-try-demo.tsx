/**
 * The "try it" demo — no signup, no session, the real Protection Check.
 *
 * This calls the actual /api/ai/demo-deal pipeline (server/ai.ts extractDealDraft
 * + the same analyzeDealProtections() the authenticated chat-to-deal flow uses),
 * not a scripted mockup. It writes nothing to any database. The only thing that
 * survives past this component is, if the visitor clicks through to sign up, a
 * sessionStorage draft in the SAME shape/key the authenticated Copilot→create-deal
 * handoff already uses (client/src/pages/create-deal.tsx's takeDealPrefill), so
 * signup literally continues the same draft instead of starting over.
 *
 * The visitor says which kind of message it is (client work or a brand offer);
 * that is never inferred. Anything the message does not state is shown as "Not
 * specified" — the server drops placeholders and the page never fills a gap.
 */
import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, ArrowRight, Briefcase, Clapperboard, Loader2, Sparkles } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import { BRAND_GRADIENT } from "@/components/landing-shared";
import { ProtectionFindings, type Finding } from "@/components/protection-findings";
import { AUDIENCE_INTENT_KEY } from "@/lib/audience-intent";
import { BRAND_TERM_LABELS, NOT_SPECIFIED, type Audience, type BrandTerms } from "@shared/audience";
import { cn } from "@/lib/utils";

const EXAMPLES: Record<Audience, string> = {
  client_work:
    "Hey Sam, I need a landing page for my startup. Budget is $1500. Need it in two weeks. We can discuss revisions later. Payment after launch.",
  brand_collaboration:
    "Hey! We'd love 2 Instagram Reels and 3 stories for $800. We'd also like to use the content for ads. Payment after posting.",
};

const PLACEHOLDERS: Record<Audience, string> = {
  client_work: "Hey, I need a landing page for my SaaS. Budget is $1,500. Need it in two weeks. Two revisions.",
  brand_collaboration: "Hey! We'd love 2 Reels and 3 stories for $800, and we'd like to use the content for ads.",
};

const MAX_LEN = 600;

interface Flag {
  id: string;
  priority: "high" | "attention";
  level: Finding["level"];
  title: string;
  detail: string;
  why: string;
  ask: string;
  suggestedTerm?: string;
}
interface DemoResult {
  draft: {
    client: string; project: string; amount: number; currency: string; timeline: string;
    deliverables: string[]; revisions: number | null; advancePercent: number | null; terms: string[];
    brandTerms?: BrandTerms | null; platforms?: string[];
  };
  amountLabel: string | null;
  protection: { flags: Flag[]; passes: string[] };
  audience?: Audience;
  warning: string | null;
}

const KINDS: { value: Audience; label: string; Icon: typeof Briefcase }[] = [
  { value: "client_work", label: "Client work", Icon: Briefcase },
  { value: "brand_collaboration", label: "Brand collaboration", Icon: Clapperboard },
];

export function LandingTryDemo() {
  const [, setLocation] = useLocation();
  const [audience, setAudience] = useState<Audience>("client_work");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DemoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const brand = audience === "brand_collaboration";

  const run = async (input: string, kind: Audience = audience) => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    if (!started.current) {
      started.current = true;
      trackEvent("demo_started", { audience: kind });
    }
    trackEvent("ai_deal_analysis_started", { audience: kind });
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/demo-deal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed, audience: kind }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Couldn't read that — try again.");
        return;
      }
      setResult(data);
      trackEvent("demo_completed", { audience: kind });
      trackEvent("anonymous_draft_created", { audience: kind });
      trackEvent("ai_deal_analysis_completed", { audience: kind });
      if (data.protection?.flags?.length) {
        trackEvent("protection_check_viewed", { flags: data.protection.flags.length, audience: kind });
      }
    } catch {
      setError("Couldn't reach the server — please try again.");
    } finally {
      setBusy(false);
    }
  };

  const chooseKind = (kind: Audience) => {
    if (kind === audience) return;
    setAudience(kind);
    // A result for the other kind of deal would read wrongly under the new choice.
    setResult(null);
    setError(null);
  };

  const tryExample = () => {
    setText(EXAMPLES[audience]);
    trackEvent("demo_open", { source: "example", audience });
    run(EXAMPLES[audience]);
  };

  const createAccount = () => {
    if (!result) return;
    const d = result.draft;
    const today = new Date();
    const end = new Date(today.getTime() + 14 * 86_400_000);
    const platform = brand ? d.platforms?.[0] || "Service" : "Service";
    try {
      sessionStorage.setItem(
        "dis_deal_prefill",
        JSON.stringify({
          brandName: d.client || "",
          dealTitle: d.project,
          // A brand offer lands on the Brand Collaboration form. Client work
          // stays "Custom" so the form opens straight to the review step instead
          // of the type picker — the demo never asked what KIND of work this is,
          // and making the visitor pick one now would be exactly the "start
          // over" friction this whole handoff exists to avoid.
          dealType: brand ? "Brand Collaboration" : "Custom",
          dealAmount: d.amount || undefined,
          startDate: today.toISOString().slice(0, 10),
          endDate: end.toISOString().slice(0, 10),
          customTerms: d.terms.join("\n"),
          ...(brand && d.brandTerms ? { brandTerms: d.brandTerms } : {}),
          deliverables: d.deliverables.length
            ? d.deliverables.map((label) => ({ platform, contentType: label, quantity: 1, frequency: "One-time", notes: "" }))
            : undefined,
        }),
      );
      // Onboarding preselects the same work type, so the visitor isn't asked again.
      sessionStorage.setItem(AUDIENCE_INTENT_KEY, audience);
    } catch { /* private-mode browsers: signup still works, just without the prefill */ }
    trackEvent("signup_from_demo", { audience });
    setLocation("/auth?mode=signup");
  };

  const findings: Finding[] = (result?.protection.flags ?? []).map((f) => ({
    id: f.id, level: f.level, title: f.title, why: f.why, ask: f.ask, suggestedTerm: f.suggestedTerm,
  }));

  return (
    <section id="try" className="py-16 sm:py-20 scroll-mt-20">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8">
          <p className="text-xs uppercase tracking-widest font-semibold text-emerald-600 dark:text-emerald-400 mb-3">Try it — no account needed</p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-balance">Paste a client or brand message.</h2>
          <p className="text-base text-neutral-600 dark:text-neutral-400 mt-2">We'll turn it into a deal and check what's missing — free, no signup.</p>
        </div>

        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xl shadow-emerald-900/5 overflow-hidden">
          <div className="h-1.5" style={{ background: BRAND_GRADIENT }} />
          <div className="p-5 sm:p-6">
            <div role="radiogroup" aria-label="What kind of deal is this?" className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-neutral-500 mr-1">What kind of deal is this?</span>
              {KINDS.map(({ value, label, Icon }) => {
                const on = value === audience;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => chooseKind(value)}
                    data-testid={`demo-kind-${value}`}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
                      on
                        ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                        : "border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:border-emerald-300",
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" aria-hidden /> {label}
                  </button>
                );
              })}
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
              onFocus={() => { if (!started.current) { started.current = true; trackEvent("demo_open", { source: "textarea", audience }); } }}
              placeholder={PLACEHOLDERS[audience]}
              rows={3}
              maxLength={MAX_LEN}
              aria-label={brand ? "Paste a brand message" : "Paste a client message"}
              data-testid="demo-textarea"
              className="w-full resize-none rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent p-3.5 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 placeholder:text-neutral-400"
            />
            <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
              <button
                type="button"
                onClick={tryExample}
                data-testid="demo-try-example"
                className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
              >
                Try an example instead
              </button>
              <button
                type="button"
                disabled={!text.trim() || busy}
                onClick={() => run(text)}
                data-testid="demo-submit"
                className="h-10 px-5 rounded-md text-white text-sm font-bold shadow-md shadow-emerald-500/25 disabled:opacity-50 inline-flex items-center gap-2"
                style={{ background: BRAND_GRADIENT }}
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {busy ? "Reading…" : "See the deal"}
              </button>
            </div>
            {error && <p className="text-xs text-rose-600 mt-2">{error}</p>}
            <p className="mt-3 text-[11px] text-neutral-500">
              Pressing “See the deal” sends what you pasted to an AI service to read it. DealInSec doesn't store it. Prefer no AI?{" "}
              <a href="/tools/deal-risk-checker" className="font-semibold text-emerald-700 dark:text-emerald-400 hover:underline">
                The free Deal Risk Checker runs in your browser.
              </a>
            </p>

            {result && (
              <div className="mt-6 pt-6 border-t border-neutral-200 dark:border-neutral-800 space-y-5" data-testid="demo-result">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-2">Deal detected</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                    <div>
                      <span className="text-neutral-500">{brand ? "Brand" : "Client"}: </span>
                      <span className="font-semibold">{result.draft.client || <span className="font-normal text-neutral-500">{NOT_SPECIFIED}</span>}</span>
                    </div>
                    <div><span className="text-neutral-500">{brand ? "Campaign" : "Project"}: </span><span className="font-semibold">{result.draft.project}</span></div>
                    <div>
                      <span className="text-neutral-500">{brand ? "Fee" : "Budget"}: </span>
                      {result.amountLabel ? <span className="font-semibold tabular-nums">{result.amountLabel}</span> : <span className="text-neutral-500">{NOT_SPECIFIED}</span>}
                    </div>
                    <div>
                      <span className="text-neutral-500">Timeline: </span>
                      {result.draft.timeline ? <span className="font-semibold">{result.draft.timeline}</span> : <span className="text-neutral-500">{NOT_SPECIFIED}</span>}
                    </div>
                    {result.draft.revisions != null && <div><span className="text-neutral-500">Revisions: </span><span className="font-semibold">{result.draft.revisions}</span></div>}
                    {result.draft.advancePercent != null && <div><span className="text-neutral-500">Advance: </span><span className="font-semibold">{result.draft.advancePercent}%</span></div>}
                    {brand && result.draft.deliverables.length > 0 && (
                      <div className="col-span-2"><span className="text-neutral-500">Deliverables: </span><span className="font-semibold">{result.draft.deliverables.join(" · ")}</span></div>
                    )}
                    {brand && (["usageRights", "usageDuration", "exclusivity", "approval"] as const).map((k) => (
                      <div key={k}>
                        <span className="text-neutral-500">{BRAND_TERM_LABELS[k]}: </span>
                        {result.draft.brandTerms?.[k]
                          ? <span className="font-semibold">{result.draft.brandTerms[k]}</span>
                          : <span className="text-neutral-500">{NOT_SPECIFIED}</span>}
                      </div>
                    ))}
                  </div>
                  {result.warning && (
                    <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400 mt-2.5">
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {result.warning}
                    </p>
                  )}
                </div>

                <ProtectionFindings findings={findings} passes={result.protection.passes} />

                <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={createAccount}
                    data-testid="demo-create-account"
                    className="w-full sm:w-auto h-11 px-6 rounded-md text-white text-sm font-bold shadow-md shadow-emerald-500/25 inline-flex items-center justify-center gap-2"
                    style={{ background: BRAND_GRADIENT }}
                  >
                    Create your free account <ArrowRight className="w-4 h-4" />
                  </button>
                  <p className="text-xs text-neutral-500">This exact draft carries over — nothing to retype.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
