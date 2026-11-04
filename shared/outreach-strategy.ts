/**
 * Which way a first outreach message can be built, decided by plain rules from the evidence at hand.
 * Deterministic and model-free: the same facts always offer the same strategies, so a person can be told
 * exactly why each version of a message exists and what it is built on.
 *
 * Four ways to open:
 *   trigger  — something just happened at the company (news, a launch, hiring, a buying signal): open with it.
 *   problem  — the research suggests a possible problem: ask about it gently (a guess, never stated as fact).
 *   value    — the sender has said what they offer AND the research found a concrete opportunity (or the
 *              sender chose to offer a sample): centre what the sender could do for them.
 *   direct   — a plain introduction with one low-pressure ask. Always possible; the only way when nothing
 *              above is grounded.
 *
 * A strategy is offered only when the evidence for it exists, and each choice names the claim ids it is built
 * on — the same ids lead_messages.claim_ids stores. The Client Radar angle may ground a strategy too; its
 * evidence lives in another table, so it contributes to the reason, never a claim id.
 *
 * This module selects; it promises nothing about results. What each strategy actually achieves is measured
 * afterwards from what really happened (approvals, sends, replies), never predicted here.
 */
import { normField } from "./lead-score";

export type OutreachStrategy = "trigger" | "problem" | "value" | "direct";
export const OUTREACH_STRATEGIES: readonly OutreachStrategy[] = ["trigger", "problem", "value", "direct"];
/** How many versions of a message one request may generate: the top strategies, one message each. */
export const MAX_VARIANTS = 3;

export const STRATEGY_LABEL: Record<OutreachStrategy, string> = {
  trigger: "Something just happened",
  problem: "A possible problem",
  value: "What you could do for them",
  direct: "Straight introduction",
};
/** Why a version reads the way it does, shown under its label when choosing between versions. */
export const STRATEGY_HINT: Record<OutreachStrategy, string> = {
  trigger: "Opens with the most recent thing that happened at the company.",
  problem: "Asks gently about a possible problem the research noticed.",
  value: "Centres what you could concretely do for them.",
  direct: "A plain introduction and one small ask, with nothing presumed.",
};

/** One piece of evidence a strategy can be built on: a lead claim (id, normalized field, value). */
export interface StrategyEvidence { id: number; field: string; value: string }

export interface StrategyInput {
  /** Confirmed facts about the company (server/sales/outreach.ts draftFacts fields). */
  facts: StrategyEvidence[];
  /** Labelled guesses (pain_point, opportunity, buying_signal, timing). */
  angles: StrategyEvidence[];
  /** The Client Radar angle, when the lead came from there. Its evidence is findings, not claims. */
  radar: { problem: string | null; opportunity: string | null } | null;
  /** Whether the sender has described, in their own words, what they offer. */
  offerDescribed: boolean;
  /** Whether the sender chose to offer the proof-of-value sample. */
  sampleAvailable: boolean;
}

export interface StrategyChoice {
  strategy: OutreachStrategy;
  /** Why this version exists, in the person's words. */
  reason: string;
  /** The claims this strategy is built on (empty for "direct", and for grounds that aren't claims). */
  evidenceIds: number[];
}

/** What just happened: facts that date themselves, and guesses about timing. */
const TRIGGER_FACTS = new Set(["recent_news", "launch", "hiring"]);
const TRIGGER_ANGLES = new Set(["buying_signal", "timing"]);
const TRIGGER_PHRASE: Record<string, string> = {
  recent_news: "their recent news", launch: "a recent launch", hiring: "that they're hiring",
  buying_signal: "a possible buying signal", timing: "a sign the timing may be right",
};

const byField = (xs: StrategyEvidence[], wanted: Set<string>) => xs.filter((x) => wanted.has(normField(x.field)));
const unique = <T>(xs: T[]) => Array.from(new Set(xs));

/**
 * Every strategy the evidence supports, strongest first (trigger > problem > value > direct). "direct" is
 * always last and always present, so the list is never empty. Callers generating variants take the first
 * MAX_VARIANTS.
 */
export function selectStrategies(i: StrategyInput): StrategyChoice[] {
  const out: StrategyChoice[] = [];

  const triggers = [...byField(i.facts, TRIGGER_FACTS), ...byField(i.angles, TRIGGER_ANGLES)];
  if (triggers.length) {
    const named = unique(triggers.map((t) => TRIGGER_PHRASE[normField(t.field)] ?? normField(t.field))).slice(0, 2);
    out.push({ strategy: "trigger", reason: `Opens with ${named.join(" and ")}.`, evidenceIds: triggers.map((t) => t.id) });
  }

  const pains = byField(i.angles, new Set(["pain_point"]));
  if (pains.length || i.radar?.problem?.trim()) {
    out.push({
      strategy: "problem",
      reason: pains.length ? "Asks gently about a possible problem the research noticed." : "Asks gently about a possible problem the earlier research suggested.",
      evidenceIds: pains.map((p) => p.id),
    });
  }

  const opportunities = byField(i.angles, new Set(["opportunity"]));
  if (i.offerDescribed && (i.sampleAvailable || opportunities.length || i.radar?.opportunity?.trim())) {
    out.push({
      strategy: "value",
      reason: i.sampleAvailable ? "Centres the small sample you offered to prepare." : "Centres a concrete opportunity the research found.",
      evidenceIds: opportunities.map((o) => o.id),
    });
  }

  out.push({
    strategy: "direct",
    reason: i.offerDescribed ? "A plain introduction and one small ask, with nothing presumed." : "One honest question about the company, since you haven't described your offer yet.",
    evidenceIds: [],
  });
  return out;
}
