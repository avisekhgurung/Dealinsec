/**
 * Two things share this card: what the agent read out of a pasted message
 * (every field tagged stated / inferred / not specified / conflicting, so a
 * guess can never pass for a fact), and a saved deal's summary.
 */
import { Link } from "wouter";
import { ArrowRight, Briefcase, FileSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentCard } from "@shared/agent";
import { NOT_SPECIFIED } from "@shared/audience";
import { CardShell, Row } from "./card-shell";

interface Field { key: string; label: string; value: string | null; status: "explicit" | "inferred" | "missing" | "conflicting"; evidence?: string | null; alternatives?: string[] }

const TAG: Record<Field["status"], { text: string; cls: string }> = {
  explicit: { text: "Stated", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" },
  inferred: { text: "Inferred", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300" },
  conflicting: { text: "Conflicting", cls: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300" },
  missing: { text: "Not specified", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
};

export function DealCard({ card }: { card: AgentCard }) {
  const d = card.data as any;
  if (d.extracted) return <Extracted d={d} />;
  return (
    <CardShell label="Deal" icon={<Briefcase className="h-3 w-3" />} testId="deal-card">
      <div className="grid grid-cols-1 gap-x-3 gap-y-2 p-3.5 sm:grid-cols-2">
        <Row label="Client">{d.client}</Row>
        <Row label="Project">{d.project}</Row>
        <Row label="Amount"><span className="tabular-nums">{d.amount}</span></Row>
        <Row label="Status">{d.status}</Row>
        <Row label="Timeline">{d.timeline}</Row>
        {Array.isArray(d.deliverables) && d.deliverables.length > 0 && <Row label="Deliverables">{d.deliverables.join(" · ")}</Row>}
      </div>
      {d.route && (
        <div className="border-t border-border/70 px-3.5 py-2.5">
          <Link href={d.route} className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400">
            Open deal <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}
    </CardShell>
  );
}

function Extracted({ d }: { d: { fields: Field[]; missing: string[]; conflicts: string[]; warnings: string[] } }) {
  // The amount line already carries its currency; a separate row only matters
  // when the message is unclear about which currency it means.
  const shown = d.fields.filter((f) => f.status !== "missing" && !(f.key === "currency" && f.status === "explicit"));
  return (
    <CardShell label="What the message says" icon={<FileSearch className="h-3 w-3" />} tone="emerald" testId="extracted-deal-card">
      <ul className="divide-y divide-border/60">
        {shown.map((f) => (
          <li key={f.key} className="flex items-start justify-between gap-3 px-3.5 py-2" title={f.evidence ? `From the message: “${f.evidence}”` : undefined}>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{f.label}</p>
              <p className="break-words text-sm font-semibold">
                {f.status === "conflicting" ? f.alternatives?.join("  /  ") : f.value ?? <span className="font-normal text-muted-foreground">{NOT_SPECIFIED}</span>}
              </p>
              {f.status === "inferred" && <p className="text-[11px] text-amber-700 dark:text-amber-400">Not stated in the message. Check it before relying on it.</p>}
            </div>
            <span className={cn("mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", TAG[f.status].cls)}>{TAG[f.status].text}</span>
          </li>
        ))}
      </ul>
      {d.warnings?.map((w) => <p key={w} className="border-t border-border/60 px-3.5 py-2 text-xs text-amber-700 dark:text-amber-400">{w}</p>)}
      {d.missing.length > 0 && (
        <p className="border-t border-border/60 px-3.5 py-2.5 text-xs text-muted-foreground" data-testid="extracted-missing">
          <span className="font-semibold text-foreground/80">Not specified:</span> {d.missing.join(", ")}
        </p>
      )}
    </CardShell>
  );
}
