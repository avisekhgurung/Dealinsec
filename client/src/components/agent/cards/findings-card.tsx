import { ProtectionFindings, type Finding } from "@/components/protection-findings";
import type { AgentCard } from "@shared/agent";
import { CardShell } from "./card-shell";

/** The Protection Check, from the app's own rules — the same component the deal page uses. */
export function FindingsCard({ card }: { card: AgentCard }) {
  const d = card.data as { findings: Finding[]; passes?: string[] };
  const important = d.findings.some((f) => f.level === "important");
  return (
    <CardShell tone={d.findings.length === 0 ? "emerald" : important ? "rose" : "amber"} testId="findings-card">
      <div className="p-3.5">
        <ProtectionFindings findings={d.findings} passes={d.passes ?? []} />
      </div>
    </CardShell>
  );
}
