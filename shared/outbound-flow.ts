/**
 * Where the person is in AI Outbound, from real state only: what they've typed and confirmed, the selected search's
 * status and stage, whether its prospects reached Leads, and the outreach queue counts this session has loaded.
 * A step is checked only when the thing it names has actually happened; nothing advances on a timer.
 *
 *   1 Describe who you want          current: nothing selected yet, or reading a new description
 *   2 Confirm the profile            current: the profile is shown for confirming
 *   3 Research                       current: the selected search is running (with its real stage), or it stopped
 *                                    or finished with nothing that passed; done: the search finished
 *   4 Review prospects               current: a search has results, or All prospects is open;
 *                                    done: a prospect from it is in Leads, or outreach has messages
 *   5 Add to Leads & first message   current: Outreach is open with nothing in it; done: outreach has a message
 *   6 Approve, send, mark sent       current: Outreach is open with messages; done: a message is recorded as sent
 */
export const FLOW_STEPS = [
  "Describe who you want",
  "Confirm the profile",
  "Research",
  "Review prospects",
  "Add to Leads & prepare a first message",
  "Approve, send from your own email, mark sent",
] as const;

export interface FlowInput {
  view: "searches" | "prospects" | "outreach";
  /** A new search being described (its description is being read) or confirmed. */
  composing: "reading" | "confirming" | null;
  /** The selected search, when there is one. */
  run: { status: string; stage: string } | null;
  /** Prospects that passed the checks in that search: a number when loaded, null when not known yet. */
  results: number | null;
  /** A prospect from that search is already in Leads. */
  anyInLeads: boolean;
  /** Outreach counts loaded in this session (waiting = draft/approved/sending), or null when not loaded. */
  queue: { waiting: number; sent: number } | null;
}

/** `notes`/`warn` per step (index 0 = step 1): the research step's real stage, or why it stopped. */
export interface FlowState { current: number; done: boolean[]; notes: (string | null)[]; warn: boolean[]; working: boolean }

export function flowState(i: FlowInput, stageLabels: Record<string, string> = {}): FlowState {
  const notes: (string | null)[] = FLOW_STEPS.map(() => null);
  const warn = FLOW_STEPS.map(() => false);
  if (i.composing) {
    const current = i.composing === "reading" ? 1 : 2;
    if (i.composing === "reading") notes[0] = "Reading your description";
    return { current, done: FLOW_STEPS.map((_, n) => n + 1 < current), notes, warn, working: i.composing === "reading" };
  }
  const run = i.run;
  const messages = i.queue ? i.queue.waiting + i.queue.sent : 0;
  const done = [!!run, !!run, run?.status === "done", i.anyInLeads || messages > 0, messages > 0, (i.queue?.sent ?? 0) > 0];
  const running = run?.status === "running";
  if (run && running) notes[2] = stageLabels[run.stage] ?? "Working";
  else if (run?.status === "cancelled" || run?.status === "failed") { notes[2] = run.status === "cancelled" ? "Stopped" : "Couldn't finish"; warn[2] = true; }
  else if (run?.status === "done" && i.results === 0) { notes[2] = "Nothing passed the checks"; warn[2] = true; }
  let current: number;
  if (i.view === "outreach") current = i.queue && messages === 0 ? 5 : 6;
  else if (i.view === "prospects") current = 4;
  else if (!run) current = 1;
  else if (running) current = 3;
  // A search that stopped, or found nothing, stays on research; partial results can still be reviewed.
  else current = i.results === 0 ? 3 : 4;
  return { current, done, notes, warn, working: running && current === 3 };
}
