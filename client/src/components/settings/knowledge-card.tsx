/**
 * Knowledge: what the assistant may use about your business when it looks for clients.
 * Notes, a web page, a PDF, a described picture. Everything is private to the workspace.
 */
import { useRef, useState } from "react";
import { FileText, Globe, ImageIcon, Loader2, Search, StickyNote, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { KNOWLEDGE_URL, searchKnowledge, useAddImage, useAddNote, useAddPdf, useAddUrl, useKnowledge, useRemoveSource, type KnowledgeHit, type KnowledgeSource } from "@/hooks/use-knowledge";
import { parseApiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";

type Mode = "note" | "url" | "pdf" | "image";
const MODES: { key: Mode; label: string; icon: typeof StickyNote }[] = [
  { key: "note", label: "Note", icon: StickyNote }, { key: "url", label: "Web page", icon: Globe }, { key: "pdf", label: "PDF", icon: FileText }, { key: "image", label: "Picture", icon: ImageIcon },
];
const KIND_ICON = { note: StickyNote, url: Globe, pdf: FileText, image: ImageIcon } as const;
const KIND_LABEL = { note: "Note", url: "Web page", pdf: "PDF", image: "Picture" } as const;
const host = (u: string | null) => { try { return u ? new URL(u).hostname.replace(/^www\./, "") : ""; } catch { return ""; } };

export function KnowledgeCard({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const { data, error, isLoading } = useKnowledge();
  const [mode, setMode] = useState<Mode>("note");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = useState<KnowledgeSource | null>(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ hits: KnowledgeHit[]; empty: boolean } | null>(null);
  const [searching, setSearching] = useState(false);

  const addNote = useAddNote(), addUrl = useAddUrl(), addPdf = useAddPdf(), addImage = useAddImage(), remove = useRemoveSource();
  const busy = addNote.isPending || addUrl.isPending || addPdf.isPending || addImage.isPending;

  // Where the feature isn't switched on yet, the card simply isn't there.
  if (error && String((error as Error).message).includes("KNOWLEDGE_NOT_SETUP")) return null;

  const reset = () => { setTitle(""); setText(""); setUrl(""); setFile(null); if (fileRef.current) fileRef.current.value = ""; };
  const onError = (e: unknown) => toast({ title: "Couldn't add it", description: parseApiError(e).error || "Try again.", variant: "destructive" });
  const done = (what: string) => () => { reset(); toast({ title: `${what} added` }); };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "note") addNote.mutate({ title, text }, { onSuccess: done("Note"), onError });
    else if (mode === "url") addUrl.mutate({ url, title: title.trim() || undefined }, { onSuccess: done("Page"), onError });
    else if (mode === "pdf" && file) addPdf.mutate({ file, title: title.trim() || undefined }, { onSuccess: done("PDF"), onError });
    else if (mode === "image" && file) addImage.mutate({ file, title, description: text }, { onSuccess: done("Picture"), onError });
  };
  const canSubmit = !busy && (mode === "note" ? title.trim() && text.trim().length >= 10 : mode === "url" ? url.trim() : mode === "pdf" ? !!file : !!file && title.trim() && text.trim().length >= 10);

  const runSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setSearching(true);
    try { setFound(await searchKnowledge(q)); } catch (err) { setFound(null); toast({ title: "Couldn't search", description: parseApiError(err).error || "Try different words.", variant: "destructive" }); } finally { setSearching(false); }
  };

  return (
    <Card className="glass-card" data-testid="knowledge-card">
      <CardContent className="space-y-5 p-5 lg:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Knowledge</h2>
            <p className="text-sm text-muted-foreground">Tell the assistant about your business: who you serve, who you avoid, what you offer. It reads this when it looks for clients, and says which source it used. Only your workspace can see it.</p>
          </div>
          {data && <span className="shrink-0 text-xs text-muted-foreground" data-testid="knowledge-usage">{data.usage.sources} of {data.limits.sources}</span>}
        </div>

        {canEdit && (
          <form onSubmit={submit} className="space-y-3 rounded-lg border bg-muted/30 p-3" data-testid="knowledge-form">
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="What to add">
              {MODES.map(({ key, label, icon: Icon }) => (
                <button key={key} type="button" role="tab" aria-selected={mode === key} data-testid={`knowledge-mode-${key}`} onClick={() => { setMode(key); reset(); }}
                  className={cn("inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition", mode === key ? "border-primary bg-primary/10 font-medium text-foreground" : "border-transparent text-muted-foreground hover:bg-muted")}>
                  <Icon className="h-4 w-4" />{label}
                </button>
              ))}
            </div>

            {mode === "url" && (
              <div className="space-y-1.5">
                <Label htmlFor="kb-url" className="text-xs">Web page address</Label>
                <Input id="kb-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourstudio.com/about" inputMode="url" autoComplete="off" data-testid="knowledge-url" />
                <p className="text-xs text-muted-foreground">Read once, now, and its text saved. Public pages only (https). It is not checked again later.</p>
              </div>
            )}
            {(mode === "pdf" || mode === "image") && (
              <div className="space-y-1.5">
                <Label htmlFor="kb-file" className="text-xs">{mode === "pdf" ? "PDF (up to 8 MB, with selectable text)" : "Picture (PNG, JPEG or WebP, up to 5 MB)"}</Label>
                <Input id="kb-file" ref={fileRef} type="file" accept={mode === "pdf" ? "application/pdf" : "image/png,image/jpeg,image/webp"} onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="knowledge-file" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="kb-title" className="text-xs">{mode === "url" || mode === "pdf" ? "Title (optional)" : "Title"}</Label>
              <Input id="kb-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={mode === "note" ? "Who we help" : mode === "image" ? "Logo for a hotel in Lisbon" : "Taken from the page or file"} data-testid="knowledge-title" />
            </div>
            {(mode === "note" || mode === "image") && (
              <div className="space-y-1.5">
                <Label htmlFor="kb-text" className="text-xs">{mode === "note" ? "Note" : "What the picture shows"}</Label>
                <Textarea id="kb-text" value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={20000} data-testid="knowledge-text"
                  placeholder={mode === "note" ? "We design logos for boutique hotels and small restaurants in Portugal. We avoid crypto and gambling." : "A green leaf above the word Una, made for a boutique hotel in Lisbon."} />
                {mode === "image" && <p className="text-xs text-muted-foreground">The assistant can't see pictures yet. It finds a picture by this description, so use the words you'd search with.</p>}
              </div>
            )}
            <Button type="submit" disabled={!canSubmit} data-testid="knowledge-add">
              {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{mode === "url" ? "Reading the page…" : mode === "pdf" ? "Reading the PDF…" : "Adding…"}</> : "Add to knowledge"}
            </Button>
          </form>
        )}
        {!canEdit && <p className="text-xs text-muted-foreground">Only people who can change leads can add or remove knowledge.</p>}

        <div className="space-y-2" data-testid="knowledge-list">
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {data && data.sources.length === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground" data-testid="knowledge-empty">Nothing here yet. A short note about who you want as clients is a good first one.</p>}
          {data?.sources.map((s) => {
            const Icon = KIND_ICON[s.kind];
            return (
              <div key={s.id} className="flex items-start gap-3 rounded-lg border p-3" data-testid={`knowledge-source-${s.id}`}>
                {s.kind === "image" && s.hasFile
                  ? <img src={`${KNOWLEDGE_URL}/${s.id}/image`} alt="" className="h-12 w-12 shrink-0 rounded-md border object-cover" loading="lazy" />
                  : <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-muted"><Icon className="h-5 w-5 text-muted-foreground" /></span>}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{s.title}</p>
                  <p className="break-words text-xs text-muted-foreground">
                    {KIND_LABEL[s.kind]}{s.sourceUrl ? ` · ${host(s.sourceUrl)}` : s.fileName ? ` · ${s.fileName}` : ""} · {s.chunkCount} passage{s.chunkCount === 1 ? "" : "s"}{s.truncated ? " · only the first part was kept" : ""}
                  </p>
                  {s.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{s.description}</p>}
                </div>
                {canEdit && <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${s.title}`} onClick={() => setRemoving(s)} data-testid={`knowledge-remove-${s.id}`}><Trash2 className="h-4 w-4" /></Button>}
              </div>
            );
          })}
        </div>

        {data && data.sources.length > 0 && (
          <div className="space-y-2 border-t pt-4">
            <form onSubmit={runSearch} className="flex gap-2">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Try it: what would the assistant find for…" aria-label="Try a search" data-testid="knowledge-search" />
              <Button type="submit" variant="outline" disabled={searching || q.trim().length < 2} data-testid="knowledge-search-go">{searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}<span className="ml-2 hidden sm:inline">Search</span></Button>
            </form>
            <p className="text-xs text-muted-foreground">It matches words, not meaning, so use the words your own notes use.</p>
            {found && (
              <div className="space-y-2" data-testid="knowledge-results">
                {found.hits.length === 0 && <p className="text-sm text-muted-foreground">Nothing matches. Try another word.</p>}
                {found.hits.map((h) => (
                  <div key={`${h.sourceId}-${h.n}`} className="rounded-md bg-muted/40 p-2.5 text-sm">
                    <p className="text-xs font-medium text-muted-foreground">{h.title}</p>
                    <p className="line-clamp-4 whitespace-pre-line">{h.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>

      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{removing?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>The assistant will no longer use it. This can't be undone; you can add it again.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction data-testid="knowledge-remove-confirm" onClick={() => removing && remove.mutate(removing.id, { onSuccess: () => toast({ title: "Removed" }), onError })}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
