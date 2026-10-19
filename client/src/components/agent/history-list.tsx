import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare, MoreHorizontal, Pencil, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface SessionRow { id: string; title: string | null; state: string; updatedAt: string; pinned?: boolean }

const SESSIONS = ["/api/agent/sessions"];
const when = (iso: string) => {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};
/** The server's own reason ("You can pin up to 10…"), from the request helper's "409: {json}" error. */
const reasonOf = (e: unknown, fallback: string) => {
  const m = /^\d{3}: ([\s\S]*)$/.exec(String((e as Error)?.message ?? ""));
  try { return (m && JSON.parse(m[1]).error) || fallback; } catch { return fallback; }
};

/**
 * Agent mode's conversations: pinned ones first, then recent. Each can be pinned, renamed (inline) or deleted from its
 * menu; the server decides (your own conversations only, at most 10 pinned).
 */
export function HistoryList({
  activeId, onOpen, onNew, onDeleted,
}: {
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDeleted: (id: string) => void;
}) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<SessionRow[]>({ queryKey: SESSIONS, staleTime: 15_000 });
  const [renaming, setRenaming] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: SESSIONS });
  const remove = async (s: SessionRow) => {
    const ok = await confirm({
      title: "Delete this conversation?",
      description: "The messages are deleted. Deals, quotations and other records the agent created stay.",
      confirmText: "Delete", destructive: true,
    });
    if (!ok) return;
    try {
      await apiRequest("DELETE", `/api/agent/sessions/${s.id}`);
      await refresh();
      onDeleted(s.id);
    } catch {
      toast({ title: "Couldn't delete that conversation." });
    }
  };
  const pin = async (s: SessionRow, pinned: boolean) => {
    try {
      await apiRequest("PUT", `/api/agent/sessions/${s.id}/pin`, { pinned });
      await refresh();
    } catch (e) {
      toast({ title: pinned ? "Couldn't pin it" : "Couldn't unpin it", description: reasonOf(e, "Try again in a moment."), variant: "destructive" });
    }
  };
  const rename = async (s: SessionRow, title: string) => {
    setRenaming(null);
    const t = title.trim();
    if (!t || t === (s.title ?? "")) return;
    // Show the new name at once; the list reloads from the server either way.
    queryClient.setQueryData<SessionRow[]>(SESSIONS, (cur) => cur?.map((r) => (r.id === s.id ? { ...r, title: t } : r)));
    try { await apiRequest("PATCH", `/api/agent/sessions/${s.id}`, { title: t }); }
    catch (e) { toast({ title: "Couldn't rename it", description: reasonOf(e, "Try again in a moment."), variant: "destructive" }); }
    finally { void refresh(); }
  };

  const pinned = (data ?? []).filter((s) => s.pinned);
  const recent = (data ?? []).filter((s) => !s.pinned);
  const row = (s: SessionRow) => (
    <li key={s.id} className="group relative" data-testid={`agent-session-${s.id}`}>
      {renaming === s.id ? (
        <RenameField initial={s.title ?? ""} onDone={(t) => void rename(s, t)} onCancel={() => setRenaming(null)} />
      ) : (
        <button type="button" onClick={() => onOpen(s.id)} aria-current={activeId === s.id ? "page" : undefined}
          className={cn("flex w-full min-w-0 items-start gap-2 rounded-lg px-2.5 py-2 pr-9 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60", activeId === s.id && "bg-emerald-50 dark:bg-emerald-950/30")}>
          {s.pinned ? <Pin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-label="Pinned" /> : <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{s.title || "New conversation"}</span>
            <span className="block text-[11px] text-muted-foreground">{when(s.updatedAt)}</span>
          </span>
        </button>
      )}
      {renaming !== s.id && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={`Options for ${s.title || "conversation"}`} data-testid="agent-session-menu"
              className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground opacity-100 transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 data-[state=open]:opacity-100 lg:opacity-0 lg:focus:opacity-100 lg:group-hover:opacity-100">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={() => void pin(s, !s.pinned)} data-testid="agent-session-pin">
              {s.pinned ? <><PinOff className="mr-2 h-4 w-4" />Unpin</> : <><Pin className="mr-2 h-4 w-4" />Pin to top</>}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setRenaming(s.id)} data-testid="agent-session-rename"><Pencil className="mr-2 h-4 w-4" />Rename</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void remove(s)} className="text-rose-600 focus:text-rose-700" data-testid="agent-session-delete"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="agent-history">
      <div className="p-3">
        <Button onClick={onNew} variant="outline" className="h-10 w-full justify-start gap-2 text-sm font-semibold" data-testid="agent-new">
          <Plus className="h-4 w-4" /> New conversation
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {isLoading && <div className="space-y-2 px-1.5" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />)}</div>}
        {data?.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted-foreground">Your conversations will appear here.</p>}
        {pinned.length > 0 && (
          <section aria-labelledby="agent-pinned-h" className="mb-2">
            <h3 id="agent-pinned-h" className="px-2.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pinned</h3>
            <ul className="space-y-0.5" data-testid="agent-pinned">{pinned.map(row)}</ul>
          </section>
        )}
        {recent.length > 0 && (
          <section aria-labelledby="agent-recent-h">
            {pinned.length > 0 && <h3 id="agent-recent-h" className="px-2.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recent</h3>}
            <ul className="space-y-0.5" data-testid="agent-recent">{recent.map(row)}</ul>
          </section>
        )}
      </div>
    </div>
  );
}

/** Inline rename: Enter saves, Escape or leaving the field without a change cancels. */
function RenameField({ initial, onDone, onCancel }: { initial: string; onDone: (t: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onDone(value); }} className="px-1 py-1">
      <input ref={ref} value={value} maxLength={80} onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } }}
        onBlur={() => (value.trim() && value.trim() !== initial ? onDone(value) : onCancel())}
        aria-label="Conversation name" data-testid="agent-session-rename-input"
        className="h-9 w-full rounded-lg border border-emerald-500 bg-background px-2.5 text-sm outline-none ring-2 ring-emerald-500/30" />
    </form>
  );
}
