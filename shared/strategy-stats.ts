/**
 * What each outreach strategy actually achieved: plain counts of real events, grouped by strategy and prompt
 * version. Nothing here predicts anything — reply rates are never estimated, only counted after the fact, and
 * every share names its denominator. With too small a sample the share is withheld entirely (null), so the UI
 * cannot crown a "winning" strategy off three messages.
 *
 * Counted from lead_messages and outreach_events (server/sales/strategy-stats.ts):
 *   generated  messages the AI wrote with this strategy in the window (versions and single drafts);
 *   shown      of those, versions offered side by side in a batch;
 *   chosen     versions a person picked over their siblings;
 *   approved   messages a person approved (at any point; an approval later edited or discarded still happened);
 *   edited     approved messages the person changed first (the edited flag with an approval);
 *   sent       messages that went out (recorded by hand or sent from Gmail);
 *   replied / bounced / optedOut   what came back, once per message however it was recorded
 *                                  (a manual note and the Gmail sync write the same event once).
 * The window is by when the MESSAGE was written; its outcomes count whenever they arrive.
 */

export const STRATEGY_WINDOWS = [30, 90] as const;
export type StrategyWindow = (typeof STRATEGY_WINDOWS)[number];
export const parseStrategyWindow = (raw: unknown): StrategyWindow => (raw === "90" || raw === 90 ? 90 : 30);

export interface StrategyStatRow {
  strategy: string;
  promptVersion: string;
  generated: number; shown: number; chosen: number; approved: number; edited: number;
  sent: number; replied: number; bounced: number; optedOut: number;
}

/** Below this many sent messages, a share says more about luck than about the strategy, so none is shown. */
export const MIN_TO_COMPARE = 5;

/** Replies as a share of SENT messages (that is the denominator), in whole percent; null until MIN_TO_COMPARE are sent. */
export const replyShare = (r: Pick<StrategyStatRow, "sent" | "replied">): number | null =>
  r.sent >= MIN_TO_COMPARE ? Math.round((100 * r.replied) / r.sent) : null;

/** How often this version was picked when SHOWN beside others (denominator: shown), in whole percent; null until MIN_TO_COMPARE were shown. */
export const chosenShare = (r: Pick<StrategyStatRow, "shown" | "chosen">): number | null =>
  r.shown >= MIN_TO_COMPARE ? Math.round((100 * r.chosen) / r.shown) : null;

/**
 * The caution the table carries while samples are small: comparing strategies needs at least two of them with
 * MIN_TO_COMPARE sent messages each. Null once a comparison is honest.
 */
export function sampleNote(rows: Pick<StrategyStatRow, "sent">[]): string | null {
  if (rows.filter((r) => r.sent >= MIN_TO_COMPARE).length >= 2) return null;
  return `Too few sent messages to compare strategies yet — these are plain counts of what happened, not a verdict. Shares appear once a strategy has ${MIN_TO_COMPARE} sent messages.`;
}
