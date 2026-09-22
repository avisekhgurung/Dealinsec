/**
 * Public agreement signing page — no account, no session. Reached at /s/:token.
 *
 * Renders ONLY /api/public/agreements/:token's frozen, redacted snapshot.
 * Signing posts a name, an optional email, a drawn signature and an explicit
 * consent checkbox; the server sets contracts.status="Signed" the same way
 * the existing manual proof-upload path already does.
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Check, Download, FileSignature, Loader2, ShieldCheck } from "lucide-react";
import { DealinsecLogo } from "@/components/dealinsec-logo";
import { trackEvent } from "@/lib/analytics";
import { SignatureInput } from "@/components/signature-input";
import { PublicDocFooter } from "@/components/public-doc-footer";
import { PublicAgreementDoc, type PublicAgreementSnapshot } from "@/components/document/public-agreement-doc";

/** Everything the compact summary cards read, plus everything
 *  PublicAgreementDoc needs to render the full official document — one
 *  response, one type, so the two views can never see different data. */
interface Snapshot extends PublicAgreementSnapshot {
  amountLabel: string;
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

  const { data, isLoading, isError, refetch } = useQuery<{
    snapshot: Snapshot;
    signed: boolean;
    signedAt: string | null;
    signerName: string | null;
    signerEmail: string | null;
    /** Only ever present once this agreement is signed — the client's own
     *  signature, returned so their document still renders correctly after a
     *  page reload, when the locally-drawn `signatureDataUrl` state is gone. */
    signatureDataUrl: string | null;
    documentIntegrity: "verified" | "unavailable" | "mismatch" | null;
  }>({
    queryKey: ["/api/public/agreements", token],
    queryFn: async () => {
      const res = await fetch(`/api/public/agreements/${token}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Not found");
      return res.json();
    },
    retry: false,
  });
  useEffect(() => {
    if (data) trackEvent("public_agreement_view");
  }, [!!data]);

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
      trackEvent("public_agreement_sign");
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
        <PublicDocFooter />
      </div>
    );
  }

  const s = data.snapshot;
  const signed = justSigned || data.signed;
  const canSubmit = signerName.trim().length >= 2 && !!signatureDataUrl && agree;
  // Prefer the signature just drawn this session (freshest, and covers the
  // instant after signing before a refetch lands); fall back to the server's
  // copy for a reload of an already-signed link.
  const effectiveSignatureDataUrl = signatureDataUrl || data.signatureDataUrl;
  const effectiveSignerName = data.signerName || signerName;
  const effectiveSignerEmail = data.signerEmail || signerEmail || null;
  const effectiveSignedAt = data.signedAt || new Date().toISOString();

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 px-4 py-8 sm:py-14">
      {/* Narrow for the compact review/signing card; widened to fit the full
          official document once one exists to show. */}
      <div className={signed ? "max-w-4xl mx-auto" : "max-w-2xl mx-auto"}>
        <div className="flex items-center justify-between mb-6 print:hidden">
          <DealinsecLogo size="md" withText />
        </div>

        <div className="max-w-2xl mx-auto rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xl shadow-emerald-900/5 overflow-hidden print:hidden">
          <div className="h-1.5" style={{ background: BRAND_GRADIENT }} />
          <div className="p-6 sm:p-8">
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">Agreement</p>
              <span className="text-[11px] font-semibold text-neutral-400">Version 1</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-balance">{s.contractName}</h1>
            <p className="text-sm text-neutral-500 mt-1">Between <span className="font-semibold text-neutral-700 dark:text-neutral-300">{s.issuerName}</span> and <span className="font-semibold text-neutral-700 dark:text-neutral-300">{s.clientName}</span></p>

            <div className="grid sm:grid-cols-2 gap-4 mt-6">
              <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-1">Project value</p>
                <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{s.amountLabel}</p>
              </div>
              <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-1">Period</p>
                <p className="text-sm">{fmtDate(s.startDate)} – {fmtDate(s.endDate)}</p>
              </div>
            </div>

            <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mt-6 mb-2">Review agreement</p>

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
                <div className="space-y-4" data-testid="agreement-signed-badge">
                  <div className="flex items-center gap-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 p-4">
                    <ShieldCheck className="w-6 h-6 text-emerald-600 shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">Agreement signed</p>
                      <p className="text-xs text-emerald-600/80 dark:text-emerald-400/80">Your electronic signature has been recorded.</p>
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm rounded-xl border border-neutral-200 dark:border-neutral-800 p-4">
                    <div>
                      <dt className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Signed by</dt>
                      <dd className="font-semibold">{data.signerName || signerName}</dd>
                    </div>
                    {(data.signerEmail || signerEmail) && (
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Email</dt>
                        <dd className="font-semibold truncate">{data.signerEmail || signerEmail}</dd>
                      </div>
                    )}
                    <div>
                      <dt className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Signed</dt>
                      <dd className="font-semibold">
                        {data.signedAt
                          ? new Date(data.signedAt).toLocaleString(undefined, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" })
                          : "Just now"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Status</dt>
                      <dd className="font-bold text-emerald-600 dark:text-emerald-400">SIGNED</dd>
                    </div>
                    {data.documentIntegrity === "verified" && (
                      <div className="col-span-2 pt-1">
                        <dt className="sr-only">Document integrity</dt>
                        <dd className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                          <ShieldCheck className="w-3.5 h-3.5" /> Document integrity — recorded and matches the signed record
                        </dd>
                      </div>
                    )}
                  </dl>

                  <p className="text-xs text-neutral-500">
                    Electronic acceptance with an audit record — this is not a Digital Signature Certificate or Aadhaar eSign.
                  </p>

                  <button
                    type="button"
                    onClick={() => window.print()}
                    data-testid="button-download-signed-agreement"
                    className="w-full h-11 rounded-md border border-neutral-300 dark:border-neutral-700 text-sm font-bold inline-flex items-center justify-center gap-2 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
                  >
                    <Download className="w-4 h-4" /> Download Signed Agreement
                  </button>
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
                  <SignatureInput signerName={signerName} onChange={setSignatureDataUrl} />
                  <label className="flex items-start gap-2 text-xs text-neutral-600 dark:text-neutral-400">
                    <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" data-testid="checkbox-agree" />
                    I agree to use electronic records and electronic signatures for this agreement. I understand that my electronic signature indicates my intent to sign this agreement. This is electronic acceptance with an audit record, not a Digital Signature Certificate or Aadhaar eSign.
                  </label>
                  <p className="text-[11px] text-neutral-500">
                    By selecting Sign Agreement, you confirm that you have reviewed this agreement and intend to sign it electronically.
                  </p>
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

        {signed && (
          <div className="max-w-4xl mx-auto mt-8 print:mt-0">
            <p className="text-xs font-semibold text-neutral-500 mb-3 print:hidden">Your copy of the signed agreement</p>
            <PublicAgreementDoc
              snapshot={s}
              signerName={effectiveSignerName}
              signerEmail={effectiveSignerEmail}
              signatureDataUrl={effectiveSignatureDataUrl}
              signedAt={effectiveSignedAt}
            />
          </div>
        )}

        <PublicDocFooter />
      </div>
    </div>
  );
}
