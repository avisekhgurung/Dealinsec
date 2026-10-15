/**
 * "Send for e-signature" — creates/shows/revokes the public signing link for
 * one agreement, and shows the signed summary once it's signed. Talks only to
 * /api/contracts/:id/sign-share*; the manual proof-upload path on the
 * agreement page stays exactly as it was, as an alternative the freelancer
 * can still use instead.
 *
 * Creating and revoking a link need agreements.create — the server's rule
 * (createAgreementSignLink in server/services/sharing.ts, the revoke route in
 * server/agreementSign.ts). The panel mirrors it so a member without it sees
 * why, instead of a button that fails; the server stays the authority.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadError } from "@/components/load-error";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { memberCan } from "@shared/permissions";
import { parseApiError } from "@/lib/api-error";
import { trackEvent } from "@/lib/analytics";
import { Check, Copy, FileSignature, Hourglass, Loader2, ShieldCheck, Upload, XCircle } from "lucide-react";

interface SignShareStatus {
  active: boolean;
  signed?: boolean;
  url?: string;
  sharedAt?: string | null;
  viewCount?: number;
  signerName?: string | null;
  signerEmail?: string | null;
  signedAt?: string | null;
  documentIntegrity?: "verified" | "unavailable" | "mismatch" | null;
}

export function AgreementSignPanel({
  contractId,
  party = "client",
  proofAnchor,
}: {
  contractId: number;
  party?: string;
  /** Where the "upload the signed copy instead" link points (the page's Files & Proof card). */
  proofAnchor?: string;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const canManage = memberCan(user as any, "agreements.create");
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const key = ["/api/contracts", contractId, "sign-share"];

  const { data, isLoading, isError, refetch, isFetching } = useQuery<SignShareStatus>({
    queryKey: key,
    queryFn: getQueryFn({ on401: "returnNull" }) as any,
  });

  // A share moves Draft → Pending and a revoke moves it back: the agreement's
  // own status (its badge, the list) must follow, not wait for a refocus.
  const refreshAgreement = () => {
    qc.invalidateQueries({ queryKey: ["/api/contracts", String(contractId)] });
    qc.invalidateQueries({ queryKey: ["/api/contracts"], exact: true });
  };

  const create = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/contracts/${contractId}/sign-share`, {})).json(),
    onSuccess: (d) => {
      qc.setQueryData(key, { ...d, signed: false });
      refreshAgreement();
      trackEvent("agreement_shared");
      trackEvent("agreement_sent", { channel: "link" });
    },
    onError: (e: unknown) => toast({
      title: "Couldn't create the signing link",
      description: parseApiError(e).error || "Nothing was sent. Check your connection, then try again.",
      variant: "destructive",
    }),
  });

  const revoke = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/contracts/${contractId}/sign-share/revoke`, {})).json(),
    onSuccess: (d) => {
      qc.setQueryData(key, d);
      refreshAgreement();
    },
    onError: (e: unknown) => toast({
      title: "Couldn't revoke the link",
      description: parseApiError(e).error || "The link still works. Check your connection, then try again.",
      variant: "destructive",
    }),
  });

  const copyLink = () => {
    if (!data?.url) return;
    navigator.clipboard?.writeText(`${window.location.origin}${data.url}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 space-y-2.5" role="status" aria-busy="true" data-testid="agreement-sign-panel-loading">
        <span className="sr-only">Loading the signing link…</span>
        <Skeleton className="h-4 w-40" aria-hidden />
        <Skeleton className="h-3 w-full" aria-hidden />
        <Skeleton className="h-9 w-36" aria-hidden />
      </div>
    );
  }

  // Unknown is not "no link": a Create button here could look like the live link was lost.
  if (isError) {
    return (
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800">
        <LoadError compact what="the signing link" onRetry={() => refetch()} retrying={isFetching} />
      </div>
    );
  }

  // Signed (whichever path got there first) — a summary, not a share control.
  if (data?.signed) {
    // A sign time exists only when the client signed on the link; a proof upload
    // is the owner's statement, so it must not read "Signed online".
    const online = !!data.signedAt;
    return (
      <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/60 dark:bg-emerald-950/20 p-4 space-y-3" data-testid="agreement-sign-summary">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="w-4 h-4" /> {online ? "Signed online" : "Signed copy on file"}
          </p>
          {online && data.signerName && (
            <p className="text-xs text-muted-foreground mt-1">
              {data.signerName}{data.signerEmail ? ` (${data.signerEmail})` : ""}
              {data.signedAt ? ` · ${new Date(data.signedAt).toLocaleString()}` : ""}
            </p>
          )}
          {!online && (
            <p className="text-xs text-muted-foreground mt-1">Marked signed by an uploaded copy.</p>
          )}
          {data.documentIntegrity === "verified" && (
            <p className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 mt-1.5">
              <ShieldCheck className="w-3 h-3" /> Document integrity — recorded
            </p>
          )}
        </div>
      </div>
    );
  }

  // Pending: the link is live — the job now is waiting, and getting it to the client.
  if (data?.active) {
    return (
      <div className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/10 p-4" data-testid="agreement-sign-panel">
        <p className="flex items-center gap-1.5 text-sm font-semibold mb-1">
          <Hourglass className="w-4 h-4 text-amber-600" /> Waiting for your {party} to sign
        </p>
        <p className="text-xs text-muted-foreground mb-3">
          Send them this link if you haven't yet. They can open and sign it without an account.
        </p>
        <div className="space-y-2.5">
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={`${window.location.origin}${data.url}`}
              aria-label="Signing link"
              className="flex-1 min-w-0 h-9 rounded-md border border-input bg-muted/40 px-2.5 text-xs font-mono truncate"
              data-testid="sign-share-link"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button size="sm" className="h-9 gradient-btn text-white" onClick={copyLink} data-testid="button-copy-sign-link">
              {copied ? <Check className="w-3.5 h-3.5 mr-1.5" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{data.viewCount ?? 0} view{data.viewCount === 1 ? "" : "s"}</span>
            {canManage ? (
              <button
                type="button"
                onClick={() => revoke.mutate()}
                disabled={revoke.isPending}
                className="flex items-center gap-1 text-rose-600 hover:underline disabled:opacity-50"
                data-testid="button-revoke-sign-link"
              >
                {revoke.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />} Revoke
              </button>
            ) : (
              <span data-testid="text-sign-link-role">Your role can't revoke this link.</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Draft: nothing sent yet — the next step is sending it.
  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4" data-testid="agreement-sign-panel">
      <p className="flex items-center gap-1.5 text-sm font-semibold mb-1">
        <FileSignature className="w-4 h-4 text-emerald-600" /> Next: send it for signature
      </p>
      <p className="text-xs text-muted-foreground mb-3">
        A link your {party} can open and sign without an account — no PAN, GSTIN or bank details shown.
      </p>
      {canManage ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending} className="gradient-btn text-white" data-testid="button-create-sign-link">
            {create.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <FileSignature className="w-3.5 h-3.5 mr-1.5" />}
            {create.isPending ? "Creating…" : "Create signing link"}
          </Button>
          {proofAnchor && (
            <a href={proofAnchor} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline">
              <Upload className="w-3 h-3" /> Signed on paper? Upload the copy
            </a>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground" data-testid="text-sign-link-role">
          Your role can't send agreements for signature. Ask your workspace owner.
        </p>
      )}
    </div>
  );
}
