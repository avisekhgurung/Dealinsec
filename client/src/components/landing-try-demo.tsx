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
 */
import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, ArrowRight, Loader2, Sparkles } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import { BRAND_GRADIENT } from "@/components/landing-shared";

const EXAMPLE =
  "Hey Rahul, I need a landing page for my startup. Budget is $1500. Need it in two weeks. We can discuss revisions later. Payment after launch.";

const MAX_LEN = 600;

interface Flag { id: string; priority: "high" | "attention"; title: string; detail: string; suggestedTerm?: string }
interface DemoResult {
  draft: {
    client: string; project: string; amount: number; currency: string; timeline: string;
    deliverables: string[]; revisions: number | null; advancePercent: number | null; terms: string[];
  };
  amountLabel: string | null;
  protection: { flags: Flag[]; passes: string[] };
  warning: string | null;
}

export function LandingTryDemo() {
  const [, setLocation] = useLocation();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DemoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const run = async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    if (!started.current) {
      started.current = true;
      trackEvent("demo_started");
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/demo-deal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Couldn't read that — try again.");
        return;
      }
      setResult(data);
      trackEvent("demo_completed");
      trackEvent("anonymous_draft_created");
      if (data.protection?.flags?.length) trackEvent("protection_check_viewed", { flags: data.protection.flags.length });
    } catch {
      setError("Couldn't reach the server — please try again.");
    } finally {
      setBusy(false);
    }
  };

  const tryExample = () => {
    setText(EXAMPLE);
    trackEvent("demo_open", { source: "example" });
    run(EXAMPLE);
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
          // "Custom" so the form opens straight to the review step instead of
          // the type picker — the demo never asked what KIND of work this is,
          // and making the visitor pick one now would be exactly the "start
          // over" friction this whole handoff exists to avoid. They can still
          // go back to the type picker with the header's back arrow if they want to.
          dealType: "Custom",
          dealAmount: d.amount || undefined,
          startDate: today.toISOString().slice(0, 10),
          endDate: end.toISOString().slice(0, 10),
          customTerms: d.terms.join("\n"),
          deliverables: d.deliverables.length
            ? d.deliverables.map((label) => ({ platform: "Service", contentType: label, quantity: 1, frequency: "One-time", notes: "" }))
            : undefined,
        }),
      );
    } catch { /* private-mode browsers: signup still works, just without the prefill */ }
    trackEvent("signup_from_demo");
    setLocation("/auth?mode=signup");
  };

  const high = result?.protection.flags.filter((f) => f.priority === "high") ?? [];
  const attention = result?.protection.flags.filter((f) => f.priority === "attention") ?? [];

  return (
    <section id="try" className="py-16 sm:py-20 scroll-mt-20">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8">
          <p className="text-xs uppercase tracking-widest font-semibold text-emerald-600 dark:text-emerald-400 mb-3">Try it — no account needed</p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-balance">Paste a real client message.</h2>
          <p className="text-base text-neutral-600 dark:text-neutral-400 mt-2">We'll turn it into a deal and check what's missing — free, no signup.</p>
        </div>

        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xl shadow-emerald-900/5 overflow-hidden">
          <div className="h-1.5" style={{ background: BRAND_GRADIENT }} />
          <div className="p-5 sm:p-6">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
              onFocus={() => { if (!started.current) { started.current = true; trackEvent("demo_open", { source: "textarea" }); } }}
              placeholder="Hey, I need a landing page for my SaaS. Budget is $1,500. Need it in two weeks. Two revisions."
              rows={3}
              maxLength={MAX_LEN}
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

            {result && (
              <div className="mt-6 pt-6 border-t border-neutral-200 dark:border-neutral-800 space-y-5" data-testid="demo-result">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-2">Deal detected</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                    {result.draft.client && <div><span className="text-neutral-500">Client: </span><span className="font-semibold">{result.draft.client}</span></div>}
                    <div><span className="text-neutral-500">Project: </span><span className="font-semibold">{result.draft.project}</span></div>
                    {result.amountLabel && <div><span className="text-neutral-500">Budget: </span><span className="font-semibold tabular-nums">{result.amountLabel}</span></div>}
                    {result.draft.timeline && <div><span className="text-neutral-500">Timeline: </span><span className="font-semibold">{result.draft.timeline}</span></div>}
                    {result.draft.revisions != null && <div><span className="text-neutral-500">Revisions: </span><span className="font-semibold">{result.draft.revisions}</span></div>}
                    {result.draft.advancePercent != null && <div><span className="text-neutral-500">Advance: </span><span className="font-semibold">{result.draft.advancePercent}%</span></div>}
                  </div>
                  {result.warning && (
                    <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400 mt-2.5">
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {result.warning}
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 mb-2">Protection check</p>
                  {result.protection.flags.length === 0 ? (
                    <p className="text-sm text-emerald-700 dark:text-emerald-400">No risky wording or missing protections found.</p>
                  ) : (
                    <div className="space-y-2">
                      {[...high, ...attention].map((f) => (
                        <div key={f.id} className="flex items-start gap-2">
                          <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${f.priority === "high" ? "bg-rose-500" : "bg-amber-500"}`} aria-hidden />
                          <p className="text-sm">
                            <span className={`font-semibold ${f.priority === "high" ? "text-rose-600 dark:text-rose-400" : "text-amber-700 dark:text-amber-400"}`}>{f.title}</span>
                            {" — "}<span className="text-neutral-600 dark:text-neutral-400">{f.detail}</span>
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

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
