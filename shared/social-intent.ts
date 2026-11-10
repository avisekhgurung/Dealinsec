/**
 * Social Intent: people publicly saying they need the kind of work the person sells.
 *
 * Everything here is PURE and deterministic — rules over the post's own words, no model. That is a cost decision as
 * much as a correctness one: a scan reads hundreds of posts, and a model call per post would cost more than the plan
 * earns. So the cheap stages (is it an ask at all? is it about your services? how strong is it?) are rules, and a
 * model is only ever spent later, on the few opportunities a person chooses to research or draft for.
 *
 * Three rules this file exists to keep:
 *   - A post is evidence of what someone SAID, never of what a business needs. "Our site isn't converting" is a
 *     problem they stated; it is not a confirmed pain point of a company we have verified.
 *   - Missing is not negative. A post that names no budget has an UNKNOWN budget: it earns no budget points, and it
 *     is not treated as a post that said "no budget". Only a post that says "unpaid" scores zero there.
 *   - A freelancer advertising themselves is a competitor, not a client. "[For Hire]" is never an opportunity.
 */

/* ── intent ─────────────────────────────────────────────────────────────── */

/**
 *   hiring          wants to hire or pay someone: "looking to hire a developer", "[Hiring]", "need an agency"
 *   recommendation  asks others who to use: "can anyone recommend an SEO agency?"
 *   partnership     wants an ongoing supplier: white-label, outsourcing, a development partner
 *   problem         describes a problem the person's services solve, without asking to hire: "our site isn't converting"
 *   discussion      talk, advice, opinion — no buying intent; never stored as an opportunity
 *   offer           someone selling THEIR OWN services ("[For Hire]", "available for work"): a competitor; dropped
 */
export type IntentCategory = "hiring" | "recommendation" | "partnership" | "problem" | "discussion" | "offer";
export const INTENT_LABEL: Record<IntentCategory, string> = {
  hiring: "Wants to hire", recommendation: "Asking for a recommendation", partnership: "Looking for a partner",
  problem: "Describes a problem", discussion: "General discussion", offer: "Offering their own services",
};
/** Stored as opportunities. A general discussion and a self-advert are not buying opportunities and are dropped. */
export const QUALIFYING_INTENTS: readonly IntentCategory[] = ["hiring", "recommendation", "partnership", "problem"];

/** What people who do the work call themselves or the supplier they want. */
const ROLE = "(?:developer|dev|engineer|programmer|coder|designer|agency|freelancer|contractor|consultant|expert|specialist|writer|copywriter|marketer|editor|videographer|photographer|animator|illustrator|strategist|accountant|bookkeeper|virtual assistant|va|studio|team|firm|company|person|someone|somebody|anyone|help)";

/** Selling, not buying. Checked FIRST: a "[For Hire]" post that also says "looking for clients" must never qualify. */
const OFFER = new RegExp([
  String.raw`^\s*\[?\s*for hire\s*\]?`,
  String.raw`\[\s*for hire\s*\]`,
  String.raw`^\s*seeking\s+work\b`,
  String.raw`\b(?:i am|i'm|we are|we're)\s+(?:a|an)\s+[\w\s/&+-]{0,40}?\b(?:available|open|looking)\s+for\s+(?:hire|work|new\s+clients?|clients?|projects?|gigs?|opportunities|freelance)`,
  String.raw`\b(?:available|open)\s+for\s+(?:hire|work|freelance|new\s+(?:projects?|clients?))\b`,
  String.raw`\blooking\s+for\s+(?:new\s+)?(?:clients?|work|gigs?|a\s+job|employment|projects?\s+to\s+work\s+on)\b`,
  String.raw`\b(?:offering|i\s+offer|we\s+offer)\s+(?:my|our)?\s*[\w\s/&+-]{0,30}?services\b`,
  String.raw`\bhire\s+me\b`,
  String.raw`\bmy\s+(?:rates?|portfolio)\s+(?:is|are|start)`,
  String.raw`\bdm\s+me\s+(?:for|if\s+you\s+need)\b`,
].join("|"), "i");

const HIRING_STRONG = new RegExp([
  String.raw`\[\s*hiring\s*\]`,
  String.raw`\b(?:looking|want(?:ing)?|need(?:ing)?|trying)\s+to\s+hire\b`,
  String.raw`\b(?:we(?:'re| are)|i(?:'m| am))\s+hiring\b`,
  String.raw`\bseeking\s+freelancers?\b`,
  String.raw`\bseeking\s+(?:a|an)\s+[\w\s/&+.#-]{0,40}?${ROLE}\b`,
  String.raw`\b(?:request\s+for\s+(?:proposals?|quotes?|quotations?)|rfp|rfq)\b`,
  String.raw`\b(?:paid|paying)\s+(?:gig|project|work|job|task)\b`,
].join("|"), "i");

const HIRING = new RegExp([
  String.raw`\blooking\s+for\s+(?:a|an|some|someone|somebody|the\s+right|a\s+reliable|a\s+good|an?\s+experienced)\s+[\w\s/&+.#-]{0,50}?${ROLE}\b`,
  String.raw`\blooking\s+for\s+(?:someone|somebody|anyone|a\s+person)\s+(?:to|who|that)\b`,
  String.raw`\bneed(?:s|ed)?\s+(?:a|an|some|someone|somebody)\s+[\w\s/&+.#-]{0,50}?${ROLE}\b`,
  String.raw`\bneed(?:s|ed)?\s+(?:someone|somebody|help|a\s+hand)\s+(?:to|with|who|building|designing|setting)\b`,
  String.raw`\bsearching\s+for\s+(?:a|an)\s+[\w\s/&+.#-]{0,50}?${ROLE}\b`,
  String.raw`\bwho\s+can\s+(?:build|design|make|create|develop|fix|set\s+up|help\s+(?:me|us)\s+(?:build|with))\b`,
  String.raw`\bwant\s+(?:someone|somebody|a\s+${ROLE})\s+to\s+(?:build|design|make|create|develop|redesign|fix)\b`,
  String.raw`\bquotes?\s+for\s+(?:a|an|my|our)\b`,
  // Stating a budget is a buying signal, but the weakest wording here: it must never outrank an explicit
  // "can anyone recommend…" in the same post (found in the browser: a recommendation ask was badged as hiring).
  String.raw`\bbudget\s+(?:is|of|around|up\s+to)\b`,
].join("|"), "i");

const PARTNERSHIP = new RegExp([
  String.raw`\bwhite[- ]?label\b`,
  String.raw`\b(?:outsourc(?:e|ing)|offshore|nearshore)\s+(?:partners?|team|agency|provider)\b`,
  String.raw`\b(?:development|dev|design|marketing|technical|tech|agency|delivery|fulfil?lment)\s+partners?\b`,
  String.raw`\blooking\s+for\s+(?:a|an)?\s*(?:long[- ]term\s+)?partner(?:ship)?\b`,
  String.raw`\bsub-?contract(?:or|ing)?\b`,
  String.raw`\boverflow\s+work\b`,
].join("|"), "i");

const RECOMMENDATION = new RegExp([
  String.raw`\b(?:can|could)\s+(?:anyone|someone|anybody|you)\s+recommend\b`,
  String.raw`\b(?:any|looking\s+for|need|seeking)\s+(?:recommendations?|suggestions?|referrals?)\b`,
  String.raw`\brecommend(?:ations?)?\s+(?:for\s+)?(?:a|an|any|some)\s+(?:good\s+|reliable\s+|decent\s+)?[\w\s/&+.#-]{0,40}?${ROLE}\b`,
  String.raw`\bwho\s+(?:do|did|would)\s+you\s+(?:use|recommend|hire|go\s+with)\b`,
  String.raw`\b(?:know|knows)\s+(?:a|an|any|of\s+a|of\s+any)\s+(?:good|reliable|great|decent)\s+[\w\s/&+.#-]{0,40}?${ROLE}\b`,
  String.raw`\bwhere\s+(?:can|do)\s+i\s+find\s+(?:a|an)\s+(?:good\s+|reliable\s+)?[\w\s/&+.#-]{0,40}?${ROLE}\b`,
  String.raw`\bbest\s+[\w\s/&+.#-]{0,30}?(?:agency|freelancer|developer|designer)\s+(?:for|to)\b`,
].join("|"), "i");

const PROBLEM = new RegExp([
  String.raw`\b(?:our|my)\s+(?:current\s+|existing\s+|new\s+|old\s+)?(?:website|site|app|store|shop|landing\s+page|funnel|ads?|campaigns?|emails?|checkout|seo|crm)\s+(?:is\s+not|isn't|isnt|are\s+not|aren't|doesn't|does\s+not|won't|keeps?|has\s+stopped|stopped)\b`,
  String.raw`\b(?:struggling|struggle)\s+(?:to|with)\b`,
  String.raw`\bcan(?:'t|not)\s+(?:figure\s+out|get|seem\s+to)\b`,
  String.raw`\btaking\s+(?:too|way\s+too|so)\s+(?:much|long)\b`,
  String.raw`\bneed\s+to\s+automate\b`,
  String.raw`\b(?:manual|manually)\s+(?:process(?:es)?|work|data\s+entry|doing)\b`,
  String.raw`\b(?:low|poor|bad|terrible|dropping|falling)\s+(?:conversion|conversions|traffic|rankings?|sales|leads|open\s+rates?)\b`,
  String.raw`\bnot\s+(?:getting|generating)\s+(?:any|enough)\s+(?:leads|sales|traffic|clients|customers)\b`,
  String.raw`\bhow\s+do\s+(?:i|we)\s+(?:fix|improve|increase|speed\s+up|get\s+more)\b`,
].join("|"), "i");

export interface IntentVerdict {
  category: IntentCategory;
  /** The exact words that decided it, quoted back to the person. Null for a plain discussion. */
  matched: string | null;
  confidence: "high" | "medium" | "low";
}

const hit = (re: RegExp, text: string): string | null => {
  const m = text.match(re);
  return m ? m[0].replace(/\s+/g, " ").trim().slice(0, 120) : null;
};

/**
 * What kind of post this is, from its own words. Order matters and is deliberate: a self-advert is ruled out before
 * anything can qualify; partnership wording is more specific than hiring wording ("looking for a white-label agency"
 * is a partnership ask, not a one-off hire); a stated problem only counts when nothing stronger was said.
 */
export function classifyIntent(text: string | null | undefined): IntentVerdict {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return { category: "discussion", matched: null, confidence: "low" };
  const offer = hit(OFFER, t);
  // "[Hiring]" in the same post wins over offer wording further down: the tag is the poster's own classification.
  const tagged = /\[\s*hiring\s*\]/i.test(t);
  if (offer && !tagged) return { category: "offer", matched: offer, confidence: "high" };
  const partner = hit(PARTNERSHIP, t);
  if (partner) return { category: "partnership", matched: partner, confidence: "high" };
  const strong = hit(HIRING_STRONG, t);
  if (strong) return { category: "hiring", matched: strong, confidence: "high" };
  // An explicit request to be recommended someone is said in so many words; the looser hiring wording below is not.
  const rec = hit(RECOMMENDATION, t);
  if (rec) return { category: "recommendation", matched: rec, confidence: "high" };
  const hiring = hit(HIRING, t);
  if (hiring) return { category: "hiring", matched: hiring, confidence: "medium" };
  const problem = hit(PROBLEM, t);
  if (problem) return { category: "problem", matched: problem, confidence: "low" };
  return { category: "discussion", matched: null, confidence: "low" };
}

/* ── what the post says about the project ───────────────────────────────── */

const MONEY = /(?:(?:\$|₹|€|£)\s?\d[\d,.]*\s?(?:k|m|lakhs?|lacs?|cr|crores?)?|\b\d[\d,.]*\s?(?:k\s)?(?:usd|inr|eur|gbp|dollars|rupees|euros|pounds)\b|\brs\.?\s?\d[\d,.]*\s?(?:k|lakhs?|lacs?)?)(?:\s?(?:-|–|to)\s?(?:\$|₹|€|£)?\s?\d[\d,.]*\s?(?:k|m|lakhs?)?)?(?:\s?(?:\/|per\s|an?\s)\s?(?:hr|hour|day|week|month|mo|project|article|post|page|video))?/i;
const BUDGET_WORD = /\b(?:budget|paid|paying|pay\s+(?:well|rate)|rate|compensation|retainer|fixed\s+price|hourly)\b/i;
const UNPAID = /\b(?:unpaid|for\s+free|no\s+budget|zero\s+budget|equity\s+only|rev(?:enue)?[- ]share\s+only|volunteer|for\s+exposure|can(?:'t|not)\s+pay|no\s+pay)\b/i;
const URGENT = /\b(?:asap|a\.s\.a\.p|urgent(?:ly)?|immediately|right\s+away|as\s+soon\s+as\s+possible|this\s+week|today|tomorrow|by\s+(?:next|the\s+end\s+of(?:\s+the)?|end\s+of)\s+(?:week|month)|within\s+\d+\s+(?:days?|weeks?|hours?)|in\s+\d+\s+(?:days?|weeks?)|deadline|time[- ]sensitive|quick\s+turnaround)\b/i;
const DELIVERABLE = /\b(?:web\s?site|web\s?app|mobile\s+app|android\s+app|ios\s+app|app|mvp|prototype|landing\s+page|logo|brand(?:ing)?|e-?commerce|online\s+store|shopify|wordpress|webflow|dashboard|saas|plugin|extension|integration|automation|workflow|chatbot|bot|crm|api|backend|frontend|redesign|migration|seo|ppc|ads?|ad\s+campaign|campaign|newsletter|email\s+sequence|content|blog\s+posts?|copy|video|reel|animation|pitch\s+deck|bookkeeping|data\s+pipeline|scraper)\b/i;
const SPECIFICS = /\b(?:react|next\.?js|vue|angular|node|python|django|rails|laravel|php|flutter|swift|kotlin|figma|stripe|supabase|firebase|aws|zapier|make\.com|n8n|hubspot|salesforce|klaviyo|ga4|\d+\s+(?:pages?|screens?|posts?|articles?|videos?|users?|products?|skus?))\b/i;
const BUSINESS = /\b(?:my|our)\s+(?:company|startup|business|agency|store|shop|firm|clinic|practice|saas|team|clients?|brand|restaurant|studio|nonprofit|non-profit)\b|\bwe(?:'re|\s+are)\s+(?:a|an)\b|\bi\s+(?:run|own|founded|started)\b|\bco-?founder\b|\bfounder\b|\bsmall\s+business\s+owner\b/i;

export interface PostSignals {
  /** The money wording as written ("$2,000", "₹50k/month"), or null when no amount is given. */
  budget: string | null;
  /** They talk about paying, without a figure. */
  budgetMentioned: boolean;
  /** They say there is no money. A known negative, unlike silence. */
  unpaid: boolean;
  /** The timing wording as written ("ASAP", "within 2 weeks"), or null. */
  urgency: string | null;
  /** They speak as or for a business ("our startup", "I run a clinic"). */
  businessContext: string | null;
}

export function extractSignals(text: string | null | undefined): PostSignals {
  const t = String(text ?? "");
  const unpaid = UNPAID.test(t);
  return {
    budget: unpaid ? null : hit(MONEY, t),
    budgetMentioned: !unpaid && BUDGET_WORD.test(t),
    unpaid,
    urgency: hit(URGENT, t),
    businessContext: hit(BUSINESS, t),
  };
}

/* ── is the post about what the person sells? ───────────────────────────── */

/** Words of a text, lower-cased; "next.js", "c++" and "c#" stay whole, sentence punctuation goes. */
const tokens = (s: string): string[] => String(s ?? "").toLowerCase().split(/[^a-z0-9+#.]+/).map((w) => w.replace(/^\.+|\.+$/g, "")).filter(Boolean);
/**
 * A word's rough stem, so "development", "developer" and "developers" are one word, and "design" matches
 * "designer". Deliberately small: a handful of endings, never below four letters, so short words ("web", "seo",
 * "ads") are only ever matched whole.
 */
function stem(w: string): string {
  let x = w;
  for (let pass = 0; pass < 2; pass++) {
    const m = x.match(/^(.{4,}?)(?:ments?|ings?|ers?|ors?|ies|es|s)$/);
    if (!m) break;
    x = m[1];
  }
  return x;
}
const FILLER = new Set(["and", "for", "the", "with", "of", "to", "in", "a", "an", "&", "services", "service"]);

/**
 * Whether a text is about a phrase ("web development"): EVERY meaningful word of the phrase appears in it as a
 * whole word, allowing for endings ("web developer" counts; "developers" alone does not, and neither does
 * "business development"). Found live on the first real scan: the looser shared rule (any one common word) called an
 * iOS contract "web development" because both said "develop…". An ask that isn't about the person's work is noise,
 * and noise in this list costs them trust in the whole list.
 */
export function mentionsPhrase(phrase: string, text: string): boolean {
  const want = tokens(phrase).filter((w) => !FILLER.has(w)).map(stem);
  if (!want.length) return false;
  const have = new Set(tokens(text).map(stem));
  const builds = BUILDER.some((w) => have.has(w));
  return want.every((w) => have.has(w) || (builds && BUILDER.includes(w)));
}
/**
 * Stems of the words people use interchangeably for someone who writes software. "React development" is what a
 * freelancer calls their service; "React engineer" is what the person hiring writes. Found live: a 4–5 month React
 * contract was dropped because its post never used the word "development". Only this one family is treated as
 * equivalent, and only when the phrase's other words ("React", "web") are really there.
 */
const BUILDER = ["develop", "engine", "dev", "devs", "programm", "coder", "coding"];

/**
 * The part of a post that says what is being asked for: its first line (the title) and the words right after the
 * phrase that made it an ask. A service named THERE is what they want; a service named only further down may just be
 * something the post mentions ("we give developers and designers the tools…" is not an ask for a designer).
 */
export function askFocus(text: string, matched: string | null): string {
  const t = String(text ?? "");
  const first = (t.split("\n").find((l) => l.trim()) ?? "").slice(0, 200);
  if (!matched) return first;
  const at = t.toLowerCase().indexOf(matched.toLowerCase());
  return at < 0 ? first : `${first}\n${t.slice(at, at + matched.length + 160)}`;
}

export interface ServiceMatch {
  service: string | null; via: "service" | "keyword" | null;
  /** True when it is named in the ask itself (askFocus), false when only elsewhere in the post. */
  focused: boolean;
}
/**
 * Which of the person's services the post is about. A service named in the ask itself wins over one that is only
 * mentioned further down; services win over keywords. Null when the post mentions none of them.
 */
export function requestedService(text: string, services: string[], keywords: string[] = [], focus?: string): ServiceMatch {
  const sv = services.map((x) => x.trim()).filter(Boolean), kw = keywords.map((x) => x.trim()).filter((x) => x.length >= 2);
  const f = focus ?? text;
  const inFocus = sv.find((x) => mentionsPhrase(x, f));
  if (inFocus) return { service: inFocus, via: "service", focused: true };
  const kFocus = kw.find((x) => mentionsPhrase(x, f));
  if (kFocus) return { service: kFocus, via: "keyword", focused: true };
  const anywhere = sv.find((x) => mentionsPhrase(x, text));
  if (anywhere) return { service: anywhere, via: "service", focused: false };
  const kAny = kw.find((x) => mentionsPhrase(x, text));
  return kAny ? { service: kAny, via: "keyword", focused: false } : { service: null, via: null, focused: false };
}

/* ── the score ──────────────────────────────────────────────────────────── */

export type SocialComponentKey = "intent" | "requirements" | "recency" | "budget" | "relevance" | "business";
export interface SocialComponent {
  key: SocialComponentKey; label: string; max: number;
  /** Null = unknown: the post doesn't say. Never read as zero. */
  points: number | null;
  reason: string;
}
export interface SocialScore {
  /** Points earned out of 100. Unknown components add nothing, and are listed apart so nobody mistakes them for a no. */
  total: number;
  /** The most this post could have scored on what it actually states (100 minus the unknown components' weight). */
  knownMax: number;
  components: SocialComponent[];
  /** How much of the score rests on stated facts rather than on silence. */
  confidence: "high" | "medium" | "low";
}

export const SOCIAL_WEIGHTS: Record<SocialComponentKey, number> = { intent: 25, requirements: 20, recency: 15, budget: 15, relevance: 15, business: 10 };
const DAY = 86_400_000;

export interface ScoreInput {
  text: string;
  intent: IntentVerdict;
  postedAt: Date | string | null;
  services: string[];
  keywords?: string[];
  /** A company site the post itself links, if any. */
  companyUrl?: string | null;
  now: Date;
}

/**
 * A transparent 0–100, every point explained. It ranks what to look at first; it is not a forecast of who will buy,
 * and the page says so.
 */
export function socialScore(i: ScoreInput): SocialScore {
  const t = String(i.text ?? "");
  const sig = extractSignals(t);
  const c: SocialComponent[] = [];
  const W = SOCIAL_WEIGHTS;

  const intentPts: Record<IntentCategory, number> = { hiring: 25, recommendation: 20, partnership: 16, problem: 10, discussion: 0, offer: 0 };
  const base = intentPts[i.intent.category];
  // Wording that only loosely reads as an ask is worth less than an explicit one.
  const intentScore = i.intent.category === "hiring" && i.intent.confidence !== "high" ? 20 : base;
  c.push({ key: "intent", label: "Explicit buying intent", max: W.intent, points: intentScore,
    reason: i.intent.matched ? `${INTENT_LABEL[i.intent.category]}: “${i.intent.matched}”` : "No wording that asks to hire, be recommended someone or solve a problem" });

  const words = t.split(/\s+/).filter(Boolean).length;
  const deliverable = hit(DELIVERABLE, t), specifics = hit(SPECIFICS, t);
  const req = (deliverable ? 8 : 0) + (words >= 40 ? 6 : words >= 15 ? 3 : 0) + (specifics || sig.urgency ? 6 : 0);
  c.push({ key: "requirements", label: "Clear project requirements", max: W.requirements, points: Math.min(W.requirements, req),
    reason: [deliverable ? `names what they want (“${deliverable}”)` : "doesn't name a deliverable", words >= 40 ? "describes it in some detail" : words >= 15 ? "a short description" : "barely described", specifics ? `gives specifics (“${specifics}”)` : sig.urgency ? `gives a timeline (“${sig.urgency}”)` : "no specifics"].join(" · ") });

  const at = i.postedAt ? new Date(i.postedAt) : null;
  const age = at && Number.isFinite(at.getTime()) ? Math.max(0, Math.floor((i.now.getTime() - at.getTime()) / DAY)) : null;
  c.push({ key: "recency", label: "Recency", max: W.recency,
    points: age === null ? null : age <= 3 ? 15 : age <= 7 ? 12 : age <= 14 ? 9 : age <= 30 ? 6 : age <= 90 ? 2 : 0,
    reason: age === null ? "The source gives no date for this post" : age === 0 ? "Posted today" : `Posted ${age} day${age === 1 ? "" : "s"} ago` });

  c.push({ key: "budget", label: "Budget or readiness to pay", max: W.budget,
    points: sig.unpaid ? 0 : sig.budget ? 15 : sig.budgetMentioned ? 8 : null,
    reason: sig.unpaid ? "Says there is no money for it" : sig.budget ? `Names an amount (“${sig.budget}”)` : sig.budgetMentioned ? "Talks about paying, without a figure" : "Doesn't mention a budget" });

  const svc = requestedService(t, i.services, i.keywords ?? [], askFocus(t, i.intent.matched));
  c.push({ key: "relevance", label: "Relevance to your services", max: W.relevance,
    points: svc.via === "service" ? (svc.focused ? 15 : 9) : svc.via === "keyword" ? (svc.focused ? 10 : 6) : 0,
    reason: svc.via === null ? "Doesn't mention your services or keywords"
      : svc.focused ? (svc.via === "service" ? `Asks about “${svc.service}”, which you offer` : `The ask matches your keyword “${svc.service}”`)
      : `Mentions “${svc.service}”, though not clearly as what they're asking for` });

  c.push({ key: "business", label: "Identifiable business context", max: W.business,
    points: i.companyUrl ? 10 : sig.businessContext ? 6 : null,
    reason: i.companyUrl ? "Links a company website" : sig.businessContext ? `Speaks for a business (“${sig.businessContext}”)` : "Doesn't say who they are" });

  const total = c.reduce((n, x) => n + (x.points ?? 0), 0);
  const knownMax = c.reduce((n, x) => n + (x.points === null ? 0 : x.max), 0);
  return { total, knownMax, components: c, confidence: knownMax >= 85 ? "high" : knownMax >= 60 ? "medium" : "low" };
}

/* ── one post, analysed ─────────────────────────────────────────────────── */

export interface SocialAnalysis {
  intent: IntentVerdict;
  signals: PostSignals;
  service: string | null;
  score: SocialScore;
  /** Stored and shown as an opportunity: a qualifying intent AND about the person's services. */
  qualifies: boolean;
}

export function analysePost(i: Omit<ScoreInput, "intent">): SocialAnalysis {
  const intent = classifyIntent(i.text);
  const svc = requestedService(i.text, i.services, i.keywords ?? [], askFocus(i.text, intent.matched));
  return {
    intent, signals: extractSignals(i.text), service: svc.service,
    score: socialScore({ ...i, intent }),
    qualifies: QUALIFYING_INTENTS.includes(intent.category) && svc.via !== null,
  };
}

/* ── platforms: what can honestly be searched, and what can't ───────────── */

export type SocialPlatformId = "hn" | "reddit" | "web" | "linkedin" | "facebook" | "instagram" | "x";
/**
 *   search    DealInSec can search it through an official or licensed route
 *   manual    it cannot be searched, by anyone, through an authorised route: the person pastes a post's link and text
 */
export interface SocialPlatform {
  id: SocialPlatformId; label: string; mode: "search" | "manual";
  /** How it is reached, in one line a person can check. */
  access: string;
  /** What it cannot do, said plainly. */
  limitation: string;
  /** Environment needed before it works; empty for sources that need nothing. */
  needs: string[];
  /** Whether a scan through it costs search credits. */
  paid: boolean;
}

export const SOCIAL_PLATFORMS: readonly SocialPlatform[] = [
  { id: "hn", label: "Hacker News", mode: "search", paid: false, needs: [],
    access: "The official public Algolia HN API: the monthly “Seeking freelancer” and “Who is hiring” threads.",
    limitation: "Two threads a month, mostly software and startup work." },
  { id: "reddit", label: "Reddit", mode: "search", paid: false, needs: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"],
    access: "Reddit’s official Data API over OAuth.",
    limitation: "Reddit approves each app by hand and requires a separate written agreement for commercial use. Until yours is approved and the keys are set, this source is off — and DealInSec does not read Reddit any other way." },
  { id: "web", label: "Public web discussions", mode: "search", paid: true, needs: ["TAVILY_API_KEY"],
    access: "A web search (Tavily) limited to public forums and communities; only the result’s title, excerpt and link are kept.",
    limitation: "Only what a search engine has indexed, usually without a post date. Uses your web-search credits." },
  { id: "linkedin", label: "LinkedIn", mode: "manual", paid: false, needs: [],
    access: "Paste a post’s link and its text.",
    limitation: "LinkedIn offers no API for searching public posts or groups, and scraping it breaks its terms. It cannot be searched automatically." },
  { id: "facebook", label: "Facebook", mode: "manual", paid: false, needs: [],
    access: "Paste a post’s link and its text.",
    limitation: "Meta retired the Groups API; there is no authorised way to search group or public posts." },
  { id: "instagram", label: "Instagram", mode: "manual", paid: false, needs: [],
    access: "Paste a post’s link and its text.",
    limitation: "The Graph API covers accounts you manage; it cannot search other people’s public posts or comments." },
  { id: "x", label: "X (Twitter)", mode: "manual", paid: false, needs: [],
    access: "Paste a post’s link and its text.",
    limitation: "Post search is a paid enterprise API that isn’t connected here." },
];
export const SEARCHABLE_PLATFORMS = SOCIAL_PLATFORMS.filter((p) => p.mode === "search").map((p) => p.id);
export const isSocialPlatform = (v: unknown): v is SocialPlatformId => SOCIAL_PLATFORMS.some((p) => p.id === v);

/** Which platform a pasted link belongs to; anything unrecognised is the open web. */
export function platformOfUrl(url: string): SocialPlatformId {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return "web"; }
  if (/(^|\.)linkedin\.com$/.test(host) || host === "lnkd.in") return "linkedin";
  if (/(^|\.)(facebook|fb)\.com$/.test(host) || host === "fb.me") return "facebook";
  if (/(^|\.)instagram\.com$/.test(host)) return "instagram";
  if (/(^|\.)(x|twitter)\.com$/.test(host) || host === "t.co") return "x";
  if (/(^|\.)reddit\.com$/.test(host) || host === "redd.it") return "reddit";
  if (host === "news.ycombinator.com") return "hn";
  return "web";
}

/* ── a post's link ──────────────────────────────────────────────────────── */

const TRACKING_PARAM = /^(?:utm_[a-z_]+|fbclid|gclid|msclkid|mc_[ce]id|igsh|igshid|share_id|rcm|trk|trackingid|refid|ref_src|ref_url|context|s|t|si|mibextid|__tn__|__cft__\[\d+\])$/i;
/** One host per platform, so the same post shared from the app, the old site or the mobile site is one opportunity. */
const HOST_ALIAS: [RegExp, string][] = [
  [/^(?:(?:www|old|new|np|m|i|amp)\.)?reddit\.com$/, "www.reddit.com"],
  [/^(?:(?:www|m|[a-z]{2})\.)?linkedin\.com$/, "www.linkedin.com"],
  [/^(?:(?:www|m|mbasic|web|touch)\.)?facebook\.com$/, "www.facebook.com"],
  [/^(?:www\.)?instagram\.com$/, "www.instagram.com"],
  [/^(?:(?:www|mobile|m)\.)?(?:twitter|x)\.com$/, "x.com"],
];

/**
 * A post's link as it is stored: still a link that opens (the host is kept, not stripped to a bare domain — some
 * sites only answer on "www"), minus what only tracks the click (utm_…, fbclid, share ids), minus the fragment and
 * a trailing slash. It doubles as the post's identity: one row per workspace and link. Null for anything that isn't
 * a plain http(s) address.
 */
export function postUrl(raw: string | null | undefined): string | null {
  let u: URL;
  try { u = new URL(String(raw ?? "").trim()); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  let host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".")) return null;
  const alias = HOST_ALIAS.find(([re]) => re.test(host));
  if (alias) host = alias[1];
  const params = new URLSearchParams();
  for (const k of Array.from(new Set(Array.from(u.searchParams.keys()))).filter((k) => !TRACKING_PARAM.test(k)).sort()) params.set(k, u.searchParams.get(k) ?? "");
  const path = u.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
  const q = params.toString();
  const out = `https://${host}${path === "/" && !q ? "" : path}${q ? `?${q}` : ""}`;
  return out.length <= 500 ? out : null;
}

/* ── queries ────────────────────────────────────────────────────────────── */

const clean = (s: string) => s.replace(/["()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

/** The most searches one scan makes per source: a scan is a look, not a crawl. */
export const MAX_QUERIES_PER_SOURCE = 3;

/** Reddit search strings: an ask phrase AND one of the person's services. Reddit's search understands OR and quotes. */
export function redditQueries(services: string[], keywords: string[] = []): string[] {
  const terms = [...services, ...keywords].map(clean).filter((s) => s.length >= 3);
  return Array.from(new Set(terms)).slice(0, MAX_QUERIES_PER_SOURCE)
    .map((s) => `("looking for" OR "need a" OR "hiring" OR "recommend") "${s}"`);
}

/** Public communities where people ask who to hire. Passed to the search provider as the only domains to search. */
export const DISCUSSION_DOMAINS: readonly string[] = [
  "reddit.com", "indiehackers.com", "news.ycombinator.com", "quora.com", "community.shopify.com", "wordpress.org",
  "forum.webflow.com", "community.hubspot.com", "forum.bubble.io", "producthunt.com",
];

/** Web-search strings for public discussions: the person's service next to the words people use when they ask. */
export function discussionQueries(services: string[], keywords: string[] = [], max = 2): string[] {
  const terms = [...services, ...keywords].map(clean).filter((s) => s.length >= 3);
  return Array.from(new Set(terms)).slice(0, max).map((s) => `"looking for" OR "need" OR "recommend" ${s} freelancer OR agency`);
}

/* ── what is kept of a post ─────────────────────────────────────────────── */

export const EXCERPT_CHARS = 280;
export const TITLE_CHARS = 160;
/** A short quote of the post, never the whole of it: the link is the record, the excerpt is a reminder. */
export const excerptOf = (text: string) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, EXCERPT_CHARS);
/** How long an opportunity nobody acted on is kept. Saved and contacted ones are the person's own records and stay. */
export const RETENTION_DAYS = 60;
