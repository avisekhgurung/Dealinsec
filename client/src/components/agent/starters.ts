import type { AudienceState } from "@/hooks/use-audience";

/** What to offer on an empty conversation. Chips send a message; the first one
 *  only fills the box, because it needs the user's own pasted text. */
export function starters(a: Pick<AudienceState, "partyLower" | "isBrand">) {
  const paste = a.isBrand
    ? "Here's a message from a brand. Handle this deal:\n\n"
    : "Here's a message from a client. Handle this deal:\n\n";
  return {
    paste,
    pasteLabel: `Paste a ${a.partyLower} message`,
    prompts: [
      "Find me companies that could use my services",
      "What should I do on my leads today?",
      "What needs my attention?",
      `Which ${a.partyLower}s owe me money?`,
      "Show the payment status of everything",
      "What can I invoice today?",
    ],
  };
}
