import type { AgentCard } from "@shared/agent";
import { BOT_IDENTITY, isBot } from "@shared/ai-league";
import { Mascot } from "@/components/ai-league/mascot";
import { cn } from "@/lib/utils";
import { CardShell } from "./card-shell";

/** AI League: one coworker asked a teammate for help, and what the teammate said (from the teammate's own records). */
export function TeammateCard({ card }: { card: AgentCard }) {
  const { from, to, question, answer, dropped } = card.data as { from?: unknown; to?: unknown; question?: unknown; answer?: unknown; dropped?: unknown };
  if (!isBot(from) || !isBot(to)) return null;
  const f = BOT_IDENTITY[from], t = BOT_IDENTITY[to];
  return (
    <CardShell label={`${f.name} asked ${t.name}`} testId="teammate-card">
      <div className="space-y-2.5 px-3.5 py-3 text-sm">
        <div className="flex items-start gap-2.5">
          <Mascot bot={from} size={28} />
          <p className="min-w-0 flex-1 text-muted-foreground"><span className={cn("font-medium", f.accent.fg)}>{f.name}:</span> {String(question ?? "")}</p>
        </div>
        <div className="flex items-start gap-2.5">
          <Mascot bot={to} size={28} />
          <p className={cn("min-w-0 flex-1 rounded-lg px-2.5 py-1.5", t.accent.soft)}>
            <span className={cn("font-medium", t.accent.fg)}>{t.name}:</span>{" "}
            {typeof answer === "string" && answer ? answer : dropped ? "Not shown: the answer mentioned a figure that isn't in your records." : "Had nothing to add."}
          </p>
        </div>
        <p className="text-[11px] text-muted-foreground">Advice from your workspace records. Nothing was changed.</p>
      </div>
    </CardShell>
  );
}
