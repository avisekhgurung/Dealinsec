/**
 * What the ideal-client verdict means for WRITING to a lead. Pure: no database, no network, no model.
 *
 * The verdict itself is shared/fit.ts: plain rules over what the person typed and what the company states about
 * itself, where a missing fact is always "unknown" and never a mismatch. This module only decides what to DO with it,
 * so that one table governs every draft — a single message, three versions, a campaign, or an AI coworker's task.
 *
 *   excluded   refuse        the person's own exclusion list says not this kind of client
 *   weak       confirm       nothing matched and something mismatched: ask before spending a draft on it
 *   partial    cautious      some of it matched: write, but claim nothing the evidence doesn't carry
 *   strong     write         everything that could be checked, matched
 *   unclear    write         the profile has nothing comparable, or the lead has nothing to compare: not a reason to refuse
 *   no_profile write         no ideal client saved at all: a blank profile may not invent a restriction
 *
 * The two "write" rows at the bottom are deliberate. Silence in a profile is not a preference, so a workspace that
 * has set nothing gets exactly the behaviour it had before any of this existed.
 */
import { VERDICT_LABEL, type FitResult, type FitSignal, type FitVerdict } from "./fit";

/** What the caller should do: write it, write it carefully, ask the person first, or not write at all. */
export type FitAction = "write" | "write_cautiously" | "confirm_first" | "refuse";

const ACTION_OF: Record<FitVerdict, FitAction> = {
  excluded: "refuse",
  weak: "confirm_first",
  partial: "write_cautiously",
  strong: "write",
  unclear: "write",
  no_profile: "write",
};

export interface FitGate {
  action: FitAction;
  verdict: FitVerdict;
  /** "Strong fit", "Excluded", … — the same words the lead page shows. */
  label: string;
  /** One line on why, from the verdict itself. */
  headline: string;
  /** Each thing that was compared and how it came out: the evidence behind the verdict. */
  signals: FitSignal[];
  /** The exclusions the lead's own words hit. */
  excludedBy: string[];
  /** What the lead would need for more of the profile to be comparable. */
  missing: string[];
  /** Exclusions written as whole sentences, which the check can't compare (shared/fit.ts exclusionHits). */
  exclusionsNotCompared: string[];
  /** What to do next, in the person's terms. */
  next: string;
  /** Why a refusal or a confirmation is being asked for. Empty for the actions that just write. */
  message: string;
}

const mismatches = (signals: FitSignal[]) => signals.filter((s) => s.status === "mismatch").map((s) => s.detail);

export function draftFitGate(fit: FitResult): FitGate {
  const action = ACTION_OF[fit.verdict];
  const base = {
    action, verdict: fit.verdict, label: VERDICT_LABEL[fit.verdict], headline: fit.headline,
    signals: fit.signals, excludedBy: fit.excludedBy, missing: fit.missing,
    exclusionsNotCompared: fit.exclusionsNotCompared ?? [],
  };
  if (action === "refuse") {
    return {
      ...base,
      next: "Shorten or remove that exclusion if it isn't meant to cover this company, or archive the lead.",
      message: `You've excluded this kind of client: ${fit.excludedBy.join(", ")}. No first message was written. Change your exclusions in Settings if that isn't what you meant, or archive the lead.`,
    };
  }
  if (action === "confirm_first") {
    const why = mismatches(fit.signals);
    return {
      ...base,
      next: "Check it against your ideal client, then draft anyway if you still want to write to them.",
      message: `This lead doesn't match your ideal client${why.length ? `: ${why.join(" ")}` : "."} Nothing was written and no AI draft was used. Draft anyway if you want to write to them.`,
    };
  }
  if (action === "write_cautiously") {
    return {
      ...base,
      next: fit.missing.length ? `Research ${fit.missing.join(" and ")} to be sure of the rest.` : "Read the draft against what you actually know about them.",
      message: "",
    };
  }
  return {
    ...base,
    next: fit.verdict === "no_profile"
      ? "Set your ideal client in Settings so drafts can be checked against it."
      : fit.missing.length ? `Research ${fit.missing.join(" and ")} so more of your profile can be compared.` : "Read and approve the draft.",
    message: "",
  };
}

/** The caution a cautious draft puts in front of the model: a limit on what it may claim, never a new fact. */
export function fitCaution(gate: FitGate): string | null {
  if (gate.action !== "write_cautiously") return null;
  const why = mismatches(gate.signals);
  return [
    "This company matches only part of what the sender is looking for.",
    why.length ? `What doesn't match: ${why.join(" ")}` : null,
    "So do not assume they have the problem the sender solves, do not call them a good fit, and ask rather than assert.",
  ].filter(Boolean).join(" ");
}
