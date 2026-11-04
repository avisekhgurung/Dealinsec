/** The message versions a person chooses between, and how their quality cards render: the pure part of the picker. */
import type { ScorecardComponent } from "@shared/draft-scorecard";

/**
 * The versions still waiting to be chosen, in the order they were written (strongest strategy first — their ids
 * follow the batch insert). At most one batch can exist per lead, so there is nothing to group by.
 */
export function pendingVariants<T extends { id: number; status: string }>(messages: T[]): T[] {
  return messages.filter((m) => m.status === "variant").sort((a, b) => a.id - b.id);
}

/** How a scorecard chip reads: earned in full, in part, or not at all. */
export type ChipTone = "full" | "partial" | "none";
export const chipTone = (c: Pick<ScorecardComponent, "points" | "max">): ChipTone => (c.points >= c.max ? "full" : c.points > 0 ? "partial" : "none");

/** The chip's text: a fraction where there are degrees, a plain label where it's all or nothing. */
export const chipText = (c: Pick<ScorecardComponent, "label" | "points" | "max">): string => (c.max > 1 ? `${c.label} ${c.points}/${c.max}` : c.label);

/** The shortcomings worth spelling out under the chips: every component that earned nothing, in card order. */
export const shortcomings = (components: ScorecardComponent[]): ScorecardComponent[] => components.filter((c) => c.points === 0);
