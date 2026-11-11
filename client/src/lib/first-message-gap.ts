/**
 * Why a first message can't be written yet, said before the click, and what to do about it. The server names the gap
 * with the same rules it writes by; an older server names none, and the buttons simply work as before. Research reads
 * the company's own website, so it is only suggested for a lead that has one.
 */
export type Gap = "address" | "facts";
export function gapNote(gap: Gap | null | undefined, hasWebsite: boolean): { why: string; fix: string } | null {
  if (gap === "address") return {
    why: "This lead has no email address yet, so there is nowhere to send a message.",
    fix: hasWebsite ? "Add a contact email to the lead (Edit). Researching their website can also find a business address." : "Add a contact email to the lead (Edit).",
  };
  if (gap === "facts") return {
    why: "Nothing is verified about this company yet, so there is nothing true to write from.",
    fix: hasWebsite ? "Research the lead first: I read the company's own website and record what it says." : "Add the company's website to the lead (Edit), then research it.",
  };
  return null;
}

/**
 * Whether the person may start the message themselves. Their own words need somewhere to go, and nothing else: no
 * verified facts (that is the model's rule) and no AI drafts left. An older server that names no gap decides for itself.
 */
export const canWriteOwn = (gap: Gap | null | undefined): boolean => gap !== "address";

/** The length rules for a person's own first message, in the words of the form (shared/outreach-check.ts LIMITS). */
export function ownMessageProblem(subject: string, body: string, limits: { subjectMin: number; subjectMax: number; bodyMin: number; bodyMax: number }): string | null {
  const s = subject.trim().length, b = body.trim().length;
  if (s === 0 && b === 0) return "";                                   // nothing typed yet: no complaint, and nothing to save
  if (s < limits.subjectMin) return `Add a subject (at least ${limits.subjectMin} characters).`;
  if (s > limits.subjectMax) return `The subject is too long (${limits.subjectMax} characters at most).`;
  if (b < limits.bodyMin) return `Write a little more: the message needs at least ${limits.bodyMin} characters (${b} so far).`;
  if (b > limits.bodyMax) return `The message is too long (${limits.bodyMax} characters at most).`;
  return null;
}
