/**
 * "Send for e-signature" — creates/shows/revokes the public signing link for
 * one agreement, and shows the signed-online summary once it's used. Talks
 * only to /api/contracts/:id/sign-share*; the manual proof-upload path on the
 * agreement page stays exactly as it was, as an alternative the freelancer
 * can still use instead.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { trackEvent } from "@/lib/analytics";
import { Check, Copy, FileSignature, Loader2, ShieldCheck, XCircle } from "lucide-react";

interface SignShareStatus {
  active: boolean;
  signed?: boolean;
  url?: string;
  sharedAt?: string | null;
  viewCount?: number;
  signerName?: string | null;
  signerEmail?: string | null;
  signedAt?: string | null;
}

export function AgreementSignPanel({ contractId }: { contractId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const key = ["/api/contracts", contractId, "sign-share"];

  const { data, isLoading } = useQuery<SignShareStatus>({
    queryKey: key,
    queryFn: getQueryFn({ on401: "returnNull" }) as any,
  });

  const create = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/contracts/${contractId}/sign-share`, {})).json(),
    onSuccess: (d) => {
      qc.setQueryData(key, { ...d, signed: false });
      trackEvent("agreement_shared");
    },
    onError: (e: any) => toast({ title: e?.message || "Couldn't create the signing link.", variant: "destructive" }),
  });

  const revoke = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/contracts/${contractId}/sign-share/revoke`, {})).json(),
    onSuccess: (d) => qc.setQueryData(key, d),
  });

  const copyLink = () => {
    if (!data?.url) return;
    navigator.clipboard?.writeText(`${window.location.origin}${data.url}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (isLoading) return null;

  // Signed (whichever path got there first) — a summary, not a share control.
  if (data?.signed) {
    return (
      <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/60 dark:bg-emerald-950/20 p-4" data-testid="agreement-sign-summary">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
          <ShieldCheck className="w-4 h-4" /> Signed online
        </p>
        {data.signerName && (
          <p className="text-xs text-muted-foreground mt-1">
            {data.signerName}{data.signerEmail ? ` (${data.signerEmail})` : ""}
            {data.signedAt ? ` · ${new Date(data.signedAt).toLocaleString()}` : ""}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4" data-testid="agreement-sign-panel">
      <p className="flex items-center gap-1.5 text-sm font-semibold mb-1">
        <FileSignature className="w-4 h-4 text-emerald-600" /> Send for e-signature
      </p>
      <p className="text-xs text-muted-foreground mb-3">
        A link your client can open and sign without an account — no PAN, GSTIN or bank details shown.
      </p>

      {data?.active ? (
        <div className="space-y-2.5">
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={`${window.location.origin}${data.url}`}
              className="flex-1 h-9 rounded-md border border-input bg-muted/40 px-2.5 text-xs font-mono truncate"
              data-testid="sign-share-link"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button size="sm" variant="outline" className="h-9" onClick={copyLink} data-testid="button-copy-sign-link">
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </Button>
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{data.viewCount ?? 0} view{data.viewCount === 1 ? "" : "s"}</span>
            <button
              type="button"
              onClick={() => revoke.mutate()}
              disabled={revoke.isPending}
              className="flex items-center gap-1 text-rose-600 hover:underline disabled:opacity-50"
              data-testid="button-revoke-sign-link"
            >
              {revoke.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />} Revoke
            </button>
          </div>
        </div>
      ) : (
        <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending} className="gradient-btn text-white" data-testid="button-create-sign-link">
          {create.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <FileSignature className="w-3.5 h-3.5 mr-1.5" />}
          {create.isPending ? "Creating…" : "Create signing link"}
        </Button>
      )}
    </div>
  );
}
