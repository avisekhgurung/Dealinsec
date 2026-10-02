/**
 * From the model's raw reading of a pasted message to everything the agent
 * shows and offers: the verified extraction, the deal it supports, the existing
 * Protection Check run on what the message states, a compact summary for the
 * model and the cards for the person.
 *
 * Pure. The tool fetches the raw JSON from the (tool-less) extraction call and
 * hands it here; the evaluation suite hands it scripted outputs, so the same
 * code is tested with no provider and no database.
 */
import type { Audience } from "@shared/audience";
import type { LocaleSettings } from "@shared/schema";
import { analyzeDealProtections } from "../copilot/riskcheck";
import { protectionPayload } from "../copilot/proposals";
import { normalizeExtraction, protectionInput, suggestedDeal, type Extraction, type FieldKey, type SuggestedDeal } from "./extraction";
import type { AgentCard } from "./types";

const STATUS_TAG: Record<string, string> = { explicit: "stated", inferred: "inferred (not stated)", missing: "not specified", conflicting: "CONFLICTING" };

export interface Analysis {
  extraction: Extraction;
  deal: SuggestedDeal;
  warnings: string[];
  protection: ReturnType<typeof protectionPayload>;
  summary: string;
  cards: AgentCard[];
}

export function buildAnalysis(raw: unknown, source: string, audience: Audience, settings: LocaleSettings): Analysis {
  const extraction = normalizeExtraction(raw, source, audience);
  const { deal, warnings } = suggestedDeal(extraction, audience, settings.currency);
  const protection = protectionPayload(analyzeDealProtections(protectionInput(extraction, audience) as any, settings));

  const fieldLines = Object.values(extraction.fields)
    .filter((f) => f.status !== "missing" || (["amount", "brand"] as FieldKey[]).includes(f.key))
    .map((f) => `- ${f.label}: ${f.status === "conflicting" ? f.alternatives.join(" / ") : f.display ?? "—"} [${STATUS_TAG[f.status]}]${f.downgraded ? " (the quote didn't match the message)" : ""}`);

  const summary = [
    "What the message says:",
    ...fieldLines,
    extraction.missing.length ? `Not specified: ${extraction.missing.join(", ")}.` : "",
    extraction.conflicts.length ? `Conflicting: ${extraction.conflicts.join(", ")}.` : "",
    ...warnings.map((w) => `Warning: ${w}`),
    protection.flags.length ? `Protection Check on what it states (${protection.flags.length}): ${protection.flags.map((f) => f.title).join("; ")}.` : "Protection Check found nothing to flag in what it states.",
    `For create_deal use exactly these fields (only what the message states — add nothing): ${JSON.stringify(deal)}`,
  ].filter(Boolean).join("\n");

  const cards: AgentCard[] = [
    {
      kind: "deal",
      data: {
        extracted: true,
        fields: Object.values(extraction.fields)
          .filter((f) => f.status !== "missing" || extraction.missing.includes(f.label))
          .map((f) => ({ key: f.key, label: f.label, value: f.display, status: f.status, evidence: f.evidence, alternatives: f.alternatives })),
        missing: extraction.missing, conflicts: extraction.conflicts, warnings, suggestedDeal: deal,
      },
    },
    { kind: "findings", data: { title: "Protection Check", findings: protection.flags, passes: protection.passes } },
  ];
  return { extraction, deal, warnings, protection, summary, cards };
}
