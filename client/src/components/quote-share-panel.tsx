/**
 * "Share with client" — creates/shows/revokes the public quotation link for
 * one deal. Talks only to /api/deals/:id/quote/share*, never touches the
 * public endpoints (those are for the client's browser, unauthenticated).
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Check, Copy, Link2, Loader2, ShieldCheck, XCircle } from "lucide-react";

interface ShareStatus {
  active: boolean;
  token?: string;
  url?: string;
  sharedAt?: string | null;
  viewCount?: number;
  acceptedAt?: string | null;
}

export function QuoteSharePanel({ dealId }: { dealId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const key = ["/api/deals", dealId, "quote", "share"];

  const { data, isLoading } = useQuery<ShareStatus>({
    queryKey: key,
    queryFn: getQueryFn({ on401: "returnNull" }) as any,
  });

  const create = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/quote/share`, {})).json(),
    onSuccess: (d) => qc.setQueryData(key, d),
    onError: (e: any) => toast({ title: e?.message || "Couldn't create the share link.", variant: "destructive" }),
  });

  const revoke = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/quote/share/revoke`, {})).json(),
    onSuccess: (d) => qc.setQueryData(key, d),
  });

  const copyLink = () => {
    if (!data?.url) return;
    const full = `${window.location.origin}${data.url}`;
    navigator.clipboard?.writeText(full).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (isLoading) return null;

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4" data-testid="quote-share-panel">
      <p className="flex items-center gap-1.5 text-sm font-semibold mb-1">
        <Link2 className="w-4 h-4 text-emerald-600" /> Share with client
      </p>
      <p className="text-xs text-muted-foreground mb-3">
        A link your client can open without an account — no PAN, GSTIN or bank details shown.
      </p>

      {data?.active ? (
        <div className="space-y-2.5">
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={`${window.location.origin}${data.url}`}
              className="flex-1 h-9 rounded-md border border-input bg-muted/40 px-2.5 text-xs font-mono truncate"
              data-testid="quote-share-link"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button size="sm" variant="outline" className="h-9" onClick={copyLink} data-testid="button-copy-share-link">
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </Button>
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{data.viewCount ?? 0} view{data.viewCount === 1 ? "" : "s"}</span>
            {data.acceptedAt ? (
              <span className="flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="w-3 h-3" /> Accepted
              </span>
            ) : (
              <span>Not yet accepted</span>
            )}
            <button
              type="button"
              onClick={() => revoke.mutate()}
              disabled={revoke.isPending}
              className="flex items-center gap-1 text-rose-600 hover:underline disabled:opacity-50"
              data-testid="button-revoke-share-link"
            >
              {revoke.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />} Revoke
            </button>
          </div>
        </div>
      ) : (
        <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending} className="gradient-btn text-white" data-testid="button-create-share-link">
          {create.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5 mr-1.5" />}
          {create.isPending ? "Creating…" : "Create client link"}
        </Button>
      )}
    </div>
  );
}
