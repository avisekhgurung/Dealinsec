import { useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import {
  invoiceDocumentCategories,
  type InvoiceAttachment,
  type InvoiceDocumentCategory,
} from "@shared/schema";
import {
  Paperclip,
  Upload,
  Download,
  Trash2,
  Loader2,
  FileText,
  ShieldCheck,
} from "lucide-react";

function formatSize(bytes?: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr?: string | null) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Colour accent per document category so the list scans quickly.
const categoryStyle: Record<string, string> = {
  "GST Invoice": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  "TDS Certificate": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "Form 16A": "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  "Payment Receipt": "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
  "Bank Statement": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  "Purchase Order": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  Other: "bg-gray-100 text-gray-600 dark:bg-gray-800/40 dark:text-gray-300",
};

export function InvoiceAttachments({ invoiceId }: { invoiceId: number | string }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<InvoiceDocumentCategory>("GST Invoice");

  const listKey = ["/api/brand-invoices", invoiceId, "attachments"];

  const { data: attachments = [], isLoading } = useQuery<InvoiceAttachment[]>({
    queryKey: listKey,
  });

  const uploadDoc = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", category);
      const res = await fetch(`/api/brand-invoices/${invoiceId}/attachments`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        // Prefer the server's structured reason; fall back to a generic hint.
        let msg = "";
        try {
          const body = await res.json();
          msg = body?.error || body?.reason || "";
        } catch {
          msg = (await res.text().catch(() => "")) || "";
        }
        throw new Error(msg || `Upload failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listKey });
      toast({ title: "Document attached", description: `${category} saved to this invoice.` });
    },
    onError: (err: any) => {
      toast({
        title: "Upload failed",
        description: err?.message || "Use a PDF or image under 5 MB and try again.",
        variant: "destructive",
      });
    },
  });

  const deleteDoc = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/attachments/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listKey });
      toast({ title: "Document removed" });
    },
    onError: () => {
      toast({ title: "Failed to remove document", variant: "destructive" });
    },
  });

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadDoc.mutate(file);
    e.target.value = ""; // allow re-uploading the same file name
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-md border border-gray-100 dark:border-zinc-800 overflow-hidden print:hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-800 flex items-start gap-3">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex-shrink-0">
          <Paperclip className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Tax Documents</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Keep the GST invoice, TDS certificate &amp; receipts together for easy tax filing.
          </p>
        </div>
      </div>

      {/* Upload row */}
      <div className="px-6 py-4 flex flex-col sm:flex-row gap-2 sm:items-center border-b border-gray-100 dark:border-zinc-800">
        <Select value={category} onValueChange={(v) => setCategory(v as InvoiceDocumentCategory)}>
          <SelectTrigger className="h-10 sm:w-48 rounded-xl text-sm">
            <SelectValue placeholder="Document type" />
          </SelectTrigger>
          <SelectContent>
            {invoiceDocumentCategories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp"
          className="hidden"
          onChange={onPick}
        />
        <Button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploadDoc.isPending}
          className="h-10 rounded-xl gradient-btn text-white sm:flex-shrink-0"
        >
          {uploadDoc.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Uploading...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4 mr-2" />
              Attach Document
            </>
          )}
        </Button>
      </div>

      {/* List */}
      <div className="px-6 py-4">
        {isLoading ? (
          <p className="text-xs text-gray-400 py-4 text-center">Loading documents…</p>
        ) : attachments.length === 0 ? (
          <div className="py-6 text-center">
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-gray-50 dark:bg-zinc-800 mx-auto mb-3">
              <ShieldCheck className="w-6 h-6 text-gray-300 dark:text-gray-600" />
            </div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">No documents yet</p>
            <p className="text-xs text-gray-400 mt-0.5 max-w-xs mx-auto">
              Attach your GST invoice, TDS certificate or payment proof so everything for
              this deal lives in one place.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {attachments.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-3 p-2.5 rounded-xl border border-gray-100 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors"
              >
                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gray-100 dark:bg-zinc-800 flex-shrink-0">
                  <FileText className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                        categoryStyle[a.category] || categoryStyle.Other
                      }`}
                    >
                      {a.category}
                    </span>
                    <span className="text-xs text-gray-400">
                      {formatSize(a.fileSize)}
                      {a.fileSize ? " · " : ""}
                      {formatDate(a.createdAt as unknown as string)}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate mt-0.5">
                    {a.fileName}
                  </p>
                </div>
                <a
                  href={`/api/attachments/${a.id}/download`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors flex-shrink-0"
                  title="Download"
                >
                  <Download className="w-4 h-4" />
                </a>
                <button
                  type="button"
                  onClick={() => deleteDoc.mutate(a.id)}
                  disabled={deleteDoc.isPending}
                  className="flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex-shrink-0 disabled:opacity-50"
                  title="Remove"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
