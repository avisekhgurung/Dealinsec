/**
 * Public agreement signing page — no account, no session. Reached at /s/:token.
 *
 * Renders ONLY /api/public/agreements/:token's frozen, redacted snapshot.
 * Signing posts a name, an optional email, a drawn signature and an explicit
 * consent checkbox; the server sets contracts.status="Signed" the same way
 * the existing manual proof-upload path already does.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Check, FileSignature, Loader2, ShieldCheck } from "lucide-react";
import { DealinsecLogo } from "@/components/dealinsec-logo";
import { SignaturePad } from "@/components/signature-pad";

interface Snapshot {
  issuerName: string;
  clientName: string;
  contractName: string;
  startDate: string;
  endDate: string;
  amountLabel: string;
  terms: string[];
}

const BRAND_GRADIENT = "linear-gradient(135deg, #059669 0%, #0D9488 100%)";

function fmtDate(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function tokenFromPath(): string {
  return window.location.pathname.replace(/^\/s\//, "").split(/[/?#]/)[0] ?? "";
}

export default function PublicSignPage() {
  const [token] = useState(tokenFromPath);
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [justSigned, setJustSigned] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<{ snapshot: Snapshot; signed: boolean; signedAt: string | null; signerName: string | null }>({
    queryKey: ["/api/public/agreements", token],
    queryFn: async () => {
      const res = await fetch(`/api/public/agreements/${token}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Not found");
      return res.json();
    },
    retry: false,
  });

  const sign = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/public/agreements/${token}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signerName, signerEmail, signatureDataUrl, agree }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Couldn't sign");
      return res.json();
    },
    onSuccess: () => {
      setJustSigned(true);
      refetch();
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
        <p className="text-lg font-semibold mt-2">This signing link isn&apos;t available</p>
        <p className="text-sm text-neutral-500 max-w-sm">
          It may have been revoked, or the agreement may already be signed another way. Ask the sender for a fresh link.
        </p>
      </div>
    );
  }

  const s = data.snapshot;
  const signed = justSigned || data.signed;
  const canSubmit = signerName.trim().length >= 2 && !!signatureDataUrl && agree;

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 px-4 py-8 sm:py-14">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <DealinsecLogo size="md" withText />
        </div>

        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xl shadow-emerald-900/5 overflow-hidden">
          <div className="h-1.5" style={{ background: BRAND_GRADIENT }} />
          <div className="p-6 sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-1">Agreement</p>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-balance">{s.contractName}</h1>
            <p className="text-sm text-neutral-500 mt-1">Between {s.issuerName} and {s.clientName}</p>

            <div className="grid sm:grid-cols-2 gap-4 mt-6">
              <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-1">Period</p>
                <p className="text-sm">{fmtDate(s.startDate)} – {fmtDate(s.endDate)}</p>
              </div>
              <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-1">Value</p>
                <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{s.amountLabel}</p>
              </div>
            </div>

            {s.terms.length > 0 && (
              <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 mt-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-2">Terms</p>
                <ul className="space-y-1 text-sm text-neutral-700 dark:text-neutral-300">
                  {s.terms.map((t) => <li key={t}>• {t}</li>)}
                </ul>
              </div>
            )}

            <div className="mt-6 pt-6 border-t border-neutral-200 dark:border-neutral-800">
              {signed ? (
                <div className="flex items-center gap-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 p-4" data-testid="agreement-signed-badge">
                  <ShieldCheck className="w-6 h-6 text-emerald-600 shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">Signed{data.signerName || signerName ? ` by ${data.signerName || signerName}` : ""}</p>
                    <p className="text-xs text-emerald-600/80 dark:text-emerald-400/80">Electronic acceptance recorded, not a Digital Signature Certificate.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <FileSignature className="w-4 h-4 text-emerald-600" /> Sign this agreement
                  </p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <input
                      value={signerName}
                      onChange={(e) => setSignerName(e.target.value)}
                      placeholder="Your full name"
                      data-testid="input-signer-name"
                      className="h-10 rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                    />
                    <input
                      value={signerEmail}
                      onChange={(e) => setSignerEmail(e.target.value)}
                      placeholder="Email (optional)"
                      type="email"
                      data-testid="input-signer-email"
                      className="h-10 rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                    />
                  </div>
                  <SignaturePad onChange={setSignatureDataUrl} />
                  <label className="flex items-start gap-2 text-xs text-neutral-600 dark:text-neutral-400">
                    <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" data-testid="checkbox-agree" />
                    I agree to sign this agreement electronically. This is electronic acceptance with an audit record, not a Digital Signature Certificate or Aadhaar eSign.
                  </label>
                  <button
                    type="button"
                    disabled={!canSubmit || sign.isPending}
                    onClick={() => sign.mutate()}
                    data-testid="button-sign-agreement"
                    className="w-full h-11 rounded-md text-white text-sm font-bold shadow-md shadow-emerald-500/25 disabled:opacity-50 flex items-center justify-center gap-2"
                    style={{ background: BRAND_GRADIENT }}
                  >
                    {sign.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {sign.isPending ? "Signing…" : "Sign Agreement"}
                  </button>
                  {sign.isError && <p className="text-xs text-rose-600">{(sign.error as Error).message}</p>}
                </div>
              )}
            </div>
          </div>
        </div>

        <p className="flex items-center justify-center gap-1.5 text-xs text-neutral-400 mt-6">Sent with DealInSec</p>
      </div>
    </div>
  );
}
