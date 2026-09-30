/**
 * Deal Risk Checker — /tools/deal-risk-checker
 *
 * The free acquisition tool for both audiences: paste a client's request or a
 * brand's offer and see what it says, what it leaves out, what is worth
 * clarifying and what to ask — before saying yes.
 *
 * Deliberately small and honest:
 *  - The checks are RULES, run in the visitor's browser on the text they
 *    pasted. Nothing is sent anywhere, stored, or logged; the page keeps no
 *    draft. It works with no account and no AI.
 *  - An optional "read it with AI" step reuses the existing public endpoint
 *    (POST /api/ai/demo-deal, one shared daily budget). It only ever adds a
 *    summary; the checks never depend on it, and the page says plainly that
 *    the message is sent to an AI service for that step.
 *  - Wording is the Protection Check's: it checks what the message says, it is
 *    not legal advice, and it never claims a deal is safe, compliant or
 *    protected. A finding names what to clarify, never a legal conclusion.
 *
 * CORE_JS is the single implementation. The browser runs it, and
 * server/tools/deal-risk.test.ts evaluates the same string — so the page and
 * the tests cannot disagree. It is a string (not a TS function passed through
 * toString()) because the server bundle is minified. It is String.raw so the
 * regular expressions read as written.
 */
import { renderToolPage, esc, SITE_ORIGIN } from "./layout";
import { findingTextTable } from "@shared/findingCopy";

const PATH = "/tools/deal-risk-checker";
const TITLE = "Deal Risk Checker — Check a Client or Brand Message Before You Say Yes | DealInSec";
const DESC =
  "Paste a client request or a brand offer and see what's missing before you agree: unclear scope, usage rights, exclusivity, payment timing and more, with the questions to ask. Free, no sign-up.";
const SIGNUP = "/auth?mode=signup&ref=tool_deal_risk";

/**
 * The checker. Plain ES5 so every browser runs it as-is.
 *
 *   drAnalyze(text, kind) -> result
 *     kind   "client" | "brand" | anything else (guessed from the text)
 *   result = { ok:false, error:"short" }
 *          | { ok:true, kind, guessed, summary:[{label,value|null}],
 *              missing:[label], findings:[{id,level,risk,title,why,ask}],
 *              questions:[string], nextStep:string, counts:{important,attention,informational} }
 *
 *   drGuessKind(text) -> "client" | "brand"
 *   drDraftMessage(questions) -> string  a short message to send back
 */
export const CORE_JS = String.raw`
  var DR_MIN = 15;
  function drNorm(t) { return String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); }
  function drFind(re, text) { var m = re.exec(text); return m ? m[0].replace(/\s+/g, ' ').trim() : null; }
  // Up to 'max' distinct matches, joined: "2 Instagram Reels · 3 stories".
  function drFindAll(re, text, max) {
    var g = new RegExp(re.source, 'gi'), out = [], m;
    while ((m = g.exec(text)) !== null && out.length < max) {
      var v = m[0].replace(/\s+/g, ' ').trim();
      if (v && out.indexOf(v) < 0) out.push(v);
      if (m[0].length === 0) g.lastIndex++;
    }
    return out.length ? out.join(' · ') : null;
  }
  function drParty(kind) { return kind === 'brand' ? 'brand' : 'client'; }

  // Signals: what the message actually says. Each is the matched wording, or null.
  var DR_RE = {
    amount: /(?:[$€£₹]\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|lakhs?|lacs?|crores?)?|\b\d[\d,]*(?:\.\d+)?\s?(?:k|m)?\s?(?:usd|eur|gbp|inr|aud|cad|dollars?|euros?|pounds?|rupees?)\b|\b(?:usd|eur|gbp|inr)\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m)?\b|\brs\.?\s?\d[\d,]*)/i,
    deadline: /\b(?:by|before|deadline|due(?: date)?|no later than|until)\b[^.\n]{0,40}\b(?:\d{1,2}(?:st|nd|rd|th)?\b|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|mon|tue|wed|thu|fri|sat|sun|tomorrow|next week|end of)\w*|\b(?:within|in)\s+(?:\d+|one|two|three|four|five|six)\s*(?:business\s+|working\s+)?(?:days?|weeks?|months?)\b/i,
    payment: /\b(?:advance|deposit|upfront|up-front|50\s?%|net\s?\d+|paid\s+(?:on|after|within|upon)|payment\s+(?:on|after|within|upon|terms|is due|will be)|invoice[d]?\s+(?:on|after|within)|within\s+\d+\s*(?:business\s+|working\s+)?days?\s+(?:of|after)|on\s+(?:delivery|completion|posting|publication|launch)|after\s+(?:launch|delivery|posting|publication)|milestone)/i,
    advance: /\b(?:advance|deposit|upfront|up-front|token amount|booking amount)\b/i,
    revisions: /\b(?:revisions?|rounds? of (?:changes|edits|feedback)|rework|iterations?)\b/i,
    unlimitedRevisions: /\bunlimited\s+(?:revision|change|edit|round|iteration)/i,
    cancellation: /\b(?:cancel\w*|terminat\w*|kill fee|call(?:ed)? off)\b/i,
    ownership: /\b(?:ownership|copyright|intellectual property|IP rights|who owns|rights to the)\b/i,
    acceptance: /\b(?:accept\w*|sign[- ]?off|approv\w*)\b/i,
    vague: /\b(?:etc\.?|and more|and so on|whatever (?:you|is) need\w*|as needed|as required|anything else|misc\w*)\b/i,
    platform: /\b(?:instagram|insta|tiktok|youtube|reels?|shorts|linkedin|facebook|twitter|pinterest|snapchat|twitch)\b/i,
    usage: /\b(?:usage rights?|usage|licen[sc]e|licen[sc]ing|organic|repost\w*|use (?:of )?(?:the |your )?(?:content|video|footage|creative|posts?|reels?)|re-?use)\b/i,
    ads: /\b(?:ads?|paid (?:media|advertis\w*|social|promotion)|whitelist\w*|boost\w*|spark ads?|dark posts?)\b/i,
    usageDuration: /(?:\b(?:usage|use|licen[sc]e|rights?|whitelist\w*|ads?)\b[^.\n]{0,60}?\b(?:\d+|one|two|three|six|twelve)\s*(?:day|week|month|year)s?\b)|(?:\b(?:\d+|one|two|three|six|twelve)\s*(?:day|week|month|year)s?\b[^.\n]{0,40}\b(?:usage|licen[sc]e|of use|ad (?:use|rights)))/i,
    openUsage: /\b(?:in perpetuity|perpetual(?:ly)?|forever|irrevocabl\w*|all media|any and all (?:media|channels|platforms|purposes)|unlimited (?:use|usage|rights))\b/i,
    exclusivity: /\b(?:exclusiv\w*|non[- ]?compete|competitors?|competing brands?|only (?:work|partner) with)\b/i,
    exclusivityPeriod: /\bexclusiv\w*[^.\n]{0,60}?\b(?:\d+|one|two|three|six|twelve)\s*(?:day|week|month|year)s?\b/i,
    approval: /\b(?:approv\w*|sign[- ]?off|review(?:ed)?\s+(?:before|the|your)|script|draft|storyboard|concept)\b/i
  };
  var DR_DELIV = {
    client: /\b\d+\s*(?:x\s*)?(?:pages?|logos?|posts?|articles?|blogs?|videos?|designs?|screens?|edits?|hours?|sessions?|graphics?|banners?|emails?)\b|\b(?:website|web site|landing page|logo|app|brand identity|branding|redesign|e-?commerce|store|shopify|wordpress|copywriting|seo|newsletter|pitch deck|dashboard)\b/i,
    brand: /\b\d+\s*(?:x\s*)?(?:(?:instagram|insta|tiktok|youtube|ig|yt)\s+)?(?:reels?|stories|story|posts?|videos?|shorts?|tiktoks?|ugc\s+videos?|integrations?|carousels?|photos?|clips?|dedicated videos?)\b/i
  };
  // For the summary row only: the wording that says HOW the content will be used, so the
  // row reads "use the content for ads" rather than just "use the content".
  var DR_USAGE_PHRASE = /\b(?:use|reuse|re-use|repost\w*|run|share|boost\w*)\b[^.\n]{0,40}\b(?:ads?|advertis\w*|paid (?:media|social|promotion)|whitelist\w*|organic|channels?|platforms?|website|socials?)\b/i;
  var DR_LABEL = {
    amount: 'Fee', deadline: 'Deadline', deliverables: 'Deliverables', payment: 'Payment timing',
    revisions: 'Revision limit', platform: 'Platform', usage: 'Usage rights', usageDuration: 'Usage duration',
    exclusivity: 'Exclusivity', approval: 'Approval process'
  };
  var DR_SHOW = {
    client: ['amount', 'deadline', 'deliverables', 'payment', 'revisions'],
    brand: ['amount', 'deadline', 'deliverables', 'platform', 'payment', 'revisions', 'usage', 'usageDuration', 'exclusivity', 'approval']
  };

  function drGuessKind(text) {
    var t = drNorm(text);
    if (/\b(?:reels?|ugc|influencers?|creators?|sponsored|sponsorship|tiktok|instagram|stories|whitelist\w*|affiliate)\b/i.test(t)) return 'brand';
    return 'client';
  }

  // The wording of findings the in-app Protection Check also raises. It comes from
  // one shared source (shared/findingCopy.ts), so the two cannot drift apart.
  var DR_COPY = ${JSON.stringify(findingTextTable())};

  // Each rule: the finding it raises when 'when' is true. 'shared' rules take their
  // wording from DR_COPY; the rest are checks only a pasted message can raise.
  // 'risk' = dangerous wording that IS in the message; the others are things it
  // does not say.
  var DR_RULES = [
    { id: 'vague_scope', kinds: ['client', 'brand'], level: 'important', risk: true,
      when: function (s) { return !!s.vague; },
      title: function () { return 'Vague scope wording'; },
      why: function () { return 'Words like "etc." or "as needed" let the work grow without a paper trail.'; },
      ask: function (k) { return 'Ask the ' + drParty(k) + ' to list exactly what is included, and price anything beyond it separately.'; } },
    { id: 'unlimited_revisions', shared: true, kinds: ['client', 'brand'], level: 'important', risk: true,
      when: function (s) { return !!s.unlimitedRevisions; } },
    { id: 'open_ended_usage', shared: true, kinds: ['brand'], level: 'important', risk: true,
      when: function (s) { return !!s.openUsage; } },
    { id: 'ads_usage', kinds: ['brand'], level: 'important',
      when: function (s) { return !!s.ads && !s.usageDuration && !s.openUsage; },
      title: function () { return 'The brand wants to use your content in ads'; },
      why: function () { return 'Using content in ads is different from you posting it, and without a time limit it has no end date.'; },
      ask: function () { return 'Ask which ad channels, for how long, and whether ad use is included in the fee or charged separately.'; } },
    { id: 'no_usage_rights', shared: true, kinds: ['brand'], level: 'important',
      when: function (s) { return !s.usage && !s.ads; } },
    { id: 'no_usage_duration', shared: true, kinds: ['brand'], level: 'attention',
      when: function (s) { return !!s.usage && !s.ads && !s.usageDuration && !s.openUsage; } },
    { id: 'no_deliverables', kinds: ['client', 'brand'], level: 'important',
      when: function (s) { return !s.deliverables; },
      title: function () { return "Deliverables aren't clear"; },
      why: function (k) { return k === 'brand' ? 'Without a clear count and format, the brand can ask for more posts than you agreed.' : "If the deliverables aren't listed, the client can ask for anything and call it part of the price."; },
      ask: function (k) { return k === 'brand' ? 'List each piece of content, its platform and the quantity.' : 'List what you will deliver, one line each.'; } },
    { id: 'no_fee', kinds: ['client', 'brand'], level: 'important',
      when: function (s) { return !s.amount; },
      title: function () { return 'No fee is stated'; },
      why: function () { return "If the fee isn't written down, the price can shift after you start."; },
      ask: function () { return 'Confirm the total fee and the currency.'; } },
    { id: 'no_payment_timing', kinds: ['client', 'brand'], level: 'important',
      when: function (s) { return !s.payment; },
      title: function () { return "Payment timing isn't specified"; },
      why: function () { return "Without a stated due date, 'we'll pay after' can quietly become 'whenever'."; },
      ask: function (k) { return 'Confirm when payment is due, for example within 7 days of ' + (k === 'brand' ? 'posting' : 'final delivery') + '.'; } },
    { id: 'no_advance', shared: true, kinds: ['client', 'brand'], level: 'important',
      when: function (s) { return !!s.payment && !s.advance; } },
    { id: 'no_revision_limit', shared: true, kinds: ['client', 'brand'], level: 'attention',
      when: function (s) { return !s.revisions; } },
    { id: 'no_platform', kinds: ['brand'], level: 'attention',
      when: function (s) { return !s.platform; },
      title: function () { return "Platform isn't specified"; },
      why: function () { return "If the platform isn't named, it is unclear where the content is meant to be posted."; },
      ask: function () { return 'Confirm which platform or platforms the content is for.'; } },
    { id: 'no_exclusivity_terms', shared: true, kinds: ['brand'], level: 'attention',
      when: function (s) { return !s.exclusivity; } },
    { id: 'exclusivity_no_period', kinds: ['brand'], level: 'attention',
      when: function (s) { return !!s.exclusivity && !s.exclusivityPeriod; },
      title: function () { return 'Exclusivity has no stated period'; },
      why: function () { return 'Exclusivity with no end date can stop you working with other brands indefinitely.'; },
      ask: function () { return 'Ask for the category it covers and how long it lasts.'; } },
    { id: 'no_approval_process', shared: true, kinds: ['brand'], level: 'attention',
      when: function (s) { return !s.approval; } },
    { id: 'no_acceptance', shared: true, kinds: ['client'], level: 'attention',
      when: function (s) { return !s.acceptance; } },
    { id: 'no_cancellation', shared: true, kinds: ['client', 'brand'], level: 'attention',
      when: function (s) { return !s.cancellation; } },
    { id: 'no_ownership', shared: true, kinds: ['client', 'brand'], level: 'attention',
      when: function (s) { return !s.ownership; } },
    { id: 'no_deadline', shared: true, kinds: ['client', 'brand'], level: 'informational',
      when: function (s) { return !s.deadline; } }
  ];
  var DR_RANK = { important: 0, attention: 1, informational: 2 };

  function drAnalyze(text, kind) {
    var t = drNorm(text);
    if (t.length < DR_MIN) return { ok: false, error: 'short' };
    var guessed = kind !== 'client' && kind !== 'brand';
    if (guessed) kind = drGuessKind(t);

    var s = {};
    for (var key in DR_RE) { if (DR_RE.hasOwnProperty(key)) s[key] = drFind(DR_RE[key], t); }
    s.deliverables = drFindAll(DR_DELIV[kind], t, 4);

    var summary = [], missing = [];
    var show = DR_SHOW[kind];
    for (var i = 0; i < show.length; i++) {
      var k = show[i];
      var value = s[k];
      // Usage rights are stated by either an organic-use or an ads mention; show the
      // fullest wording of how the content will be used.
      if (k === 'usage') value = drFind(DR_USAGE_PHRASE, t) || value || s.ads;
      summary.push({ label: DR_LABEL[k], value: value || null });
      if (!value) missing.push(DR_LABEL[k]);
    }

    var findings = [];
    for (var r = 0; r < DR_RULES.length; r++) {
      var rule = DR_RULES[r];
      if (rule.kinds.indexOf(kind) < 0 || !rule.when(s, t)) continue;
      var txt = rule.shared ? DR_COPY[rule.id][kind] : { title: rule.title(kind), why: rule.why(kind), ask: rule.ask(kind) };
      findings.push({ id: rule.id, level: rule.level, risk: !!rule.risk, title: txt.title, why: txt.why, ask: txt.ask });
    }
    // Stable: most important first, the order the rules are written in otherwise.
    var indexed = findings.map(function (f, n) { return { f: f, n: n }; });
    indexed.sort(function (a, b) { return (DR_RANK[a.f.level] - DR_RANK[b.f.level]) || (a.n - b.n); });
    findings = indexed.map(function (x) { return x.f; });

    var counts = { important: 0, attention: 0, informational: 0 };
    for (var c = 0; c < findings.length; c++) counts[findings[c].level]++;

    var questions = [];
    for (var q = 0; q < findings.length && questions.length < 8; q++) {
      if (findings[q].level === 'informational' && questions.length >= 5) break;
      if (questions.indexOf(findings[q].ask) < 0) questions.push(findings[q].ask);
    }

    var party = drParty(kind);
    var nextStep = counts.important > 0
      ? 'Send the ' + party + ' the questions above before you agree to anything, and keep their answers in writing.'
      : counts.attention > 0
        ? 'Clarify the remaining points, then put the agreed terms in a quotation and an agreement.'
        : 'The message covers the main points. Put the agreed terms in a quotation and an agreement so both sides hold the same record.';

    return { ok: true, kind: kind, guessed: guessed, summary: summary, missing: missing, findings: findings, questions: questions, nextStep: nextStep, counts: counts };
  }

  function drDraftMessage(questions) {
    var lines = ['Hi, thanks for reaching out. Before I confirm, could you clarify a few things?', ''];
    for (var i = 0; i < questions.length; i++) lines.push((i + 1) + '. ' + questions[i]);
    lines.push('', "Once these are clear I'll send a quote and an agreement. Thanks!");
    return lines.join('\n');
  }
`;

interface Example { kind: "client" | "brand"; label: string; text: string }

/** The two examples from the product brief. They are examples of a message a
 *  visitor might receive, not customer data. */
export const EXAMPLES: Example[] = [
  { kind: "client", label: "Client request", text: "Hey, can you build our website for $1,500? We need it by October 20." },
  {
    kind: "brand",
    label: "Brand offer",
    text: "Hey! We'd love 2 Instagram Reels and 3 stories for $800. We'd also like to use the content for ads.",
  },
];

export const FAQ: { q: string; a: string }[] = [
  {
    q: "What does the Deal Risk Checker do?",
    a: "It reads a client request or brand offer you paste in and shows what it says, what it leaves out, which points are worth clarifying and the questions to ask before you agree. It checks the wording of the message only.",
  },
  {
    q: "Is my message stored or sent anywhere?",
    a: "The checks run in your browser on the text you paste, and DealInSec does not save it. The optional AI reading sends the message to an AI service to read it, and only when you press that button; DealInSec does not store it.",
  },
  {
    q: "Is this legal advice?",
    a: "No. It flags terms worth clarifying, such as missing payment timing or usage rights, based on what the message says. It cannot tell you whether a deal is legal, enforceable or safe, and a message that raises no findings is not a guarantee of anything. For high-value or unusual deals, have a lawyer review the terms.",
  },
  {
    q: "What should I check before accepting a brand deal?",
    a: "The deliverables and platform, the fee and when it is paid, how the brand may use the content and for how long, whether exclusivity applies, how content is approved, how many revisions are included and what happens if the campaign is cancelled. The checker looks for each of these in the message.",
  },
  {
    q: "What should I check before accepting a client project?",
    a: "The scope and deliverables, the fee, a deadline, an advance or deposit, when the balance is due, how many revisions are included, who owns the finished work and what happens if the project is cancelled.",
  },
  {
    q: "Can I use it for messages that are not in English?",
    a: "The checks look for English wording, so a message in another language will show most points as not specified. Translate it first, or use the questions as a checklist by hand.",
  },
  {
    q: "Does it work outside India?",
    a: "Yes. It reads any message and is not tied to a country or currency. It recognises the $, €, £ and ₹ signs and common currency codes.",
  },
];

function faqHtml(): string {
  return FAQ.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("\n");
}

function jsonLd(): object[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Deal Risk Checker",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Any",
      url: SITE_ORIGIN + PATH,
      description: DESC,
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Free Tools", item: SITE_ORIGIN + "/tools" },
        { "@type": "ListItem", position: 2, name: "Deal Risk Checker", item: SITE_ORIGIN + PATH },
      ],
    },
  ];
}

const exampleButtons = EXAMPLES.map(
  (e) => `<button type="button" class="btn ghost dr-ex" data-kind="${e.kind}" data-text="${esc(e.text)}">Try a ${esc(e.label.toLowerCase())}</button>`,
).join("\n        ");

const BODY = `
<section class="dr-hero"><div class="wrap">
  <h1>Deal Risk Checker</h1>
  <p class="dr-answer">Paste a client's request or a brand's offer. The Deal Risk Checker shows what the message says, what it leaves out, which points are worth clarifying before you say yes, and the questions to ask. It works for client projects and for brand collaborations, with no sign-up.</p>
</div></section>

<section class="dr-tool"><div class="wrap">
  <div class="card dr-input">
    <label for="dr-text">Paste the message</label>
    <textarea class="f" id="dr-text" rows="6" maxlength="6000" placeholder="Paste a client request, a brand's email or DM, or a campaign brief."></textarea>

    <fieldset class="dr-set">
      <legend>What kind of deal is this?</legend>
      <div class="dr-kinds">
        <label class="dr-radio"><input type="radio" name="kind" value="client" checked /> <span>Client work</span></label>
        <label class="dr-radio"><input type="radio" name="kind" value="brand" /> <span>Brand collaboration</span></label>
      </div>
      <p class="dr-hint" id="dr-guess" hidden></p>
    </fieldset>

    <div class="dr-actions">
      <button type="button" class="btn" id="dr-run">Check this deal</button>
      <button type="button" class="btn ghost" id="dr-clear">Clear</button>
    </div>
    <div class="dr-examples">
      <span class="dr-hint">No message handy?</span>
      ${exampleButtons}
    </div>
    <p class="dr-note">The checks run in your browser and nothing you paste is saved. It checks the wording of the message only; it is not legal advice.</p>
    <p class="dr-err" id="dr-err" role="alert" hidden>Paste a little more of the message, at least a sentence or two.</p>
  </div>

  <div id="dr-result" class="dr-result" aria-live="polite" hidden>
    <div class="card">
      <h2 id="dr-headline">Before you say yes</h2>
      <p class="dr-hint" id="dr-sub"></p>
    </div>

    <div class="card">
      <h3>What the message says</h3>
      <dl class="dr-summary" id="dr-summary"></dl>
      <h3 class="dr-sub-h">Missing information</h3>
      <ul class="dr-chips" id="dr-missing"></ul>
    </div>

    <div class="card">
      <h3>Protection findings</h3>
      <ul class="dr-findings" id="dr-findings"></ul>
    </div>

    <div class="card">
      <h3>Questions to ask</h3>
      <ol class="dr-questions" id="dr-questions"></ol>
      <div class="dr-actions">
        <button type="button" class="btn ghost" id="dr-copy">Copy as a message</button>
        <span class="dr-hint" id="dr-copied" hidden>Copied</span>
      </div>
    </div>

    <div class="card">
      <h3>Suggested next step</h3>
      <p id="dr-next"></p>
    </div>

    <div class="card dr-ai">
      <h3>Read it with AI <span class="dr-opt">optional</span></h3>
      <p class="dr-hint">Pulls the brand or client, fee, deliverables and terms out of the message. Anything the message doesn't say stays "Not specified". Pressing this sends the message to an AI service to read it; DealInSec doesn't store it. It reads up to 600 characters.</p>
      <button type="button" class="btn ghost" id="dr-ai-run">Read it with AI</button>
      <p class="dr-err" id="dr-ai-err" role="alert" hidden></p>
      <dl class="dr-summary" id="dr-ai-out" hidden></dl>
    </div>

    <div class="dr-cta">
      <h2>Keep the answers in one place</h2>
      <p>Create a free DealInSec account and turn this into a deal: the terms you agree go into a quotation, an agreement the client or brand can sign online and an invoice. The free plan and a 7-day trial with no card are open in every country; paid plans can currently be bought in India only.</p>
      <a class="btn" id="dr-cta" href="${SIGNUP}" data-cta>Turn this into a DealInSec deal →</a>
    </div>
  </div>
</div></section>

<section><div class="wrap dr-prose">
  <h2>What the Deal Risk Checker looks for</h2>
  <p>It looks in the message for each of the points below and lists the ones it can't find. The two kinds of deal have different checks, because they leave different things unsaid.</p>
  <div class="dr-table-wrap"><table class="dr-table">
    <thead><tr><th>Check</th><th>Client work</th><th>Brand collaboration</th></tr></thead>
    <tbody>
      <tr><td>Deliverables and scope</td><td>What is being built or written, and how much</td><td>How many pieces of content, in which format, on which platform</td></tr>
      <tr><td>Fee and payment</td><td>The fee, an advance, when the balance is due</td><td>The fee, an advance, when payment is due after posting</td></tr>
      <tr><td>Revisions</td><td>How many rounds of changes are included</td><td>How many rounds of changes are included</td></tr>
      <tr><td>Usage rights</td><td>Not checked</td><td>Where and for how long the brand may use the content, and whether that includes ads</td></tr>
      <tr><td>Exclusivity</td><td>Not checked</td><td>Whether competing brands are ruled out, and for how long</td></tr>
      <tr><td>Approval</td><td>Whether and how the client accepts the work</td><td>Who approves the content and how quickly</td></tr>
      <tr><td>Cancellation and ownership</td><td>Yes</td><td>Yes</td></tr>
      <tr><td>Deadline</td><td>The delivery date</td><td>The posting dates or campaign deadline</td></tr>
    </tbody>
  </table></div>

  <h2>Two examples</h2>
  <p>These are examples of messages you might receive, not customer data.</p>
  <h3>A client request</h3>
  <blockquote>${esc(EXAMPLES[0].text)}</blockquote>
  <p>This states a fee and a deadline. It doesn't say what the website includes, when the client pays, whether there is an advance, how many revisions are included or what happens if the project is cancelled. Those are the points to clarify before agreeing.</p>
  <h3>A brand offer</h3>
  <blockquote>${esc(EXAMPLES[1].text)}</blockquote>
  <p>This states a fee, a platform and a quantity. It asks to use the content for ads without saying for how long or whether that is included in the fee. It doesn't say when payment is due, whether exclusivity applies or how the content is approved.</p>

  <h2>What to do with the findings</h2>
  <ol>
    <li><b>Send the questions</b> in one message rather than one at a time. The tool drafts it for you to copy and edit.</li>
    <li><b>Keep the answers in writing</b>, in the same thread as the offer.</li>
    <li><b>Put the agreed terms in a document.</b> The free <a href="/tools/quotation-maker">quotation maker</a> and <a href="/tools/service-agreement-template">service agreement template</a> work for either kind of deal.</li>
    <li><b>Agree how you will be paid</b> before you start. <a href="/blog/freelance-payment-terms">Freelance payment terms</a> explains deposits, milestones and due dates, and the <a href="/tools/invoice-due-date-calculator">invoice due date calculator</a> works out the date.</li>
  </ol>
  <p>If the scope keeps growing, <a href="/blog/scope-creep">how to handle scope creep</a> and <a href="/blog/revision-limits">setting revision limits</a> cover the responses. For a longer walk through what a contract should say, see <a href="/blog/freelance-contract-terms">freelance contract terms</a>.</p>
</div></section>

<section id="faq"><div class="wrap faq">
  <h2>Frequently asked questions</h2>
  ${faqHtml()}
</div></section>
`;

const PAGE_JS = `
  var $ = function (id) { return document.getElementById(id); };
  var used = false, started = false, guessedByUser = false, lastResult = null, lastText = '';
  function gt(name, extra) {
    if (typeof window.gtag !== 'function') return;
    var p = { tool: 'deal-risk-checker' };
    for (var k in (extra || {})) p[k] = extra[k];
    try { window.gtag('event', name, p); } catch (e) {}
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function kindValue() { var el = document.querySelector('input[name="kind"]:checked'); return el ? el.value : 'client'; }
  function setKind(v) { var el = document.querySelector('input[name="kind"][value="' + v + '"]'); if (el) el.checked = true; }

  // Until the visitor chooses a kind themselves, follow what the text looks like.
  function autoKind() {
    if (guessedByUser) return;
    var t = $('dr-text').value;
    if (t.length < DR_MIN) { $('dr-guess').hidden = true; return; }
    var g = drGuessKind(t);
    if (g !== kindValue()) setKind(g);
    $('dr-guess').hidden = false;
    $('dr-guess').textContent = g === 'brand' ? 'This reads like a brand collaboration. Change it above if it isn’t.' : 'This reads like client work. Change it above if it isn’t.';
  }

  var BADGE = { important: ['Important', 'dr-b-imp'], attention: ['Attention', 'dr-b-att'], informational: ['Good to know', 'dr-b-inf'] };

  function render(r) {
    lastResult = r;
    var clarify = r.counts.important + r.counts.attention;
    $('dr-headline').textContent = r.findings.length === 0
      ? 'No missing or risky terms found in this message.'
      : clarify > 0
        ? 'Before you say yes, clarify ' + (clarify === 1 ? 'this 1 thing' : 'these ' + clarify + ' things') + '.'
        : 'Nothing important is missing.';
    $('dr-sub').textContent = (r.findings.length ? 'DealInSec found some terms worth clarifying before you proceed. ' : '') + 'This checks the wording of the message only; it is not legal advice.';

    $('dr-summary').innerHTML = r.summary.map(function (row) {
      return '<div class="dr-row"><dt>' + esc(row.label) + '</dt><dd' + (row.value ? '' : ' class="dr-ns"') + '>' + (row.value ? esc(row.value) : 'Not specified') + '</dd></div>';
    }).join('');

    $('dr-missing').innerHTML = r.missing.length
      ? r.missing.map(function (m) { return '<li class="dr-chip">' + esc(m) + '</li>'; }).join('')
      : '<li class="dr-none">Nothing on the checklist is missing from this message.</li>';

    $('dr-findings').innerHTML = r.findings.length
      ? r.findings.map(function (f) {
          var b = BADGE[f.level];
          return '<li class="dr-f"><div class="dr-f-head"><span class="dr-badge ' + b[1] + '">' + b[0] + '</span><b>' + esc(f.title) + '</b></div>' +
            '<p class="dr-why">' + esc(f.why) + '</p><p class="dr-ask">' + esc(f.ask) + '</p></li>';
        }).join('')
      : '<li class="dr-f"><p class="dr-why">Every point the checker looks for is mentioned. It can only see what the message says, so this is not a guarantee of anything.</p></li>';

    $('dr-questions').innerHTML = r.questions.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('');
    $('dr-copy').hidden = r.questions.length === 0;
    $('dr-next').textContent = r.nextStep;
    $('dr-ai-out').hidden = true; $('dr-ai-err').hidden = true;
    $('dr-result').hidden = false;
  }

  function run() {
    var text = $('dr-text').value;
    var r = drAnalyze(text, kindValue());
    $('dr-err').hidden = r.ok;
    if (!r.ok) { $('dr-result').hidden = true; return; }
    lastText = text;
    render(r);
    gt('tool_completed', { audience: r.kind === 'brand' ? 'brand_collaboration' : 'client_work' });
    if (!used) { used = true; gt('tool_use'); }
    $('dr-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('dr-text').addEventListener('input', function () {
    if (!started) { started = true; gt('tool_started'); }
    autoKind();
  });
  document.querySelectorAll('input[name="kind"]').forEach(function (el) {
    el.addEventListener('change', function () { guessedByUser = true; $('dr-guess').hidden = true; });
  });
  $('dr-run').addEventListener('click', run);
  $('dr-clear').addEventListener('click', function () {
    $('dr-text').value = ''; $('dr-result').hidden = true; $('dr-err').hidden = true; $('dr-guess').hidden = true; guessedByUser = false; lastResult = null;
  });
  document.querySelectorAll('.dr-ex').forEach(function (b) {
    b.addEventListener('click', function () {
      $('dr-text').value = b.getAttribute('data-text');
      setKind(b.getAttribute('data-kind')); guessedByUser = true; $('dr-guess').hidden = true;
      if (!started) { started = true; gt('tool_started'); }
      run();
    });
  });
  $('dr-copy').addEventListener('click', function () {
    if (!lastResult) return;
    var msg = drDraftMessage(lastResult.questions);
    var done = function () { $('dr-copied').hidden = false; setTimeout(function () { $('dr-copied').hidden = true; }, 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(msg).then(done, function () {});
  });

  // ── Optional AI reading — reuses the public demo endpoint and its shared daily budget ──
  var aiDraft = null;
  function row(label, value) {
    return '<div class="dr-row"><dt>' + esc(label) + '</dt><dd' + (value ? '' : ' class="dr-ns"') + '>' + (value ? esc(value) : 'Not specified') + '</dd></div>';
  }
  $('dr-ai-run').addEventListener('click', function () {
    var btn = $('dr-ai-run'), err = $('dr-ai-err');
    err.hidden = true;
    if (!lastResult) return;
    if (lastText.length > 600) { err.textContent = 'The AI reading takes up to 600 characters. The checks above used your whole message.'; err.hidden = false; return; }
    btn.disabled = true; btn.textContent = 'Reading…';
    var brand = lastResult.kind === 'brand';
    fetch('/api/ai/demo-deal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: lastText, audience: brand ? 'brand_collaboration' : 'client_work' }) })
      .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (x) {
        if (!x.ok) { err.textContent = (x.d && x.d.error) || 'The AI reading isn’t available right now. The checks above still work.'; err.hidden = false; return; }
        var d = x.d.draft; aiDraft = d;
        var bt = d.brandTerms || {};
        var rows = [row(brand ? 'Brand' : 'Client', d.client), row(brand ? 'Campaign' : 'Project', d.project), row('Fee', x.d.amountLabel), row('Timeline', d.timeline),
          row('Deliverables', (d.deliverables || []).join(', '))];
        if (brand) rows.push(row('Platforms', (d.platforms || []).join(', ')), row('Usage rights', bt.usageRights), row('Usage duration', bt.usageDuration), row('Exclusivity', bt.exclusivity), row('Approval', bt.approval));
        if (x.d.warning) rows.push('<div class="dr-row"><dt>Check</dt><dd>' + esc(x.d.warning) + '</dd></div>');
        $('dr-ai-out').innerHTML = rows.join(''); $('dr-ai-out').hidden = false;
        gt('ai_deal_analysis_completed', { audience: brand ? 'brand_collaboration' : 'client_work' });
      })
      .catch(function () { err.textContent = 'Couldn’t reach the server. The checks above still work.'; err.hidden = false; })
      .then(function () { btn.disabled = false; btn.textContent = 'Read it with AI'; });
  });

  // Hand the AI draft to the app in the same shape and under the same key the landing
  // demo and the Copilot use; the create-deal form reads it after sign-up.
  $('dr-cta').addEventListener('click', function () {
    if (!lastResult) return;
    // Onboarding preselects the same work type, so the visitor isn't asked again.
    try { sessionStorage.setItem('dis_audience_intent', lastResult.kind === 'brand' ? 'brand_collaboration' : 'client_work'); } catch (e) {}
    if (!aiDraft) return;
    var d = aiDraft, brand = lastResult.kind === 'brand';
    var today = new Date(), end = new Date(today.getTime() + 14 * 86400000);
    var prefill = {
      brandName: d.client || '', dealTitle: d.project || '',
      dealType: brand ? 'Brand Collaboration' : 'Custom',
      dealAmount: d.amount || undefined,
      startDate: today.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10),
      customTerms: (d.terms || []).join('\\n'),
      deliverables: (d.deliverables && d.deliverables.length) ? d.deliverables.map(function (label) {
        return { platform: brand && d.platforms && d.platforms[0] ? d.platforms[0] : 'Service', contentType: label, quantity: 1, frequency: 'One-time', notes: '' };
      }) : undefined
    };
    if (brand && d.brandTerms) prefill.brandTerms = d.brandTerms;
    try { sessionStorage.setItem('dis_deal_prefill', JSON.stringify(prefill)); } catch (e) {}
    gt('signup_from_tool', { audience: brand ? 'brand_collaboration' : 'client_work' });
  });
`;

const STYLE = `<style>
  .dr-hero{padding:36px 0 4px}
  @media(max-width:600px){.dr-hero{padding-top:22px}.dr-answer{font-size:15px}}
  .dr-hero h1{font-size:clamp(28px,4.6vw,42px);font-weight:800;letter-spacing:-.02em;margin:0 0 12px}
  .dr-answer{max-width:68ch;color:var(--muted);font-size:16px;line-height:1.65;margin:0}
  .dr-tool{padding-top:18px}
  .dr-input textarea{min-height:140px;resize:vertical}
  .dr-set{border:0;padding:0;margin:16px 0 0}
  .dr-set legend{font-size:13px;font-weight:600;color:var(--muted);margin-bottom:8px;padding:0}
  .dr-kinds{display:flex;gap:10px;flex-wrap:wrap}
  .dr-radio{display:inline-flex;align-items:center;gap:8px;font-size:14.5px;font-weight:600;background:#fff;border:1.5px solid var(--line);border-radius:10px;padding:10px 14px;cursor:pointer;margin:0}
  .dr-radio:has(input:checked){border-color:var(--green);background:var(--accent-bg);color:var(--accent-fg)}
  .dr-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:16px}
  .dr-examples{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px}
  .dr-examples .btn{padding:8px 14px;font-size:13.5px}
  .dr-hint{font-size:13px;color:var(--muted);margin:6px 0 0}
  .dr-note{font-size:12.5px;color:var(--muted);background:var(--bg);border-radius:10px;padding:10px 12px;line-height:1.55;margin:14px 0 0}
  .dr-err{color:#b42318;font-size:13px;margin:8px 0 0}
  .dr-result{display:grid;gap:16px;margin-top:18px}
  .dr-result h2{margin:0 0 4px;font-size:clamp(20px,3vw,26px)}
  .dr-result h3{margin:0 0 10px;font-size:16px}
  .dr-opt{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-left:6px}
  .dr-summary{margin:0;display:grid;gap:8px;grid-template-columns:1fr}
  @media(min-width:640px){.dr-summary{grid-template-columns:1fr 1fr}}
  .dr-row{border:1px solid var(--card-line);border-radius:10px;padding:8px 12px;min-width:0}
  .dr-row dt{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
  .dr-row dd{margin:2px 0 0;font-size:14.5px;overflow-wrap:anywhere}
  .dr-ns{color:var(--muted)}
  .dr-sub-h{margin:18px 0 8px}
  .dr-chips{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:8px}
  .dr-chip{font-size:13px;font-weight:600;color:#92400e;background:#fef3c7;border-radius:999px;padding:5px 12px}
  .dr-none{font-size:14px;color:var(--muted)}
  .dr-findings{list-style:none;padding:0;margin:0;display:grid;gap:10px}
  .dr-f{border:1px solid var(--card-line);border-radius:12px;padding:12px 14px}
  .dr-f-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .dr-badge{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;border-radius:999px;padding:3px 9px}
  .dr-b-imp{background:#ffe4e6;color:#be123c}
  .dr-b-att{background:#fef3c7;color:#92400e}
  .dr-b-inf{background:#f1f5f9;color:#334155}
  .dr-why{margin:6px 0 0;font-size:14px;color:var(--muted)}
  .dr-ask{margin:6px 0 0;font-size:14px}
  .dr-questions{margin:0;padding-left:22px;line-height:1.65}
  .dr-questions li{margin-bottom:6px}
  .dr-cta{background:var(--accent-bg,#ecfdf5);border:1px solid var(--accent-line,#bbf7d0);border-radius:16px;padding:22px}
  .dr-cta h2{margin-top:0}
  .dr-prose{max-width:780px}
  .dr-prose h2{margin-top:30px}
  .dr-prose ol{padding-left:22px;line-height:1.7}
  .dr-prose li{margin-bottom:6px}
  .dr-prose blockquote{margin:8px 0;padding:10px 14px;border-left:3px solid var(--green);background:#fff;border-radius:0 10px 10px 0;color:var(--ink)}
  .dr-table-wrap{overflow-x:auto}
  .dr-table{width:100%;border-collapse:collapse;font-size:14.5px;background:var(--card);border:1px solid var(--card-line)}
  .dr-table th,.dr-table td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--card-line);vertical-align:top}
  .dr-table th{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);background:var(--bg)}
  .faq details{border-bottom:1px solid var(--card-line);padding:12px 0}
  .faq summary{font-weight:600;cursor:pointer}
</style>`;

export function dealRiskPage(): string {
  return renderToolPage({
    title: TITLE,
    description: DESC,
    canonicalPath: PATH,
    jsonLd: jsonLd(),
    headExtra: STYLE,
    bodyHtml: BODY,
    hideCtaBand: true,
    bodyEndScripts: "<script>(function(){" + CORE_JS + PAGE_JS + "})();</script>",
  });
}

export const dealRiskMeta = {
  slug: "deal-risk-checker",
  path: PATH,
  title: "Deal Risk Checker",
  blurb:
    "Paste a client request or a brand offer and see what's missing before you say yes: scope, payment timing, usage rights, exclusivity and more, with the questions to ask.",
};
