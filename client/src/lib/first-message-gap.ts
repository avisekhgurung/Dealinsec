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
