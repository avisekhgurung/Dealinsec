import { useQuery } from "@tanstack/react-query";
import { MessageSquare, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface SessionRow { id: string; title: string | null; state: string; updatedAt: string }

const when = (iso: string) => {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

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
  const { data, isLoading } = useQuery<SessionRow[]>({ queryKey: ["/api/agent/sessions"], staleTime: 15_000 });

  const remove = async (s: SessionRow) => {
    const ok = await confirm({
      title: "Delete this conversation?",
      description: "The messages are deleted. Deals, quotations and other records the agent created stay.",
      confirmText: "Delete", destructive: true,
    });
    if (!ok) return;
    try {
      await apiRequest("DELETE", `/api/agent/sessions/${s.id}`);
      await queryClient.invalidateQueries({ queryKey: ["/api/agent/sessions"] });
      onDeleted(s.id);
    } catch {
      toast({ title: "Couldn't delete that conversation." });
    }
  };

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
        <ul className="space-y-0.5">
          {data?.map((s) => (
            <li key={s.id} className="group relative">
              <button type="button" onClick={() => onOpen(s.id)}
                className={cn("flex w-full min-w-0 items-start gap-2 rounded-lg px-2.5 py-2 pr-9 text-left transition-colors hover:bg-muted/60", activeId === s.id && "bg-emerald-50 dark:bg-emerald-950/30")}>
                <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{s.title || "New conversation"}</span>
                  <span className="block text-[11px] text-muted-foreground">{when(s.updatedAt)}</span>
                </span>
              </button>
              <button type="button" onClick={() => remove(s)} aria-label={`Delete ${s.title || "conversation"}`}
                className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground opacity-100 transition hover:bg-muted hover:text-rose-600 lg:opacity-0 lg:focus:opacity-100 lg:group-hover:opacity-100">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
