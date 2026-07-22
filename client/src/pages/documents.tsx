import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { FileText, Trash2, ExternalLink } from "lucide-react";
import type { ToolDocument } from "@shared/schema";

// Maps a saved document's type to the free tool that renders it and the
// localStorage draft key that tool restores from — so "Open" re-hydrates it.
const TOOL_MAP: Record<string, { label: string; path: string; storeKey: string }> = {
  invoice: { label: "GST Invoice", path: "/tools/gst-invoice-generator", storeKey: "dis_gst_invoice_v1" },
  quotation: { label: "Quotation", path: "/tools/quotation-maker", storeKey: "dis_quote_v1" },
  proforma: { label: "Proforma", path: "/tools/proforma-invoice-generator", storeKey: "dis_proforma_v1" },
  purchase_order: { label: "Purchase Order", path: "/tools/purchase-order-generator", storeKey: "dis_purchase_order_v1" },
  agreement: { label: "Agreement", path: "/tools/service-agreement-template", storeKey: "dis_agreement_v2" },
};

function money(n?: number | null) {
  if (n == null) return "";
  return "₹" + Number(n).toLocaleString("en-IN");
}
function fmtDate(s?: string | Date | null) {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function DocumentsPage() {
  const { toast } = useToast();
  const { data: docs = [], isLoading } = useQuery<ToolDocument[]>({ queryKey: ["/api/documents"] });

  const del = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/documents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({ title: "Deleted", description: "The document was removed." });
    },
    onError: () => {
      toast({ title: "Error", description: "Could not delete. Please try again.", variant: "destructive" });
    },
  });

  async function openDoc(doc: ToolDocument) {
    const meta = TOOL_MAP[doc.type];
    if (!meta) return;
    try {
      const res = await apiRequest("GET", `/api/documents/${doc.id}`);
      const full = await res.json();
      if (full?.payload) {
        try {
          localStorage.setItem(meta.storeKey, JSON.stringify(full.payload));
        } catch {
          /* storage full — still navigate; tool opens blank */
        }
      }
    } catch {
      /* fetch failed — still open the tool */
    }
    window.location.href = meta.path;
  }

  return (
    <div className="min-h-screen bg-background pb-20 lg:pb-12">
      <header className="glass-header sticky top-0 z-40 lg:border-b lg:border-neutral-200/60 dark:lg:border-neutral-800/60">
        <div className="px-4 py-4 lg:max-w-6xl lg:mx-auto lg:px-8 lg:py-6">
          <h1 className="text-xl lg:text-3xl font-bold tracking-tight">Documents</h1>
          <p className="hidden lg:block text-sm text-muted-foreground mt-0.5">
            Invoices, quotations and agreements you saved from the free tools — open any one to reuse or edit it.
          </p>
        </div>
      </header>

      <main className="px-4 py-6 animate-fade-in lg:max-w-6xl lg:mx-auto lg:px-8 lg:py-8">
        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Card key={i} className="glass-card border rounded-xl">
                <CardContent className="p-4">
                  <div className="h-14 animate-pulse bg-muted rounded-lg" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : docs.length === 0 ? (
          <Card className="glass-card border rounded-xl">
            <CardContent className="p-10 text-center">
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 grid place-items-center mx-auto mb-4">
                <FileText className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h3 className="text-lg font-semibold">No saved documents yet</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                Create an invoice, quotation or agreement with our free tools and hit &ldquo;Save to account&rdquo; — it&rsquo;ll show up here for later reference.
              </p>
              <a
                href="/tools"
                className="inline-flex items-center gap-1.5 mt-5 h-10 px-5 rounded-md text-sm font-semibold text-white shadow-sm"
                style={{ background: "linear-gradient(135deg,#059669,#0D9488)" }}
              >
                Open the free tools →
              </a>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {docs.map((doc) => {
              const meta = TOOL_MAP[doc.type] || { label: doc.type, path: "/tools", storeKey: "" };
              const sub = [doc.partyName, doc.total != null ? money(doc.total) : "", fmtDate(doc.createdAt as any)]
                .filter(Boolean)
                .join(" · ");
              return (
                <Card key={doc.id} className="glass-card border rounded-xl hover-elevate">
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 grid place-items-center flex-shrink-0">
                      <FileText className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                          {meta.label}
                        </span>
                        {doc.docNumber && <span className="text-sm font-semibold truncate">{doc.docNumber}</span>}
                      </div>
                      <div className="text-sm text-muted-foreground truncate mt-0.5">{sub || "Saved document"}</div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Button size="sm" variant="outline" onClick={() => openDoc(doc)} data-testid={`open-doc-${doc.id}`}>
                        <ExternalLink className="w-4 h-4 mr-1.5" />
                        Open
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground"
                        aria-label="Delete document"
                        onClick={() => {
                          if (window.confirm("Delete this saved document? This can’t be undone.")) del.mutate(doc.id);
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
