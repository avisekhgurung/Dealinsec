/**
 * What a model-written outreach message must not contain. Pure: the same rules run on the server before a
 * draft is saved and are tested without a model.
 *
 * This is a safety net for the things a program CAN check, not a promise the message is good. It cannot tell
 * whether a sentence is true: that is why a person reads and approves every message, and why the draft is
 * written only from verified facts. What it does catch, because they are the costly mistakes:
 *   - an invented PRICE, discount or guarantee (the sender never agreed one),
 *   - links or email addresses the model made up (or copied off a page),
 *   - unfilled placeholders ("[Name]"), markup, and a wrong length,
 *   - pretending a conversation already happened ("as we discussed"),
 *   - text that reads like an instruction to an AI, echoed from a web page.
 * A PERSON editing a draft is held only to the structural rules (length, placeholders, markup): their own
 * message may quote their own price.
 */
import { injectionLike } from "./research";

export type IssueCode =
  | "subject_length" | "body_length" | "placeholder" | "html" | "price" | "discount_or_guarantee"
  | "link" | "email_address" | "false_history" | "instruction_like" | "unrequested_offer" | "describes_sender" | "unsupported_sender_claim";
export interface Issue { code: IssueCode; message: string }
export interface Draft { subject: string; body: string }
export interface DraftContext {
  /** The one address the message is going to; it is the only address allowed in the text. */
  to: string;
  /** The lead's own site: its address may appear in the text. */
  siteHost: string;
}

export const LIMITS = { subjectMin: 3, subjectMax: 120, bodyMin: 40, bodyMax: 1500 } as const;
/**
 * Only this much text is scanned by the pattern rules. Anything longer is already refused for its length, and bounding the
 * scan keeps every pattern linear in practice: a pattern that backtracks on a pathological string (100,000 letters, no dots)
 * must not be able to hang the server.
 */
const SCAN = { subject: LIMITS.subjectMax + 100, body: LIMITS.bodyMax + 300 } as const;

const PLACEHOLDER = /\[[^\]\n]{1,40}\]|\{\{[^}\n]*\}\}|\{[A-Za-z_ ]{2,30}\}|<[A-Z][A-Za-z ]{1,30}>|\b(?:INSERT|TODO|LOREM|XXX|FIRSTNAME|YOUR NAME)\b/;
const HTML = /<\/?[a-z][^>\n]*>/i;
const CURRENCY_SYMBOL = /[$€£₹¥]\s?\d/;
const CURRENCY_WORD = /\b\d[\d,.]*\s?(?:k|m|thousand|million|lakh|crore)?\s?(?:usd|eur|gbp|inr|rs\.?|rupees?|dollars?|euros?|pounds?|bucks)\b/i;
const PERCENT = /\b\d+(?:\.\d+)?\s?%/;
const RATE = /\b\d[\d,.]*\s?(?:per|\/|a)\s?(?:hour|hr|day|week|month|year|project|page|word)\b/i;
const THOUSANDS = /\b\d{1,3}(?:,\d{3})+\b/;
const DISCOUNT = /\b(?:discount|% off|free of charge|guarantee[ds]?|money[- ]back|limited[- ]time|act now|risk[- ]free|special offer)\b/i;
const URL_RE = /\bhttps?:\/\/[^\s)>\]]+|\bwww\.[^\s)>\]]+/gi;
/** A word shaped like a web address by itself (example.com, blog.example.xyz): letters-and-digits labels, then a letters-only ending of 2 to 24 letters. Tested on one word at a time, anchored. */
const BARE_DOMAIN_WORD = /^(?:[a-z0-9][a-z0-9-]{0,62}\.)+[a-z]{2,24}$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const FALSE_HISTORY = /\b(?:as (?:we )?discussed|following (?:up on )?our (?:call|conversation|chat|meeting|talk)|thanks for (?:your|getting back)|great (?:speaking|talking|chatting) with you|as promised|per our (?:call|conversation|chat)|nice (?:meeting|speaking to) you|good to (?:meet|speak with) you)\b/i;

const hostOf = (s: string): string => { try { return new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
const onSite = (host: string, site: string) => !!site && (host === site || host.endsWith(`.${site}`));

/** The rules that apply to everything, written by a model or a person. */
export function checkStructure(d: Draft): Issue[] {
  const out: Issue[] = [];
  const subject = d.subject.trim(), body = d.body.trim();
  const scanSubject = subject.slice(0, SCAN.subject), scanBody = body.slice(0, SCAN.body);
  if (subject.length < LIMITS.subjectMin || subject.length > LIMITS.subjectMax || /[\r\n]/.test(d.subject)) out.push({ code: "subject_length", message: `The subject must be ${LIMITS.subjectMin} to ${LIMITS.subjectMax} characters on one line.` });
  if (body.length < LIMITS.bodyMin || body.length > LIMITS.bodyMax) out.push({ code: "body_length", message: `The message must be ${LIMITS.bodyMin} to ${LIMITS.bodyMax} characters.` });
  if (PLACEHOLDER.test(scanSubject) || PLACEHOLDER.test(scanBody)) out.push({ code: "placeholder", message: "It still has a placeholder such as [Name] or {{name}}. Fill it in or remove it." });
  if (HTML.test(scanSubject) || HTML.test(scanBody)) out.push({ code: "html", message: "It contains markup. Use plain text." });
  return out;
}

/** The extra rules for a MODEL-written draft. */
/**
 * An offer to MAKE something for the company ("I could put together…", "happy to prepare a mock-up"). It commits the
 * sender's time, so a draft may carry one only when the sender chose to offer a sample (draft-v3 and later `sample`).
 */
const OFFER_TO_MAKE = /\b(?:I|we)(?:\s+(?:could|can|would|will|might)|['’](?:d|ll))\s+(?:(?:also|gladly|quickly|happily|be\s+(?:happy|glad|keen)\s+to)\s+)*(?:put\s+together|prepare|create|build|make|draft|design|mock\s+up|sketch|send\s+(?:over|you))\b|\b(?:happy|glad|keen)\s+to\s+(?:put\s+together|prepare|create|build|make|draft|design|mock\s+up|sketch)\b|\bmock-?ups?\b|\bprototypes?\b/i;
export const offersToMake = (text: string): boolean => OFFER_TO_MAKE.test(text.slice(0, SCAN.subject + SCAN.body));
/*
 * What a draft says about the SENDER. "What the sender offers" (their ideal-client profile: `about` and `services`) is
 * the only source for it: with no offer described, a draft says nothing about who the sender is or what they do; with
 * one, it may describe them only in terms of that offer, with no other service, experience, credential, count or result.
 *
 * Deterministic and deliberately narrow: a sender CLAUSE is a first-person (or "our team/agency/studio…") subject followed
 * by a verb from a fixed list of service verbs, a professional identity ("I'm a web designer", "As a copywriter…"), or a
 * claim about the sender's clients or record. Ordinary conversation ("I saw…", "I wondered…", "Could I help?", "I'm a big
 * fan…", "I'm writing to…") has no service verb or role noun and passes. A clause is then compared with the offer by
 * service group (web, apps, dashboards, automation…) and, when it names no known service, by shared words.
 */
const ROLE = String.raw`(?:designers?|developers?|devs?|engineers?|programmers?|coders?|writers?|copywriters?|editors?|marketers?|consultants?|freelancers?|agency|agencies|studios?|firms?|company|companies|startups?|consultancy|consultancies|strategists?|specialists?|experts?|accountants?|bookkeepers?|photographers?|videographers?|illustrators?|animators?|coaches|coach|trainers?|founders?|co-?founders?|owners?|partners?|architects?|analysts?|recruiters?|lawyers?|advis[eo]rs?|planners?|producers?|creators?|makers?|builders?|providers?|vendors?|contractors?|professionals?|technicians?|team|crew|shop|practice|business)`;
/** Service verbs, each in its base and third-person forms. Conversational verbs (see, notice, wonder, read, hope…) are not here. */
const VERBS = String.raw`(?:build|builds|develop|develops|create|creates|design|designs|make(?!\s+sure)|makes(?!\s+sure)|help|helps|offer(?!\s+(?:my|our)\s+(?:congratulations|thanks|best))|offers|provide|provides|speciali[sz]e|speciali[sz]es|work\s+with|works\s+with|run(?!\s+(?:into|across))|runs(?!\s+(?:into|across))|deliver|delivers|handle|handles|manage(?!\s+to)|manages(?!\s+to)|write(?!\s+(?:to|because|after|since|as)\b)|writes(?!\s+to\b)|edit|edits|produce|produces|support|supports|set\s+up|sets\s+up|focus\s+on|focuses\s+on|automate|automates|install|installs|fix|fixes|code|codes|shoot|shoots|teach|teaches|train|trains|consult|consults|(?:do|does)(?=\s+[a-z])(?!\s+(?:not|you|it|this|that|so|too|the\s+same|think|hope|wonder|know|like|love|enjoy|have|want|apologi\w*|mean|agree|believe|understand|feel|see|appreciate|remember|reali[sz]e|wish|recall|care|need|get|find)\b))`;
const PERFECT = String.raw`(?:built|developed|created|designed|helped|made|worked\s+with|delivered|launched|run|managed|written|edited|produced|supported|set\s+up|automated|shipped|grown|scaled|served)`;
const PROGRESSIVE = String.raw`(?:building|developing|creating|designing|helping|working\s+with|running|making|writing(?!\s+to\b)|editing|producing|delivering|automating|supporting)`;
/** Up to three words describing a role ("freelance web", "small family-run"), never crossing into another phrase ("a fan OF your team"). */
const MODIFIERS = String.raw`(?:(?!(?:of|for|at|in|on|with|to|from|about|your|their|his|her|its|the|a|an|and|or|who|that)\b)[\w-]+\s+){0,3}?`;
const ADVERB = String.raw`(?:(?:also|mainly|mostly|usually|often|primarily|specifically|currently|now|just|really|already|recently|personally|happily)\s+)?`;
/** Not a statement about the sender: a question, a condition or a modal ("Could I help?", "if we build…"). */
const NOT_A_STATEMENT = String.raw`(?<!\b(?:can|could|may|might|should|would|will|shall|do|does|did|if|whether|unless)\s+)`;
const SUBJECT = String.raw`(?:\b(?:I|we)|\b(?:my|our)\s+(?:(?:small|little|whole|own)\s+)?(?:team|agency|studio|company|firm|business|practice|consultancy|shop|crew))`;
const SENDER_CLAUSE = new RegExp([
  String.raw`${NOT_A_STATEMENT}${SUBJECT}\s+${ADVERB}${VERBS}\b`,
  String.raw`${NOT_A_STATEMENT}\b(?:I|we)(?:'ve|\s+have)\s+${ADVERB}(?:(?:been\s+${PROGRESSIVE})|${PERFECT})\b`,
  String.raw`\b(?:I|we)(?:'m|'re|\s+am|\s+are)\s+${ADVERB}${PROGRESSIVE}\b`,
  String.raw`\b(?:I|we)(?:'m|'re|\s+am|\s+are)\s+(?:a|an|the|your)\s+${MODIFIERS}${ROLE}\b`,
  String.raw`(?:^|[.!?\n]\s*)as\s+(?:a|an)\s+${MODIFIERS}${ROLE}\b`,
  String.raw`\b(?:my|our)\s+(?:clients|customers|portfolio|track\s+record|background|services|work\s+(?:includes|has|spans))\b`,
].join("|"), "gi");
/** Where a sender clause stops: the end of the sentence, or a joined clause about someone or something else. */
const CLAUSE_END = /[.!?;:\n(]|\s[-–—]\s|,\s*(?:and|but|so|which|because|when|if|though|while|as)\b|\s(?:and|but|so)\s+(?:I|you|they|it|your)\b/i;
const SENTENCE_END = /[.!?\n]/;

/** Kinds of service. A clause naming a kind the offer doesn't name claims a service the sender never said they offer. */
const SERVICE_GROUPS: Record<string, RegExp> = {
  web: /\b(?:web|websites?|web\s?pages?|sites?|landing\s+pages?|wordpress|webflow|squarespace|wix|shopify|e-?commerce|online\s+stores?)\b/i,
  apps: /\b(?:apps?|mobile|ios|android|applications?)\b/i,
  dashboards: /\b(?:dashboards?|reporting|reports|analytics|bi|data|metrics)\b/i,
  automation: /\b(?:automat\w*|workflows?|zapier|integrations?|integrate\w*|bots?|chatbots?|ai\s+agents?)\b/i,
  seo: /\b(?:seo|search\s+engine|search\s+rankings?|rankings?)\b/i,
  marketing: /\b(?:marketing|marketers?|ads|advertising|ppc|google\s+ads|campaigns?|social\s+media|lead\s+gen\w*|email\s+marketing|growth\s+hacking)\b/i,
  branding: /\b(?:brand\w*|logos?|visual\s+identity)\b/i,
  content: /\b(?:content|copy|copywrit\w*|writ(?:er|ers|ing|e|es)|edit(?:or|ors|ing|s)?|blogs?|newsletters?|articles?|proofread\w*)\b/i,
  media: /\b(?:videos?|videograph\w*|photo\w*|animation|animators?|podcasts?|illustrat\w*)\b/i,
  finance: /\b(?:bookkeep\w*|accounting|accountants?|tax(?:es)?|payroll|invoic\w*|billing|finances?|financial)\b/i,
  legal: /\b(?:legal|lawyers?|law|compliance|contracts?|agreements?|gdpr)\b/i,
  hiring: /\b(?:recruit\w*|hiring|hr|talent|staffing)\b/i,
  software: /\b(?:software|saas|crm|erp|platforms?|plugins?|apis?|backend|frontend|full-?stack)\b/i,
  design: /\b(?:ui|ux|product\s+design|interfaces?|prototyp\w*|figma)\b/i,
  it: /\b(?:it\s+support|cyber\w*|security|cloud|hosting|servers?|networks?|devops)\b/i,
  training: /\b(?:training|coaching|workshops?|(?:online|training|video)\s+courses?|mentoring)\b/i,
};
/** A credential, record, count or result: allowed only when the offer itself says it. */
const CREDENTIAL = /\b(?:\d+\+?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|several|many)\s+years?\b|\b(?:over|more\s+than|nearly|almost|about)\s+(?:a|one|two|three)\s+decades?\b|\bdecades?\s+of\b|\baward[- ]?winning\b|\bawards?\b|\bcertified\b|\baccredited\b|\blicensed\b|\bindustry[- ]leading\b|\bleading\b|\bleaders?\s+in\b|\btop[- ]rated\b|#\s?1\b|\bnumber\s+one\b|\bbest[- ]in[- ]class\b|\bworld[- ]class\b|\bthe\s+best\b|\btrusted\s+by\b|\b(?:hundreds|thousands|dozens)\s+of\b|\b\d+\+?\s+(?:clients|businesses|companies|brands|clinics|projects|customers|websites|sites|apps|agencies|hotels|startups|teams|people)\b|\bproven\b|\bexperts?\b|\bexpertise\b|\bexperienced\b|\bveteran\b|\bseasoned\b|\b(?:doubled|tripled|doubling|tripling)\b|\b(?:increas|boost|grow|grew|cut|reduc|sav|improv)\w*\s+(?:\w+\s+){0,4}?by\s+\d/gi;
/** Words that say nothing about WHAT the sender offers, so sharing them with the offer proves nothing. */
const GENERIC = new Set(("i we you they it me us my our your their them its a an the this that these those and or but so as of in on at by for from with to into about like yours ours " +
  "also just really mainly mostly usually often primarily specifically currently now already recently personally happily " +
  "help helps helping helped make makes making made build builds building built create creates creating created offer offers provide provides " +
  "run runs running work works working worked support supports manage manages deliver delivers handle handles keep keeps get gets " +
  "small little local big growing whole own simple quick better more easier faster great good new every all lot lots things stuff " +
  "business businesses company companies client clients customer customers team teams people owners founders brands firms " +
  "freelancer freelancers consultant consultants agency agencies studio studios specialist specialists professional professionals " +
  "am are is be been have has had do does did will would can could").split(/\s+/));
const words = (t: string) => (t.toLowerCase().match(/[a-z][a-z0-9+#-]*/g) ?? []).filter((w) => w.length >= 3 && !GENERIC.has(w));
const stem = (w: string) => (w.length > 6 ? w.slice(0, 6) : w.replace(/(?:es|s)$/, ""));
const normalize = (t: string) => t.replace(/[‘’ʼ]/g, "'").slice(0, SCAN.subject + SCAN.body);

export interface SenderOffer { about: string | null; services: string[] }
/** Whether the sender has said, in their own words, what they offer. */
export const offerDescribed = (o: SenderOffer | null | undefined): boolean => !!(o && (o.about?.trim() || o.services.some((s) => s.trim())));

/**
 * Every place the text describes the sender (at most 20): the clause (up to where it turns to something else) and the
 * rest of its sentence, where a credential tacked on after a comma ("…, for over 10 years") is still found.
 */
export function senderClaims(text: string): { clause: string; sentence: string }[] {
  const t = normalize(text);
  const out: { clause: string; sentence: string }[] = [];
  for (const m of Array.from(t.matchAll(SENDER_CLAUSE))) {
    const lead = m[0].match(/^[.!?\n]\s*/)?.[0].length ?? 0;
    const rest = t.slice(m.index! + lead, m.index! + lead + 300);
    const head = m[0].length - lead;
    const cut = rest.slice(head).search(CLAUSE_END), end = rest.slice(head).search(SENTENCE_END);
    out.push({ clause: rest.slice(0, cut < 0 ? rest.length : head + cut).trim(), sentence: rest.slice(0, end < 0 ? rest.length : head + end).trim() });
    if (out.length >= 20) break;
  }
  return out;
}
export const describesSender = (text: string): boolean => senderClaims(text).length > 0;

/**
 * Why a clause about the sender is NOT supported by their offer, or null when it is: a kind of service the offer doesn't
 * name, a credential/count/result the offer doesn't state, or (naming no known service) no word in common with the offer.
 */
export function unsupportedClaim(c: { clause: string; sentence: string }, offer: SenderOffer): string | null {
  const offerText = [offer.about ?? "", ...offer.services].join(". ");
  const groups = Object.entries(SERVICE_GROUPS).filter(([, re]) => re.test(c.clause)).map(([g]) => g);
  const extra = groups.filter((g) => !SERVICE_GROUPS[g].test(offerText));
  if (extra.length) return `a service the offer doesn't name (${extra.join(", ")})`;
  const offerCreds = new Set(Array.from(offerText.matchAll(CREDENTIAL)).map((x) => x[0].toLowerCase()));
  const creds = Array.from(c.sentence.matchAll(CREDENTIAL)).map((x) => x[0].toLowerCase()).filter((x) => !offerCreds.has(x));
  if (creds.length) return `a claim the offer doesn't make ("${creds[0]}")`;
  if (!groups.length) {
    const own = words(c.clause);
    const offerStems = new Set(words(offerText).map(stem));
    if (own.length && !own.some((w) => offerStems.has(stem(w)))) return "something the offer doesn't say";
  }
  return null;
}

/** What the sender has agreed to, beyond the content rules: whether a sample may be offered, and what they said they offer. */
export interface SenderScope { sampleOffered: boolean; offer: SenderOffer | null }
export function scopeIssues(d: Draft, scope: SenderScope): Issue[] {
  const text = `${d.subject}\n${d.body}`;
  const out: Issue[] = [];
  if (!scope.sampleOffered && offersToMake(text)) out.push({ code: "unrequested_offer", message: "It offers to make or prepare something for them. The sender hasn't offered that: remove the offer and ask a question instead." });
  const claims = senderClaims(text);
  if (claims.length && !offerDescribed(scope.offer)) {
    out.push({ code: "describes_sender", message: "It says what the sender is or does. The sender hasn't described their offer: don't describe the sender or any service." });
  } else if (claims.length) {
    for (const c of claims) {
      const why = unsupportedClaim(c, scope.offer!);
      if (!why) continue;
      out.push({ code: "unsupported_sender_claim", message: `It describes the sender with ${why}. Describe the sender only with what "What the sender offers" says, and add no other service, experience, credential, number or result.` });
      break;
    }
  }
  return out;
}

export function checkDraft(d: Draft, ctx: DraftContext): Issue[] {
  return [...checkStructure(d), ...contentIssues(`${d.subject.trim().slice(0, SCAN.subject)}\n${d.body.trim().slice(0, SCAN.body)}`, ctx)];
}

/**
 * The content rules on any model-written outreach text (a draft, or an outreach angle that a draft will be written
 * from): no price, discount or guarantee, no link or address off the company's own site, no invented history, nothing
 * that reads like an instruction. The text is bounded by the caller.
 */
export function contentIssues(rawText: string, ctx: DraftContext): Issue[] {
  const out: Issue[] = [];
  const text = rawText.slice(0, SCAN.subject + SCAN.body + 1);
  const site = ctx.siteHost.toLowerCase().replace(/^www\./, "");
  const to = ctx.to.trim().toLowerCase();

  if (CURRENCY_SYMBOL.test(text) || CURRENCY_WORD.test(text) || PERCENT.test(text) || RATE.test(text) || THOUSANDS.test(text)) {
    out.push({ code: "price", message: "It mentions a price, rate or percentage. The sender has not set one, so none may appear." });
  }
  if (DISCOUNT.test(text)) out.push({ code: "discount_or_guarantee", message: "It offers a discount or a guarantee. Nothing like that has been agreed." });

  const urls = Array.from(text.matchAll(URL_RE)).map((m) => hostOf(m[0]));
  const bare = text.replace(URL_RE, " ").replace(EMAIL, " ").split(/[\s,;:()<>"'\[\]{}!?]+/)
    .map((w) => w.replace(/\.+$/, "")).filter((w) => w.length > 3 && w.length <= 253 && BARE_DOMAIN_WORD.test(w)).map((w) => hostOf(w));
  if ([...urls, ...bare].some((h) => !onSite(h, site))) out.push({ code: "link", message: "It contains a link or web address that is not the company's own site." });

  if (Array.from(text.matchAll(EMAIL)).some((m) => m[0].toLowerCase() !== to)) out.push({ code: "email_address", message: "It contains an email address other than the one it is going to." });
  if (FALSE_HISTORY.test(text)) out.push({ code: "false_history", message: "It talks as if you had already spoken. You have not contacted them yet." });
  if (injectionLike(text)) out.push({ code: "instruction_like", message: "It contains text that reads like an instruction to an AI." });
  return out;
}

/** One line a retry can be told: what to fix. */
export const issuesForRetry = (issues: Issue[]): string => issues.map((i) => `- ${i.message}`).join("\n");
