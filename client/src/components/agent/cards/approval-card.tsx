/**
 * Asks the user before the agent does something. What is shown here is the
 * server's own description of the change (validated arguments, effects in plain
 * words), never the model's wording. Nothing happens until Approve is pressed,
 * and a double click can't run it twice.
 */
import { useRef } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowRight, Check, Info, Loader2, Pencil, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProtectionFindings, type Finding } from "@/components/protection-findings";
import { approveLabel, type AgentCard } from "@shared/agent";
import type { ApprovalView } from "@/hooks/use-agent";
import { CardShell, Row } from "./card-shell";

interface Preview {
  title: string;
  lines: { label: string; value: string }[];
  effects: string[];
  draft?: {
    warnings?: string[];
    prefill?: Record<string, unknown>;
    protection?: { flags: { id: string; level: Finding["level"]; title: string; why: string; ask: string; suggestedTerm?: string }[]; passes: string[] };
  };
}

export function ApprovalCard({
  card, view, onApprove, onDecline, onEditDraft,
}: {
  card: AgentCard;
  view?: ApprovalView;
  onApprove: (approvalId: string, tool: string) => void;
  onDecline: (approvalId: string, tool: string) => void;
  onEditDraft?: (prefill: Record<string, unknown>) => void;
}) {
  const d = card.data as { approvalId: string; tool: string; risk: string; preview: Preview; expiresInMinutes?: number };
  const status = view?.status ?? "pending";
  const lock = useRef(false);
  const open = status === "pending" || status === "failed";
  const findings: Finding[] = (d.preview.draft?.protection?.flags ?? []).map((f) => ({ id: f.id, level: f.level, title: f.title, why: f.why, ask: f.ask, suggestedTerm: f.suggestedTerm }));
  const important = findings.some((f) => f.level === "important");

  const approve = () => {
    // A synchronous lock: two clicks in the same tick both see the old status.
    if (lock.current || !open) return;
    lock.current = true;
    onApprove(d.approvalId, d.tool);
    setTimeout(() => { lock.current = false; }, 1500);
  };

  return (
    <CardShell
      label={status === "done" ? "Done" : status === "declined" ? "Declined" : status === "expired" ? "Expired" : "Needs your approval"}
      icon={status === "done" ? <Check className="h-3 w-3" /> : status === "declined" || status === "expired" ? <X className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
      tone={status === "done" ? "emerald" : status === "declined" || status === "expired" ? "neutral" : important ? "amber" : "emerald"}
      testId="approval-card"
    >
      <div className="space-y-3 p-3.5">
        <p className="break-words text-sm font-semibold leading-snug">{d.preview.title}</p>

        {d.preview.lines.length > 0 && (
          <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
            {d.preview.lines.map((l) => <Row key={l.label} label={l.label}>{l.value}</Row>)}
          </div>
        )}

        {d.preview.draft?.warnings?.map((w) => (
          <p key={w} className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{w}</span>
          </p>
        ))}

        {d.preview.effects.length > 0 && open && (
          <ul className="space-y-1 rounded-lg bg-muted/50 p-2.5">
            {d.preview.effects.map((e) => (
              <li key={e} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{e}</span>
              </li>
            ))}
          </ul>
        )}

        {d.preview.draft?.protection && open && (
          <details className="group rounded-lg border border-border/70" open={important}>
            <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold text-foreground/80 [&::-webkit-details-marker]:hidden">
              Protection Check · {findings.length === 0 ? "nothing to clarify" : `${findings.length} to clarify`}
              <span className="ml-1 text-muted-foreground group-open:hidden">(show)</span>
            </summary>
            <div className="border-t border-border/70 p-3">
              <ProtectionFindings findings={findings} passes={d.preview.draft.protection.passes} />
            </div>
          </details>
        )}

        {status === "failed" && view?.message && (
          <p className="flex items-start gap-1.5 text-xs text-rose-700 dark:text-rose-400" role="alert">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{view.message}</span>
          </p>
        )}
        {(status === "expired" || status === "declined") && (
          <p className="text-xs text-muted-foreground">
            {status === "expired" ? "This request expired. Ask me again and I'll prepare it fresh." : "You declined this. Nothing was changed."}
          </p>
        )}
        {status === "done" && view?.route && (
          <Link href={view.route} className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400" data-testid="approval-open">
            Open it <ArrowRight className="h-3 w-3" />
          </Link>
        )}

        {(open || status === "executing") && (
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <Button size="sm" onClick={approve} disabled={status === "executing"} className="h-9 text-xs font-bold gradient-btn text-white" data-testid="approval-approve">
              {status === "executing" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              {status === "executing" ? "Working…" : status === "failed" ? "Try again" : approveLabel(d.tool)}
            </Button>
            <Button size="sm" variant="outline" disabled={status === "executing"} onClick={() => onDecline(d.approvalId, d.tool)} className="h-9 text-xs font-semibold" data-testid="approval-decline">
              Cancel
            </Button>
            {d.tool === "create_deal" && d.preview.draft?.prefill && onEditDraft && status !== "executing" && (
              <Button size="sm" variant="ghost" onClick={() => onEditDraft(d.preview.draft!.prefill!)} className="h-9 text-xs font-semibold" data-testid="approval-edit">
                <Pencil className="mr-1 h-3 w-3" /> Edit in form
              </Button>
            )}
          </div>
        )}
        {open && <p className="text-[11px] text-muted-foreground">Nothing happens until you approve.</p>}
      </div>
    </CardShell>
  );
}
