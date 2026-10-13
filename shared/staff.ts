/**
 * Does a named person WORK AT the company whose site is being read? Pure. The model proposes a person and names their
 * employer; this module decides from the page text alone, so a model that calls a client "staff" is not believed.
 *
 *   negative: the role line names another company ("CEO at Orchard Labs", "Head of Marketing, Brightline"), the role is a
 *             past one ("Former CEO"), or the name only appears as a quoted client (testimonial, review, case study)
 *   positive: the role line names THIS company ("Northwind Co-founder", "CEO of Northwind"), "our founder", "founded by",
 *             or a listing on a team / leadership page (the reader's people block, or "Meet the team")
 *   neither:  unknown, and an unknown person is not kept. A senior title, or a name somewhere on the site, is not evidence.
 * A previous role elsewhere ("Founder, formerly VP at Brightline") is not held against a current role here.
 */
import { nameFromDomain } from "./discovery";

/** Headers the page reader puts above its people lines (server/outbound/providers.ts); the check below reads them back. */
export const STAFF_BLOCK = "[People on this page]";
export const QUOTED_BLOCK = "[People quoted on this page (testimonials, reviews, case studies): not staff unless the line names this company]";
const OTHER_BLOCK = /^\[[^\]\n]{3,140}\]$/m;

export type Employment = { verdict: "staff"; why: "explicit" | "team_listing" } | { verdict: "not_staff"; why: "works_elsewhere" | "former_role" | "quoted_only" | "conflicting" } | { verdict: "unknown"; why: "no_evidence" };
interface Target { site: string; companyName?: string }

const ROLE = /\b(founder|co-?founder|owner|ceo|cto|coo|cmo|cfo|cro|cso|president|partner|principal|director|head|vp|vice president|manager|lead|chief|officer|strategist|specialist|consultant|designer|developer|engineer|marketer|executive|coordinator|analyst|associate|editor|writer|producer|architect|advisor|chair(?:man|woman|person)?)\b/i;
const FORMER = /\b(former(?:ly)?|previously|prior(?:ly)?|ex-|past|retired|until \d{4}|before (?:that|joining))\b/i;
const LEGAL = /\b(inc|llc|ltd|llp|limited|corp|co|gmbh|pvt|plc)\.?$/i;

const flat = (s: string) => s.normalize("NFKC").replace(/[‘’‛′]/g, "'").replace(/[“”„″]/g, '"').replace(/[‐-―−]/g, "-").replace(/[ \t ]+/g, " ");
const compact = (s: string) => s.toLowerCase().replace(LEGAL, "").replace(/[^a-z0-9]/g, "");

/** True when `text` names the target company: its name, or the brand part of its domain. */
export function namesCompany(text: string, t: Target): boolean {
  const c = compact(text.trim());
  if (c.length < 3) return false;
  if (nameFromDomain(text, t.site)) return true;
  const n = t.companyName ? compact(t.companyName) : "";
  return !!n && n.length >= 3 && (c === n || c.startsWith(n));
}

/**
 * The role a line gives a person, split into its current part and what it says about the employer. `elsewhere` is a
 * company named with "at", "@" or a trailing ", Company" that is not the target; `here` is true when the current part
 * names the target in any form ("at Northwind", "of Northwind", "Northwind Co-founder", ", Northwind").
 */
export function roleAffiliation(role: string, t: Target): { current: string; former: boolean; here: boolean; elsewhere: string | null } {
  const line = flat(role).split("\n")[0].replace(/^[\s,:;|–—-]+/, "").slice(0, 160);
  const cut = line.search(FORMER);
  const current = (cut >= 0 ? line.slice(0, cut) : line).replace(/[\s,;:(|–—-]+$/, "").trim();
  if (!ROLE.test(current)) return { current, former: cut >= 0 && ROLE.test(line), here: false, elsewhere: null };
  let here = false, elsewhere: string | null = null;
  const parts = current.split(/\s*,\s*/);
  // "at X" only inside a role ("CEO at Orchard Labs"), and X a name: "Founder, speaks at conferences" names no employer.
  for (const part of parts.filter((x) => ROLE.test(x))) {
    const at = part.match(/(?:\s|^)(?:at|@)\s*([A-Z0-9][^,;()]{1,59})/);
    if (!at) continue;
    if (namesCompany(at[1], t)) here = true; else elsewhere ??= at[1].trim();
  }
  const comma = parts.slice(1).find((part) => part && !ROLE.test(part) && /^[A-Z0-9]/.test(part));
  if (comma) { if (namesCompany(comma, t)) here = true; else if (!elsewhere) elsewhere = comma.trim(); }
  const of = current.match(/\bof\s+(?:the\s+)?([^,;()]{2,60})/i);
  if (of && namesCompany(of[1], t)) here = true;
  const before = current.split(ROLE)[0].trim(); // "Northwind Co-founder"
  if (before && namesCompany(before, t)) here = true;
  if (here) elsewhere = null;
  return { current, former: false, here, elsewhere };
}

const TESTIMONIAL_CUE = /testimonial|review|case stud|success stor|client stor|customer stor|our clients|our customers|what (?:our )?(?:clients|customers)|clients? say|customers? say|trusted by|kind words|hear from/i;
const STAFF_CUE = /meet (?:the|our) team|our team|the team|leadership|our people|our founders?|management team|team members?|who we are/i;
const OUR_ROLE = /\bour (?:co-?founder|founder|ceo|owner|president|managing director|principal|managing partner)\s*,?\s*$/i;
const FOUNDED_BY = /\bfounded\b[^.\n]{0,40}\bby\s*$/i;
const TEAM_PAGE = /\/(?:team|our-team|leadership|people|about|about-us|who-we-are|founders?|staff|meet)(?:[/?#.-]|$)/i;

const LETTER = new RegExp("\\p{L}", "u");
const lastAt = (re: RegExp, s: string): number => { let at = -1; const g = new RegExp(re.source, "gi"); for (let m = g.exec(s); m; m = g.exec(s)) at = m.index; return at; };

/** Which reader block a position sits in: the staff block, the quoted block, another block, or the page's own text. */
function sectionAt(text: string, pos: number): "staff" | "quoted" | "other" | "body" {
  let best = -1, kind: "staff" | "quoted" | "other" | "body" = "body";
  const re = new RegExp(OTHER_BLOCK.source, "gm");
  for (let m = re.exec(text); m && m.index < pos; m = re.exec(text)) {
    if (m.index > best) { best = m.index; kind = m[0] === STAFF_BLOCK ? "staff" : m[0] === QUOTED_BLOCK ? "quoted" : "other"; }
  }
  return kind;
}

/** Every place the page names the person: the block it sits in, the role line after the name, and the text just before it. */
function occurrences(name: string, text: string): { section: ReturnType<typeof sectionAt>; after: string; before: string }[] {
  const out: { section: ReturnType<typeof sectionAt>; after: string; before: string }[] = [];
  const page = flat(text), lower = page.toLowerCase(), who = flat(name).toLowerCase().trim();
  if (who.length < 3) return out;
  for (let i = lower.indexOf(who); i >= 0 && out.length < 20; i = lower.indexOf(who, i + who.length)) {
    const end = i + who.length;
    if (LETTER.test(page[i - 1] ?? "") || LETTER.test(page[end] ?? "")) continue; // "Rhys Morganson" is not "Rhys Morgan"
    const section = sectionAt(page, i);
    const rest = page.slice(end, end + 160);
    // In a block, the role is the rest of the line; in running text, up to the end of the sentence.
    const after = section === "body" ? rest.split(/\n|(?<=[a-z0-9)])\.\s/i)[0] : rest.split("\n")[0];
    out.push({ section, after, before: page.slice(Math.max(0, i - 200), i) });
  }
  return out;
}

/**
 * The verdict for one person across the pages read. `title` is the model's; the pages are the reader's text (with its
 * blocks). Explicit evidence wins; anything that says they work elsewhere (or used to work here) refuses; a team listing
 * counts only when nothing on the pages ties them elsewhere; a client-quote appearance on its own refuses.
 */
export function employmentOf(person: { name: string; title: string }, pages: { url: string; text: string }[], t: Target): Employment {
  const own = roleAffiliation(person.title, t);
  if (own.former) return { verdict: "not_staff", why: "former_role" };
  if (own.elsewhere) return { verdict: "not_staff", why: "works_elsewhere" };
  let explicit = own.here, team = false, elsewhere = false, former = false, quoted = false;
  for (const p of pages) {
    let path = ""; try { path = new URL(p.url).pathname; } catch { /* not a URL */ }
    for (const o of occurrences(person.name, p.text)) {
      if (o.section === "other") continue;
      const r = roleAffiliation(o.after, t);
      if (r.former) former = true;
      if (r.elsewhere) elsewhere = true;
      if (r.here) explicit = true;
      if (o.section === "quoted") { if (!r.here) quoted = true; continue; }
      if (o.section === "body") {
        const near = o.before.slice(-60);
        if (OUR_ROLE.test(near) || FOUNDED_BY.test(near) || /^\s*,?\s*(?:co-?)?founded\b/i.test(o.after)) { explicit = true; continue; }
        const lastQuote = o.before.lastIndexOf('"');
        const quotedRightBefore = lastQuote >= 0 && o.before.length - lastQuote <= 6; // "…great work." - Dana Ortiz, CEO
        // The nearer heading-like cue decides: "What our clients say" vs "Meet the team".
        const cueQuote = lastAt(TESTIMONIAL_CUE, o.before), cueTeam = lastAt(STAFF_CUE, o.before);
        if (quotedRightBefore || cueQuote > cueTeam) { if (!r.here) quoted = true; continue; }
        if (r.elsewhere || r.former || !ROLE.test(r.current)) continue;
        if (cueTeam >= 0 || TEAM_PAGE.test(path)) team = true;
        continue;
      }
      // the reader's staff block (a team or about page's cards)
      if (!r.elsewhere && !r.former && ROLE.test(r.current)) team = true;
    }
  }
  if (explicit && !former && !elsewhere) return { verdict: "staff", why: "explicit" };
  if (explicit) return { verdict: "not_staff", why: "conflicting" };
  if (elsewhere) return { verdict: "not_staff", why: "works_elsewhere" };
  if (former) return { verdict: "not_staff", why: "former_role" };
  if (team) return { verdict: "staff", why: "team_listing" };
  if (quoted) return { verdict: "not_staff", why: "quoted_only" };
  return { verdict: "unknown", why: "no_evidence" };
}
