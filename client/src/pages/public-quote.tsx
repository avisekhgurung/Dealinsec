/**
 * Public quotation page — no account, no session. Reached at /d/:token.
 *
 * Renders ONLY what /api/public/quotes/:token returns: a frozen, redacted
 * snapshot (shared/quoteShare.ts). There is no live deal data here and no way
 * to reach one — this page never calls an authenticated endpoint.
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Check, Loader2, ShieldCheck } from "lucide-react";
import { PublicDocFooter } from "@/components/public-doc-footer";
import { DealinsecLogo } from "@/components/dealinsec-logo";
import { trackEvent } from "@/lib/analytics";

interface Snapshot {
  issuerName: string;
  clientName: string;
  dealTitle: string;
  dealType: string;
  deliverables: { label: string; quantity: number }[];
  startDate: string;
  endDate: string;
  amountLabel: string;
  terms: string[];
  quoteNumber: string;
  version: number;
  validUntil: string;
}

const BRAND_GRADIENT = "linear-gradient(135deg, #059669 0%, #0D9488 100%)";

function fmtDate(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Rendered outside any wouter <Route> (see App.tsx — this page bypasses the
 *  auth check entirely, so it has no route-match context to read a param
 *  from), so the token comes straight out of the URL path instead. */
function tokenFromPath(): string {
  return window.location.pathname.replace(/^\/d\//, "").split(/[/?#]/)[0] ?? "";
}

export default function PublicQuotePage() {
  const [token] = useState(tokenFromPath);
  const [acceptedNow, setAcceptedNow] = useState(false);

  const { data, isLoading, isError } = useQuery<{ snapshot: Snapshot; acceptedAt: string | null }>({
    queryKey: ["/api/public/quotes", token],
    queryFn: async () => {
      const res = await fetch(`/api/public/quotes/${token}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Not found");
      return res.json();
    },
    retry: false,
  });
  useEffect(() => {
    if (data) trackEvent("public_document_view", { type: "quote" });
  }, [!!data]);

  const accept = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/public/quotes/${token}/accept`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Couldn't accept");
      return res.json();
    },
    onSuccess: () => {
      setAcceptedNow(true);
      trackEvent("public_quote_accept");
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-neutral-50 dark:bg-neutral-950 px-4 text-center">
        <DealinsecLogo size="md" withText />
        <p className="text-lg font-semibold mt-2">This quotation link isn&apos;t available</p>
        <p className="text-sm text-neutral-500 max-w-sm">
          It may have been revoked, or replaced by a newer version. Ask the sender for a fresh link.
        </p>
        <PublicDocFooter />
      </div>
    );
  }

  const s = data.snapshot;
  const accepted = acceptedNow || !!data.acceptedAt;

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 px-4 py-8 sm:py-14">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <DealinsecLogo size="md" withText />
          <span className="text-xs font-semibold text-neutral-500">{s.quoteNumber} · v{s.version}</span>
        </div>

        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xl shadow-emerald-900/5 overflow-hidden">
          <div className="h-1.5" style={{ background: BRAND_GRADIENT }} />
          <div className="p-6 sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-1">Quotation</p>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-balance">{s.dealTitle}</h1>
            <p className="text-sm text-neutral-500 mt-1">Prepared for {s.clientName} · by {s.issuerName}</p>

            <div className="grid sm:grid-cols-2 gap-4 mt-6">
              <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-2">Deliverables</p>
                <ul className="space-y-1.5">
                  {s.deliverables.map((d) => (
                    <li key={d.label} className="text-sm flex items-start gap-2">
                      <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                      <span>{d.quantity > 1 ? `${d.quantity} × ` : ""}{d.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-2">Timeline</p>
                <p className="text-sm">{fmtDate(s.startDate)} – {fmtDate(s.endDate)}</p>
                <p className="text-[11px] text-neutral-500 mt-3">Valid until {s.validUntil}</p>
              </div>
            </div>

            {s.terms.length > 0 && (
              <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 mt-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-2">Payment terms</p>
                <ul className="space-y-1 text-sm text-neutral-700 dark:text-neutral-300">
                  {s.terms.map((t) => <li key={t}>• {t}</li>)}
                </ul>
              </div>
            )}

            <div className="flex items-end justify-between mt-6 pt-6 border-t border-neutral-200 dark:border-neutral-800">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">Investment</p>
                <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{s.amountLabel}</p>
              </div>
              {accepted ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 px-4 py-2 text-sm font-bold" data-testid="quote-accepted-badge">
                  <ShieldCheck className="w-4 h-4" /> Accepted
                </span>
              ) : (
                <button
                  type="button"
                  disabled={accept.isPending}
                  onClick={() => accept.mutate()}
                  data-testid="button-accept-quotation"
                  className="h-11 px-6 rounded-md text-white text-sm font-bold shadow-md shadow-emerald-500/25 disabled:opacity-60"
                  style={{ background: BRAND_GRADIENT }}
                >
                  {accept.isPending ? "Accepting…" : "Accept Quotation"}
                </button>
              )}
            </div>
            {accept.isError && <p className="text-xs text-rose-600 mt-2">{(accept.error as Error).message}</p>}
          </div>
        </div>

<PublicDocFooter />
      </div>
    </div>
  );
}
