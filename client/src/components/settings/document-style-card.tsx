/** How quotations, agreements and invoices look when printed: a short list of accents, two typefaces, a footer note. */
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { DOCUMENT_STYLE_URL } from "@/hooks/use-document-style";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { parseApiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { ACCENTS, ACCENT_KEYS, DEFAULT_DOCUMENT_STYLE, FONTS, MAX_FOOTER_NOTE, normalizeStyle, styleVars, type DocumentStyle, type FontKey } from "@shared/document-style";

export function DocumentStyleCard({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const { data, error } = useQuery<{ style: DocumentStyle }>({ queryKey: [DOCUMENT_STYLE_URL], retry: false });
  const [draft, setDraft] = useState<DocumentStyle>(DEFAULT_DOCUMENT_STYLE);
  useEffect(() => { if (data?.style) setDraft(normalizeStyle(data.style)); }, [data]);

  const save = useMutation({
    mutationFn: () => apiRequest("PUT", DOCUMENT_STYLE_URL, { accent: draft.accent, font: draft.font, footerNote: draft.footerNote }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: [DOCUMENT_STYLE_URL] }); toast({ title: "Document style saved" }); },
    onError: (e) => {
      const msg = parseApiError(e).error ?? "";
      if (/already how/.test(msg)) { toast({ title: "Nothing changed" }); return; }
      toast({ title: "Couldn't save", description: msg || "Try again.", variant: "destructive" });
    },
  });

  // Where the feature isn't switched on yet, the card simply isn't there.
  if (error && String((error as Error).message).includes("DOCUMENT_STYLE_NOT_SETUP")) return null;

  const vars = styleVars(draft) as React.CSSProperties;
  return (
    <Card className="glass-card" data-testid="document-style-card">
      <CardContent className="space-y-4 p-5 lg:p-6">
        <div>
          <h2 className="text-lg font-bold">Document style</h2>
          <p className="text-sm text-muted-foreground">How your quotations, agreements and invoices look when printed or saved as a PDF. Colour and typeface only; what a document says is never changed here.</p>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Accent colour</Label>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Accent colour">
            {ACCENT_KEYS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={draft.accent === k} aria-label={ACCENTS[k].label} disabled={!canEdit} onClick={() => setDraft((d) => ({ ...d, accent: k }))} data-testid={`accent-${k}`}
                className={cn("flex h-9 w-9 items-center justify-center rounded-full border-2 transition", draft.accent === k ? "border-foreground" : "border-transparent hover:border-border")}
                style={{ background: ACCENTS[k].brand }}>
                {draft.accent === k && <Check className="h-4 w-4 text-white" />}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Typeface</Label>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Typeface">
            {(Object.keys(FONTS) as FontKey[]).map((f) => (
              <button key={f} type="button" role="radio" aria-checked={draft.font === f} disabled={!canEdit} onClick={() => setDraft((d) => ({ ...d, font: f }))} data-testid={`font-${f}`}
                className={cn("rounded-lg border px-3 py-2 text-sm transition", draft.font === f ? "border-foreground bg-muted font-semibold" : "hover:bg-muted/50")} style={{ fontFamily: FONTS[f].css }}>
                {FONTS[f].label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="doc-footer-note" className="text-xs">Footer note (quotations and invoices)</Label>
          <Input id="doc-footer-note" value={draft.footerNote ?? ""} maxLength={MAX_FOOTER_NOTE} disabled={!canEdit} placeholder="For example: Payment within 7 days of invoice"
            onChange={(e) => setDraft((d) => ({ ...d, footerNote: e.target.value || null }))} data-testid="input-footer-note" />
          <p className="text-[11px] text-muted-foreground">Not printed on agreements: what is printed on a signed document is part of what was signed.</p>
        </div>

        {/* A live miniature of the real thing, using the same variables the documents use. */}
        <div className="rounded-xl border bg-white p-4 text-[#16232e]" style={{ ...vars, fontFamily: "var(--doc-font)" }} data-testid="document-style-preview">
          <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: "var(--doc-brand)" }}>
            <span className="text-sm font-bold" style={{ color: "var(--doc-brand)" }}>Quotation</span>
            <span className="text-[11px] text-neutral-500">QT-0042</span>
          </div>
          <div className="mt-2 flex justify-between rounded-md px-2 py-1.5 text-xs" style={{ background: "var(--doc-brand-soft)" }}><span>Website design</span><span className="font-semibold" style={{ color: "var(--doc-brand)" }}>₹50,000</span></div>
          {draft.footerNote && <p className="mt-3 border-t pt-1.5 text-[10px] text-neutral-500">{draft.footerNote}</p>}
        </div>

        {canEdit && <Button className="gradient-btn text-white" onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-document-style">{save.isPending ? "Saving…" : "Save style"}</Button>}
      </CardContent>
    </Card>
  );
}
