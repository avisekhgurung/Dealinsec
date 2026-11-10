/**
 * Outside research: what the rest of the web says about a company, beside what the company says about itself.
 *
 * Everything else Client Radar knows about a prospect was read from the prospect's OWN website, which is why it can
 * be called confirmed. This is the opposite kind of knowledge — a headline and a snippet from a search result, on a
 * site we never opened — so it is kept as its own kind of finding ("outside") that nothing else reads:
 *
 *   - it never counts toward "Ready", timing, the score or the fit (those read facts, signals, people — not this);
 *   - it is never written into a drafted message as a fact;
 *   - it is shown in its own section, labelled as unverified, each item with the page it came from.
 *
 * It exists for the person, as a lead to follow up: "TechCrunch says they raised a round — open it and check."
 * Pure rules, no model: a mention is kept only when the result names the company AND reads like a business event.
 */
import { evidenceDate } from "./prospect";

/** The kind every outside finding is stored under. Deliberately not one of the kinds scoring and readiness read. */
export const OUTSIDE_KIND = "outside";
export const OUTSIDE_BATCH = "outside";
export const MAX_OUTSIDE_FINDINGS = 6;

export type OutsideType = "FUNDING" | "HIRING" | "LAUNCH" | "PARTNERSHIP" | "EXPANSION" | "LEADERSHIP";
export const OUTSIDE_LABEL: Record<OutsideType, string> = {
  FUNDING: "Funding", HIRING: "Hiring", LAUNCH: "Launch", PARTNERSHIP: "Partnership", EXPANSION: "Expansion or acquisition", LEADERSHIP: "Leadership change",
};

/** Checked in this order: the more specific events first, so "raises $5M to launch…" is funding, not a launch. */
const EVENT: [OutsideType, RegExp][] = [
  ["FUNDING", /\b(?:raises?|raised|secures?|secured|closes?|closed|lands?|bags?)\b[^.]{0,60}\b(?:funding|round|seed|pre-seed|series\s+[a-e]|investment|million|billion|crore|\$\s?\d)|\b(?:funding\s+round|seed\s+round|series\s+[a-e]\b|venture\s+funding|backed\s+by)\b/i],
  ["LEADERSHIP", /\b(?:appoints?|appointed|names?|named|hires?|hired|promotes?|promoted|welcomes?)\b[^.]{0,60}\b(?:ceo|cto|cfo|cmo|coo|cro|chief\s+\w+\s+officer|president|managing\s+director|head\s+of|vp\b|vice\s+president|director)\b|\bjoins?\b[^.]{0,40}\bas\s+(?:ceo|cto|cfo|cmo|coo|head\s+of|vp\b|director)|\bnew\s+(?:ceo|cto|cmo|coo|managing\s+director)\b/i],
  ["EXPANSION", /\b(?:acquires?|acquired|acquisition\s+of|merges?\s+with|merger\s+with|expands?\s+(?:to|into|its|in)|expansion\s+(?:into|to|in)|opens?\s+(?:a\s+|its\s+)?(?:new\s+|first\s+|second\s+)?(?:office|location|store|branch|headquarters|hq|studio|facility)|enters?\s+(?:the\s+)?[\w\s]{2,25}\s+market)\b/i],
  ["PARTNERSHIP", /\b(?:partners?\s+with|partnered\s+with|partnership\s+with|announces?\s+(?:a\s+)?(?:strategic\s+)?partnership|teams?\s+up\s+with|joins?\s+forces\s+with|collaborat(?:es|ion)\s+with|integrates?\s+with|selected\s+by|signs?\s+(?:a\s+)?(?:deal|contract|agreement)\s+with)\b/i],
  ["HIRING", /\b(?:is\s+hiring|are\s+hiring|now\s+hiring|we(?:'re|\s+are)\s+hiring|hiring\s+(?:a|an|for|spree)|job\s+openings?|open\s+(?:roles?|positions?)|plans?\s+to\s+hire|to\s+hire\s+\d+)\b/i],
  ["LAUNCH", /\b(?:launch(?:es|ed|ing)?|introduc(?:es|ed|ing)|unveil(?:s|ed|ing)?|rolls?\s+out|rolled\s+out|debuts?|releases?\s+(?:a\s+|its\s+|the\s+)?(?:new\s+)?(?:product|platform|app|feature|service|version|tool)|announces?\s+(?:a\s+|its\s+|the\s+)?new)\b/i],
];

export function outsideType(text: string): OutsideType | null {
  for (const [type, re] of EVENT) if (re.test(text)) return type;
  return null;
}

const LEGAL_TAIL = /[\s,]+(?:inc|llc|ltd|limited|pvt|private|plc|gmbh|corp|corporation|co|company|llp|pty|ag|sa|bv)\.?$/i;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * How the company would be named in a headline: its name (without a legal tail), or — when all we have is the
 * domain, because nobody has read its site yet — the domain itself. Null when that would be too short or too
 * generic to tell this company from the word.
 */
export function mentionPatterns(name: string, domain: string): RegExp[] {
  const out: RegExp[] = [];
  const host = domain.toLowerCase().replace(/^www\./, "");
  if (host.includes(".")) out.push(new RegExp(`(?<![a-z0-9-])${esc(host)}(?![a-z0-9-])`, "i"));
  let n = String(name ?? "").trim();
  while (LEGAL_TAIL.test(n)) n = n.replace(LEGAL_TAIL, "").trim();
  // A real name, not the domain repeated, and long enough that it isn't an ordinary word ("Go", "Up", "Box").
  if (n && n.toLowerCase() !== host && !n.includes("/") && n.replace(/[^a-z0-9]/gi, "").length >= 4) out.push(new RegExp(`(?<![a-z0-9])${esc(n).replace(/\s+/g, "\\s+")}(?![a-z0-9])`, "i"));
  return out;
}

/** The one search made for a company: its name in quotes, next to the words business events are announced with. */
export function outsideQuery(name: string, domain: string): string {
  let n = String(name ?? "").trim();
  while (LEGAL_TAIL.test(n)) n = n.replace(LEGAL_TAIL, "").trim();
  const who = n && n.toLowerCase() !== domain.toLowerCase() ? `"${n.replace(/"/g, "").slice(0, 60)}"` : `"${domain}"`;
  return `${who} funding OR hiring OR launches OR partnership OR acquires OR appoints`;
}

export interface OutsideFinding {
  type: OutsideType; label: string;
  /** The result's own headline. */
  value: string;
  url: string;
  /** The site it is on, for "according to …". */
  publisher: string;
  /** The result's own snippet: the words this rests on. */
  quote: string;
  /** A date the headline or snippet itself states; null when it states none. Never the day we searched. */
  observedAt: Date | null;
  datePrecision: "day" | "month" | "year" | null;
}

/**
 * Search results as outside findings. A result is kept only when ALL of these hold:
 *   - it is not on the company's own site (that is the other kind of research, and is already done properly);
 *   - its headline or snippet NAMES the company — a result the search engine merely thought related is dropped,
 *     because a same-named or similar company is the classic way this kind of research goes wrong;
 *   - it reads like a business event (funding, hiring, a launch, a partnership, an expansion, a leadership change).
 * One per page, six at most, in the search engine's own order.
 */
export function outsideFindings(results: { url: string; title: string; snippet?: string }[], o: { name: string; domain: string; now: Date }): OutsideFinding[] {
  const who = mentionPatterns(o.name, o.domain);
  if (!who.length) return [];
  const own = o.domain.toLowerCase().replace(/^www\./, "");
  const out: OutsideFinding[] = [], seen = new Set<string>();
  for (const r of results) {
    let u: URL;
    try { u = new URL(r.url); } catch { continue; }
    if (u.protocol !== "https:" && u.protocol !== "http:") continue;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (host === own || host.endsWith(`.${own}`)) continue;
    const title = String(r.title ?? "").replace(/\s+/g, " ").trim(), snippet = String(r.snippet ?? "").replace(/\s+/g, " ").trim();
    const text = `${title}. ${snippet}`;
    if (!title || !who.some((re) => re.test(text))) continue;
    const type = outsideType(text);
    if (!type) continue;
    const key = `${host}${u.pathname.replace(/\/+$/, "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const d = evidenceDate(text, o.now);
    out.push({ type, label: OUTSIDE_LABEL[type], value: title.slice(0, 300), url: u.toString().slice(0, 500), publisher: host, quote: (snippet || title).slice(0, 500), observedAt: d?.at ?? null, datePrecision: d?.precision ?? null });
    if (out.length >= MAX_OUTSIDE_FINDINGS) break;
  }
  return out;
}
