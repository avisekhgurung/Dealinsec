/** The follow-up draft text (followups.ts): a fixed template filled from the lead. Pure, no model, no database. */

/** The follow-up text for a step: short, polite, with a plain way to say "stop". Pure. */
export function followupText(i: { step: number; greetName: string | null; company: string; subject: string; sender: string }): { subject: string; body: string } {
  const topic = i.subject.replace(/^(re|fw|fwd)\s*:\s*/i, "").trim() || "my earlier note";
  const subject = `Re: ${topic}`.slice(0, 200);
  const hello = i.greetName ? `Hi ${i.greetName.split(/\s+/)[0]},` : "Hello,";
  const body = i.step <= 1
    ? `${hello}\n\nI wanted to follow up on my note about "${topic}". If it would help ${i.company}, I'm happy to share a couple of ideas on a short call or by email.\n\nIf the timing isn't right, just reply and let me know, and I won't follow up again.\n\n${i.sender}`
    : `${hello}\n\nOne last note from me on this. If ${i.company} isn't looking at it right now, no problem: I'll leave it here. If it is, a quick reply is all it takes and I'll send over a few ideas.\n\nThanks,\n${i.sender}`;
  return { subject, body };
}
