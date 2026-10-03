/**
 * What gets read aloud. The agent's replies are markdown with links and lists;
 * spoken as written they would say "asterisk asterisk" and read out URLs. This
 * keeps only the words, and stops at a length a person will actually listen to.
 */
export function speakable(md: string, max = 700): string {
  const t = String(md ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_`#>|]/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max).replace(/\s+\S*$/, "")}…` : t;
}
