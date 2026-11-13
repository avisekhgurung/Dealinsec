/**
 * Category landing pages — the commercial-intent SEO layer.
 *
 * Keyword-researched (Ubersuggest India, Aug 2026): each page targets one
 * low-difficulty commercial cluster — "quotation software" (480/mo, SD 33),
 * "contract management software India" (SD 15), "proposal management
 * software" (SD 17), "invoice management software for small business" (SD 9),
 * "best e signature software" (SD 9). The homepage owns "deal management
 * software" (SD 15); these pages own the members of the thread and link back.
 *
 * Audience (Sept 2026 pivot): India's freelancers ONLY — designers,
 * developers, writers, video editors & photographers, marketers and
 * consultants. /freelancer-invoice-software is the flagship; the old
 * /interior-design-software page is gone (301'd to the flagship elsewhere),
 * so nothing here may link to it. Pricing on every page: Free ₹0, covering the
 * whole deal-to-invoice flow with no monthly cap (13 Nov 2026 — nothing in it
 * is gated on the plan any more), Pro ₹299/month for the larger Client Radar
 * and outreach-draft allowances. No founding offer, no Deal Boost, no team
 * seats in marketing copy.
 *
 * Same architecture as /tools and /blog: complete server-rendered HTML,
 * registered BEFORE the SPA catch-all. Every path here must ALSO be in
 * shared/ssr-paths.ts (which feeds vite.config.ts's service-worker exclusions;
 * server/seo.test.ts fails if one is missing) and in the landing page's
 * plain-anchor checks — otherwise the PWA service worker / wouter swallow the
 * navigation.
 *
 * Copy rules (standing): no invented customers, counts or testimonials; no
 * claims that agreements are "binding" — electronic acceptance with an audit
 * record, hedged, exactly as the product's own documents state it; in-app
 * invoices are NOT Rule-46 GST tax invoices and the invoice page says so
 * plainly; never promise that a client WILL pay — the product prevents the
 * non-payment disorganisation causes and leaves a record, nothing more.
 */
import type { Express } from "express";
import { esc, SITE_ORIGIN, LOGO_SVG, gaSnippet, COOKIE_FOOTER_LINKS } from "./tools/layout";
import { FONT_HEAD, FONT_STACK_SANS } from "./fonts";
import { consentBanner } from "@shared/consent-script";
import { EXTRA_SEAT_PRICE_INR, PRICING, TAGLINE } from "@shared/product-facts";
import { PRO_INCLUDED_SEATS } from "@shared/permissions";
import { OUTBOUND_ALLOWANCE_DEFAULTS as OB, OUTBOUND_WINDOW_DAYS } from "@shared/outbound-plans";
import { LEAGUE_LIMITS } from "@shared/ai-league";
import { leagueAllowance, LEAGUE_WINDOW_DAYS } from "./ai-league/limits";

// ?ref=, not utm_*: an internal UTM would overwrite the organic session source in GA4.
const SIGNUP = "/auth?mode=signup&ref=category";

interface Faq {
  q: string;
  a: string;
}

export interface CategoryPage {
  path: string;
  /** "IN" pages are written for India (₹ pricing, GST, PAN). "global" pages
   *  must contain no India-only framing and advertise only what can actually
   *  be bought from anywhere (the free plan). */
  region: "IN" | "global";
  /** ISO date of the last substantive edit → sitemap <lastmod>. */
  updated?: string;
  /** Extra structured data for this page (e.g. Organization on /about). */
  extraJsonLd?: object[];
  /** Social/preview image for pages that have one. */
  ogImage?: { src: string; alt: string; w: number; h: number };
  /** <title> (site name appended). */
  metaTitle: string;
  description: string;
  h1: string;
  sub: string;
  chips: string[];
  /** Label used when other category pages link here. */
  shortLabel: string;
  /** Page-specific sections (HTML), rendered between the thread and the FAQ. */
  sections: string;
  faq: Faq[];
}

/* ── Shell ─────────────────────────────────────────────────────────────── */

const STYLES = `<style>
  *,*::before,*::after{box-sizing:border-box}
  :root{--green:hsl(160 84% 30%);--green-d:hsl(160 84% 23%);--ink:hsl(222 47% 11%);--muted:hsl(215 16% 47%);--line:hsl(215 20% 88%);--card-line:hsl(215 20% 92%);--bg:hsl(210 20% 98%);--card:hsl(0 0% 100%);--accent-bg:hsl(160 60% 95%);--accent-fg:hsl(160 55% 22%);--accent-line:hsl(160 40% 85%)}
  html{-webkit-text-size-adjust:100%}
  body{margin:0;font-family:${FONT_STACK_SANS};color:var(--ink);background:var(--bg);line-height:1.65;-webkit-font-smoothing:antialiased}
  a{color:var(--green);text-decoration:none}
  a:hover{text-decoration:underline}
  h1,h2,h3{line-height:1.2;margin:0 0 .5em}
  .wrap{max-width:1080px;margin:0 auto;padding:0 20px}
  .btn{display:inline-flex;align-items:center;gap:8px;background:var(--green);color:#fff;font-weight:700;padding:13px 24px;border-radius:12px;border:0;cursor:pointer;font-size:15px}
  .btn:hover{background:var(--green-d);text-decoration:none;color:#fff}
  .btn.ghost{background:transparent;color:var(--green);border:1.5px solid var(--line)}
  .btn.ghost:hover{background:#fff;border-color:var(--green);color:var(--green)}
  header.site{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.9);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
  header.site .wrap{display:flex;align-items:center;justify-content:space-between;height:64px}
  .brand{display:inline-flex;align-items:center;gap:9px;font-family:Inter,"Source Sans 3",sans-serif;font-size:19px;font-weight:800;line-height:1;letter-spacing:-.034em;color:#111B22}
  .brand:hover{text-decoration:none}
  .logo{flex-shrink:0;filter:drop-shadow(0 1px 1px rgba(0,0,0,.05))}
  .brand-accent{background:linear-gradient(180deg,#22D892 0%,#0C8E7B 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:#10A584}
  .nav{display:none;align-items:center;gap:2px}
  @media(min-width:820px){.nav{display:flex}}
  .nav a{padding:8px 14px;border-radius:10px;font-size:14px;font-weight:600;color:var(--muted)}
  .nav a:hover{color:var(--ink);background:hsl(210 20% 93%);text-decoration:none}
  footer.site{background:#fff;border-top:1px solid var(--line);padding:34px 0;color:var(--muted);font-size:14px}
  footer.site .links{display:flex;gap:18px;flex-wrap:wrap;margin-bottom:10px}
  .muted{color:var(--muted)}

  .hero{padding:56px 0 26px;text-align:center}
  .hero h1{font-size:clamp(28px,4.8vw,44px);font-weight:700;letter-spacing:-.02em;max-width:820px;margin:0 auto 12px}
  .hero p.sub{font-size:clamp(16px,2.2vw,19px);color:var(--muted);max-width:680px;margin:0 auto 22px}
  .hero-ctas{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
  .chips{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin:22px 0 0}
  .chip{font-size:13px;font-weight:600;color:var(--accent-fg);background:var(--accent-bg);border:1px solid var(--accent-line);border-radius:999px;padding:6px 12px}

  section{padding:26px 0}
  section h2{font-size:clamp(21px,3vw,27px);font-weight:700;letter-spacing:-.01em}
  section p,section li{font-size:16px;color:var(--ink)}
  .sec-sub{color:var(--muted);max-width:720px}

  .thread{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:18px}
  .team{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:16px}
  @media(max-width:760px){.team{grid-template-columns:1fr}}
  .mate{display:flex;gap:12px;align-items:center;background:var(--card);border:1px solid var(--card-line);border-radius:16px;padding:14px}
  .mate img{width:64px;height:64px;border-radius:50%;object-fit:cover;flex-shrink:0;box-shadow:0 6px 14px -8px rgba(60,40,20,.55)}
  .mate b{display:block;font-size:16px}
  .mate .role{font-size:13px;font-weight:700;margin-bottom:2px}
  .mate p{margin:0;font-size:14px;color:var(--muted)}
  @media(max-width:860px){.thread{grid-template-columns:1fr 1fr}}
  @media(max-width:520px){.thread{grid-template-columns:1fr}}
  .th-card{background:var(--card);border:1px solid var(--card-line);border-radius:16px;padding:20px;box-shadow:0 1px 2px rgba(16,24,40,.04)}
  .th-card .n{width:32px;height:32px;border-radius:50%;background:var(--accent-bg);color:var(--accent-fg);font-weight:700;display:grid;place-items:center;margin-bottom:10px;font-size:14px}
  .th-card b{display:block;margin-bottom:5px;font-size:15.5px}
  .th-card p{font-size:14px;color:var(--muted);margin:0}
  .th-card.hl{border-color:var(--green);box-shadow:0 4px 14px rgba(4,120,87,.12)}

  .feat{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}
  @media(max-width:760px){.feat{grid-template-columns:1fr}}
  .ft{background:var(--card);border:1px solid var(--card-line);border-radius:16px;padding:20px}
  .ft b{display:block;margin-bottom:5px;font-size:15.5px}
  .ft p{font-size:14.5px;color:var(--muted);margin:0}

  .callout{border-radius:14px;padding:16px 18px;margin:18px 0 0;border:1px solid;font-size:15px}
  .callout.honest{background:var(--accent-bg);border-color:var(--accent-line)}
  .callout b:first-child{display:block;margin-bottom:4px}
  .callout p{margin:0;font-size:15px}

  table.cmp{width:100%;border-collapse:collapse;font-size:14.5px;margin:16px 0 0}
  table.cmp th{background:var(--accent-bg);color:var(--accent-fg);text-align:left;padding:10px 12px;border:1px solid var(--accent-line);font-size:13px}
  table.cmp td{padding:10px 12px;border:1px solid var(--card-line);vertical-align:top}
  .tbl-scroll{overflow-x:auto}
  .tbl-scroll table.cmp{min-width:560px}

  .faq h3{font-size:17px;margin:18px 0 4px}
  .faq p{color:var(--muted);margin:0;font-size:15px}

  .rel-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px;margin-top:14px}
  .rel-card{background:var(--card);border:1px solid var(--card-line);border-radius:14px;padding:16px;color:var(--ink);font-weight:700;font-size:15px}
  .rel-card:hover{text-decoration:none;border-color:var(--green)}
  .rel-card span{display:block;color:var(--muted);font-weight:500;font-size:13px;margin-top:4px}

  .cta-band{background:linear-gradient(135deg,var(--green),#0a6e46);margin-top:34px}
  .cta-band .wrap{padding:44px 20px;text-align:center}
  .cta-band h2{color:#fff;font-size:clamp(22px,3.5vw,30px);font-weight:700;margin:0 0 8px}
  .cta-band p{color:#DCFCE7;max-width:600px;margin:0 auto 20px;font-size:16px}
  .cta-band .btn{background:#fff;color:var(--green-d)}
  .cta-band .btn:hover{background:#F0FDF4}
  .cta-band .sub-note{display:block;color:#A7F3D0;font-size:13px;margin-top:12px}
</style>`;

function header(): string {
  return `<header class="site"><div class="wrap">
    <a class="brand" href="/" aria-label="DealInSec home">${LOGO_SVG}<span class="brand-text">Deal<span class="brand-accent">InSec</span></span></a>
    <nav class="nav">
      <a href="/">Product</a>
      <a href="/ai-coworkers">AI Team</a>
      <a href="/crm-for-freelancers">CRM</a>
      <a href="/tools">Free Tools</a>
      <a href="/blog">Blog</a>
      <a href="/#pricing">Pricing</a>
    </nav>
    <a class="btn" href="${SIGNUP}">Get started free →</a>
  </div></header>`;
}

function footer(region: "IN" | "global"): string {
  const tagline =
    region === "IN"
      ? "find clients, win deals and get paid. For freelancers, consultants and small agencies in India: Client Radar to find clients, AI Team, then quotation, agreement signed online, invoice and payment follow-up."
      : "find clients, win deals and get paid. For freelancers, consultants and small agencies wherever they bill from: Client Radar to find clients, AI Team, then quotation, agreement signed online, invoice and payment follow-up.";
  return `<footer class="site"><div class="wrap">
    <div class="links">
      <a href="/">Product</a>
      <a href="/freelance-business-management-software">Freelance Business Management</a>
      <a href="/crm-for-freelancers">CRM for Freelancers</a>
      <a href="/for-freelancers">For Freelancers</a>
      <a href="/for-creators">For Creators</a>
      <a href="/find-local-clients">Find Local Clients</a>
      <a href="/ai-coworkers">AI Team</a>
      <a href="/tools/deal-risk-checker">Deal Risk Checker</a>
      <a href="/freelancer-invoice-software">Freelancer Invoice Software</a>
      <a href="/quotation-software">Quotation Software</a>
      <a href="/contract-management">Contract Management</a>
      <a href="/invoice-management">Invoice Management</a>
      <a href="/e-signature">E-Signature</a>
      <a href="/bonsai-alternatives">Bonsai Alternatives</a>
      <a href="/tools">Free Tools</a>
      <a href="/blog">Blog</a>
      <a href="/about">About</a>
      <a href="/terms">Terms</a>
      <a href="/privacy">Privacy</a>
      ${COOKIE_FOOTER_LINKS}
    </div>
    ${consentBanner()}
    <div class="muted">© 2026 DealInSec — ${tagline}</div>
  </div></footer>`;
}

function ctaBand(region: "IN" | "global"): string {
  const sub =
    region === "IN"
      ? "Client Radar finds potential clients with evidence, your AI Team helps with research, drafts and briefings, and every deal runs from quotation to an agreement signed online, invoices and payment follow-up. For freelancers, consultants and small agencies in India."
      : "Client Radar finds potential clients with evidence, your AI Team helps with research, drafts and briefings, and every deal runs from quotation to an agreement signed online, invoices and payment follow-up. For freelancers, consultants and small agencies, wherever you bill from.";
  const note =
    region === "IN"
      ? `No card required · Free plan · Pro ₹${PRICING.proMonthlyInr}/month`
      : "No card required · Free plan in every country · Paid plans currently available in India";
  return `<div class="cta-band"><div class="wrap">
    <h2>${TAGLINE}</h2>
    <p>${sub}</p>
    <a class="btn" href="${SIGNUP}" data-cta>Get started free →</a>
    <span class="sub-note">${note}</span>
  </div></div>`;
}

/** The whole journey, from finding the client to getting paid, highlighting this page's step. */
type ThreadStep = "find" | "lead" | "quote" | "contract" | "invoice" | "track";
function threadSection(highlight: ThreadStep | "none"): string {
  const steps: { key: ThreadStep; n: string; title: string; body: string }[] = [
    { key: "find", n: "1", title: "Find clients", body: "Client Radar researches companies online in any country, or local businesses in a city, and scores each one with the evidence. Nobody is contacted until you choose." },
    { key: "lead", n: "2", title: "Leads and deals", body: "Save the right ones as leads with next steps and follow-up dates; a won lead becomes a deal with the client, scope, fee and dates." },
    { key: "quote", n: "3", title: "Quotation", body: "Generated from the deal record — itemised deliverables, revision rounds, terms, a stable number (QT-series) and a link your client accepts online." },
    { key: "contract", n: "4", title: "Agreement", body: "The accepted quotation becomes an agreement with the same figures. Electronic acceptance is recorded — who, when, which signature." },
    { key: "invoice", n: "5", title: "Invoice", body: "Billed from the agreement — advance/balance or milestones — and DealInSec won't let you invoice more than the agreement is worth." },
    { key: "track", n: "6", title: "Payment follow-up", body: "Overdue, due this week, ready to invoice — the dashboard shows what to chase, and AI drafts a polite reminder you send yourself." },
  ];
  const cards = steps
    .map((s) => `<div class="th-card${s.key === highlight ? " hl" : ""}"><div class="n">${s.n}</div><b>${s.title}</b><p>${s.body}</p></div>`)
    .join("");
  return `<section><div class="wrap">
    <h2>One thread from finding the client to getting paid</h2>
    <p class="sec-sub">Each step carries the one before it forward, so the client, the scope and the numbers never drift between your research, your quotation, your agreement and your invoice.</p>
    <div class="thread">${cards}</div>
  </div></section>`;
}

/** Nibo, Mika and Zee, briefly, on every page but their own: the AI team is part of the product, not an extra. */
function aiTeamSection(): string {
  const mates = [
    { bot: "nibo", name: "Nibo 🔎", role: "Deal Finder", colour: "#92400e", line: "Finds potential clients and researches businesses, with sources." },
    { bot: "mika", name: "Mika 💌", role: "Deal Closer", colour: "#be123c", line: "Drafts personalised outreach and follow-ups for you to approve and send." },
    { bot: "zee", name: "Zee 🌱", role: "Business Buddy", colour: "#047857", line: "Tells you which follow-ups are due and which messages are waiting for you." },
  ];
  const cards = mates.map((m) => `<div class="mate"><img src="/ai-league/plush/${m.bot}-${m.bot === "nibo" ? "search" : m.bot === "mika" ? "letter" : "tea"}-sm.webp" width="64" height="64" loading="lazy" decoding="async" alt="${m.name.split(" ")[0]}, the ${m.role}"><div><b>${m.name}</b><div class="role" style="color:${m.colour}">${m.role}</div><p>${m.line}</p></div></div>`).join("");
  return `<section><div class="wrap">
    <h2>Your AI Team</h2>
    <p class="sec-sub">Three AI coworkers work in the background through the same features you use, and ask before anything that matters. Nothing is sent, paid or signed by them. <a href="/ai-coworkers">Meet the team</a>.</p>
    <div class="team">${cards}</div>
  </div></section>`;
}

/** The commercial pillar every category/comparison page links to. Kept as data
 *  here (not imported) so server/comparison-pages.ts can depend on this file
 *  without a cycle. */
export const PILLAR_LINK = {
  path: "/freelance-business-management-software",
  shortLabel: "Freelance Business Management Software",
  h1: "Everything a freelancer needs to run client work, from deal to paid",
};

interface RelatedLink {
  path: string;
  shortLabel: string;
  h1: string;
}

function relatedSection(currentPath: string, siblings: RelatedLink[]): string {
  const all = [...siblings, PILLAR_LINK];
  const seen = new Set<string>();
  const cards = all
    .filter((p) => p.path !== currentPath && !seen.has(p.path) && seen.add(p.path))
    .map((p) => `<a class="rel-card" href="${esc(p.path)}">${esc(p.shortLabel)}<span>${esc(p.h1)}</span></a>`)
    .join("");
  return `<section><div class="wrap">
    <h2>The rest of the thread</h2>
    <div class="rel-grid">${cards}</div>
  </div></section>`;
}

/* ── Pages ─────────────────────────────────────────────────────────────── */

export const PAGES: CategoryPage[] = [
  /* ── /freelancer-invoice-software — the flagship: the whole audience ─── */
  {
    path: "/freelancer-invoice-software",
    region: "IN",
    metaTitle: "Freelancer Invoice Software for India — Quote, Sign, Get Paid",
    description:
      "For India's freelancers: quotation, e-signed scope, advance & milestone invoices with your PAN/GSTIN, and payment reminders drafted in English or Hinglish — on one thread per client. Free plan; Pro ₹299/month.",
    h1: "Invoice software for Indian freelancers who are tired of chasing payments",
    sub: "For India's freelancers — designers, developers, writers, video editors & photographers, marketers and consultants. Quote the work, get the scope accepted in writing, bill the advance and milestones, and follow up on late payments — one thread per client, ₹299/month.",
    chips: ["Advance + milestone billing", "Signed, timestamped scope", "Reminders in English or Hinglish", "Pro ₹299/month · free plan", "No card needed"],
    shortLabel: "Freelancer Invoice Software",
    sections: `
<section><div class="wrap">
  <h2>Built for people who quote, sign and bill their own clients</h2>
  <p class="sec-sub">No accounts team, no office manager — just you, your laptop and your clients on WhatsApp. DealInSec handles the paperwork and the follow-up so you can get back to the work. Pick yours to see an invoice format made for it.</p>
  <div class="rel-grid">
    <a class="rel-card" href="/tools/invoice-format/for-graphic-designers">Design<span>Logos, brand kits, UI — revision rounds are where the unpaid hours go.</span></a>
    <a class="rel-card" href="/tools/invoice-format/for-web-developers">Development<span>Sites and apps billed in milestones, then "one small change" after launch.</span></a>
    <a class="rel-card" href="/tools/invoice-format/for-content-writers">Writing<span>Per word or per piece — and the draft is usually delivered before you're paid.</span></a>
    <a class="rel-card" href="/tools/invoice-format/for-social-media-managers">Marketing<span>Monthly work, where one unpaid month quietly turns into two.</span></a>
    <a class="rel-card" href="/tools/invoice-format/for-video-editors">Video &amp; Photo<span>Shoot days and edit rounds — and the client already has the files.</span></a>
    <a class="rel-card" href="/tools/invoice-format/for-consultants">Consulting<span>Advice given on a call can't be taken back when the invoice is ignored.</span></a>
  </div>
  <p class="muted" style="font-size:14px;margin-top:12px">More invoice formats: <a href="/tools/invoice-format/for-photographers">photographers</a> · <a href="/tools/invoice-format/for-translators">translators</a> · <a href="/tools/invoice-format/for-voice-over-artists">voice-over artists</a> · <a href="/tools/invoice-format/for-tutors">tutors</a> · <a href="/tools/invoice-format/for-freelancers">any freelancer</a>.</p>
</div></section>
<section><div class="wrap">
  <h2>Late, less, or never: where freelance money goes missing</h2>
  <p class="sec-sub">The work is done. Now the payment is "coming this week" for the third week, the client wants ₹5,000 off because "the last round took long", or the chat has simply gone quiet. Some clients won't pay whatever you do — no software changes that. But a lot of unpaid invoices start on your side of the table: nothing in writing, no advance, an invoice sent a fortnight late, a reminder you felt too awkward to send. That part you can fix.</p>
  <div class="feat">
    <div class="ft"><b>No written scope → a scope the client accepted</b><p>Your quotation lists the deliverables, the revision rounds and what's not included. It becomes an agreement the client accepts electronically — DealInSec records who accepted, when, and with which signature.</p></div>
    <div class="ft"><b>No advance → advance first, then milestones</b><p>Bill 50% before you start, a milestone on the first draft, the balance on delivery — any split. Every invoice is raised from the agreement, and DealInSec won't let you bill more than it's worth.</p></div>
    <div class="ft"><b>Invoice sent late → nothing drops off the list</b><p>The dashboard shows what's ready to invoice, what's due this week and what's overdue — so the invoice goes out the day the milestone is done, not the day you remember.</p></div>
    <div class="ft"><b>Awkward chasing → the reminder, already written</b><p>Pick a tone — Friendly, Professional, Firm, Final reminder or Hinglish — and the Copilot drafts the follow-up with the real invoice number and amount. You send it yourself on WhatsApp or email; it never messages a client on its own.</p></div>
    <div class="ft"><b>Scope creep → caught before you send</b><p>The Protection Check reads your terms and flags unlimited revisions, no revision limit, no advance, nothing excluded and no late-payment terms — with a suggested line to add. Extra work gets its own quotation instead of becoming a free favour.</p></div>
    <div class="ft"><b>Deal agreed on WhatsApp → paste the chat</b><p>Paste the client conversation and the Copilot drafts the deal — client, scope, amount, advance. You check it and confirm; it doesn't invent a number the chat doesn't contain.</p></div>
  </div>
  <div class="callout honest"><b>What DealInSec can't do</b><p>It can't make an unwilling client pay, and it isn't a collection agency. What it gives you is the record: the scope the client accepted, when they accepted it, and every invoice raised against it — timestamped, in one place, ready to show the client, a mediator or a lawyer if it comes to that. For next steps, see the <a href="/blog/client-not-paying">client-not-paying guide</a> and, if you're Udyam-registered, the <a href="/blog/msme-payment-rule-45-days-samadhaan">MSME 45-day payment rule</a>.</p></div>
</div></section>
<section><div class="wrap">
  <h2>Example: a ₹60,000 website, start to finish</h2>
  <p class="sec-sub">An illustrative project — not a real client — showing how one deal runs on one thread. Amounts are before GST.</p>
  <div class="tbl-scroll"><table class="cmp">
    <tr><th>Step</th><th>What happens in DealInSec</th></tr>
    <tr><td><b>Quotation</b></td><td>5-page website, 2 revision rounds, hosting and copywriting excluded. ₹60,000 split 50 / 30 / 20. The Protection Check confirms the advance, revision limit and exclusions are all there.</td></tr>
    <tr><td><b>Agreement</b></td><td>The accepted quotation becomes the agreement, same figures. The client accepts electronically; the record shows who, when and which signature.</td></tr>
    <tr><td><b>Advance invoice</b></td><td>₹30,000 (50%) — work starts when it's paid.</td></tr>
    <tr><td><b>Milestone invoice</b></td><td>₹18,000 (30%) on design approval.</td></tr>
    <tr><td><b>"Can you add a blog too?"</b></td><td>Not in the accepted scope — so it goes out as a separate quotation, not a free favour.</td></tr>
    <tr><td><b>Balance invoice</b></td><td>₹12,000 (20%) on launch. The three invoices can't add up to more than ₹60,000.</td></tr>
    <tr><td><b>The balance is late</b></td><td>It shows as overdue on the dashboard. The Copilot drafts a Hinglish nudge — something like "Hi Rohan, ek gentle reminder — invoice INV-2627-0014 for ₹12,000 was due on the 5th. Payment kab tak ho payega?" — and you send it.</td></tr>
  </table></div>
</div></section>
<section><div class="wrap">
  <h2>Why an invoice generator alone isn't enough</h2>
  <div class="tbl-scroll"><table class="cmp">
    <tr><th></th><th>Invoice generator + WhatsApp</th><th>DealInSec</th></tr>
    <tr><td><b>The offer</b></td><td>A quote retyped every time</td><td>Quotation generated from the deal, carried into the invoice</td></tr>
    <tr><td><b>The scope</b></td><td>Agreed in chat, argued about later</td><td>Accepted electronically, with revision limits &amp; exclusions</td></tr>
    <tr><td><b>Your details</b></td><td>PAN and GSTIN typed in again</td><td>PAN and GSTIN from your profile on every document (in-app invoices are not GST tax invoices)</td></tr>
    <tr><td><b>Getting paid</b></td><td>You remember, then chase awkwardly</td><td>Overdue list, plus a drafted reminder in the tone you pick</td></tr>
    <tr><td><b>Cost</b></td><td>—</td><td>Free plan for quotations; Pro ₹299/month</td></tr>
  </table></div>
  <div class="callout honest"><b>What it costs, plainly</b><p>Free is ₹0, and it covers the whole job: deals, quotations, e-signed agreements, invoices and payment tracking, with no monthly cap. Pro is ₹299/month, paid once a month with no auto-renewal, and adds a larger Client Radar research allowance, more AI outreach drafts and team members. The free plan needs no card. DealInSec takes no percentage of your project value. Just need one invoice today? The <a href="/tools/gst-invoice-generator">free GST invoice generator</a> and <a href="/tools/quotation-maker">quotation maker</a> need no sign-up.</p></div>
  <p class="muted" style="font-size:14px;margin-top:10px">Guides: <a href="/blog/advance-payment-terms">advance payment terms</a> · <a href="/blog/payment-reminder-message-to-client">payment reminder messages</a> · <a href="/blog/how-to-make-a-quotation-online">making a quotation online</a>.</p>
</div></section>`,
    faq: [
      {
        q: "Who is DealInSec for?",
        a: "India's freelancers — designers, developers, writers, video editors & photographers, marketers and consultants. If you're a solo professional who quotes, signs and bills your own clients, it's built for you. If you sell stock from a shop, a billing-and-inventory tool will suit you better.",
      },
      {
        q: "Can DealInSec guarantee that my client pays?",
        a: "No — no software can make an unwilling client pay, and we won't pretend otherwise. DealInSec prevents the payment problems that come from disorganisation: no written scope, no advance, invoices sent late or never, reminders you keep putting off. If a client disputes the work, you have the accepted scope and the invoice trail, timestamped, to point to.",
      },
      {
        q: "How much does it cost?",
        a: "Free is ₹0 and covers deals, quotations, e-signed agreements, invoices and payment tracking, with no monthly cap. Pro is ₹299/month and adds a larger Client Radar research allowance, more AI outreach drafts and team members. The free plan needs no card, and DealInSec takes no percentage of your project value.",
      },
      {
        q: "Can I take an advance and bill in milestones?",
        a: "Yes. Bill an advance before you start, milestone invoices as you deliver, and the balance at the end — any split. Each invoice is raised from the accepted agreement, and DealInSec won't let the total exceed what the client agreed to pay.",
      },
      {
        q: "Can it write payment reminders in Hinglish?",
        a: "Yes. Choose Friendly, Professional, Firm, Final reminder or Hinglish, and the Copilot drafts a short follow-up using the real invoice number and amount. You review it and send it yourself on WhatsApp or email — it never messages your client on its own.",
      },
      {
        q: "Are the invoices GST-ready?",
        a: "In-app invoices print your PAN and GSTIN and record the agreed amount, but they are not Rule-46 GST tax invoices. If you're GST-registered and need CGST/SGST/IGST computed, use the free GST invoice generator — no sign-up.",
      },
      {
        q: "Is my client's electronic acceptance valid?",
        a: "Electronic contracts are recognised in India under Section 10A of the IT Act, 2000. DealInSec records electronic acceptance with an audit trail — who accepted, when, with which signature. It is not a Digital Signature Certificate or Aadhaar eSign, and every agreement says so. This is general information, not legal advice; have important agreements reviewed by a lawyer.",
      },
    ],
  },

  /* ── /refrens-alternative — buying-intent comparison ─────────────────── */
  {
    path: "/refrens-alternative",
    region: "IN",
    metaTitle: "Refrens Alternative for Freelancers in India",
    description:
      "A Refrens alternative for Indian freelancers who want the whole client deal on one thread: quotation → e-signed scope → advance & milestone invoices → payment follow-up. Honest comparison. Pro ₹299/month; free plan, no card.",
    h1: "Looking for a Refrens alternative?",
    sub: "Refrens is a solid invoicing and quotation platform. DealInSec is built for a different job — running each client deal a freelancer takes on, from quotation to accepted scope to milestone invoices to getting paid, on one thread.",
    chips: ["Built for freelancers", "Quote → signed scope → invoice", "Pro ₹299/month", "Free plan · no card"],
    shortLabel: "Refrens Alternative",
    sections: `
<section><div class="wrap">
  <h2>When Refrens fits — and when DealInSec does</h2>
  <p class="sec-sub">This is an honest comparison, not a takedown. Both are made in India and priced in rupees; they're built for different jobs, and the right pick depends on how your freelance work runs.</p>
  <div class="feat">
    <div class="ft"><b>Refrens is great when…</b><p>your main need is invoicing and quotations — a broad billing and accounting toolkit with a strong free tier, for when you mostly need documents out fast.</p></div>
    <div class="ft"><b>DealInSec is built when…</b><p>your work is deal-shaped: you quote, get the scope accepted, deliver in stages and chase payment. The quotation, agreement and invoices live on one record and can't drift apart.</p></div>
    <div class="ft"><b>The difference in one line</b><p>Refrens documents your billing; DealInSec runs the deal around it — e-signed agreements, scope-creep checks, and payment follow-up built into the same thread.</p></div>
    <div class="ft"><b>Where DealInSec is sharpest</b><p>Freelance projects with an advance, milestones and a revision limit — a website build, a brand identity, a batch of articles, a video edit — where one forgotten invoice or unsigned scope costs you real money.</p></div>
  </div>
</div></section>
<section><div class="wrap">
  <h2>Side by side</h2>
  <div class="tbl-scroll"><table class="cmp">
    <tr><th></th><th>Refrens</th><th>DealInSec</th></tr>
    <tr><td><b>Core job</b></td><td>Invoicing, quotations &amp; accounting</td><td>Running each client deal through to payment</td></tr>
    <tr><td><b>Quotation</b></td><td>Yes</td><td>Yes — and it converts into the agreement &amp; invoice</td></tr>
    <tr><td><b>E-signed agreements</b></td><td>Focused on billing docs</td><td>Built in — acceptance recorded with an audit trail</td></tr>
    <tr><td><b>Scope-creep protection</b></td><td>—</td><td>Protection Check flags missing revision limits, exclusions, advance</td></tr>
    <tr><td><b>Payment chasing</b></td><td>Reminders</td><td>AI-drafted follow-ups (English or Hinglish), you send</td></tr>
    <tr><td><b>Pricing</b></td><td>See their site</td><td>Free plan; Pro ₹299/month</td></tr>
    <tr><td><b>Best for</b></td><td>Fast, broad invoicing &amp; accounting</td><td>Freelancers who want the scope signed and the payment followed up</td></tr>
  </table></div>
  <p class="muted" style="font-size:14px;margin-top:10px">Refrens is a capable product — check their site for current features and pricing. Pick the tool that matches how your work actually runs.</p>
</div></section>`,
    faq: [
      {
        q: "Is DealInSec a free Refrens alternative?",
        a: "DealInSec has a free plan with no card that covers the whole job — deals, quotations, agreements, invoices and payment tracking, with no monthly cap — plus free no-sign-up tools (GST invoice, quotation maker, bill maker). Pro, at ₹299/month, buys more AI client research, not the paperwork. It isn't a clone of Refrens, though — it's built to run the whole deal, not just billing, so compare on the job you need done.",
      },
      {
        q: "Why would a freelancer choose DealInSec over Refrens?",
        a: "Choose DealInSec if your work is deal-shaped — you quote, get the scope accepted, deliver in stages and chase payment — and you want those documents on one consistent thread with e-signed agreements and scope-creep checks. Choose Refrens if your main need is fast, broad invoicing and accounting. They're built for different jobs.",
      },
      {
        q: "Can I switch from Refrens to DealInSec?",
        a: "Yes — start on the free plan and run one live client deal end to end (quotation → agreement → invoice) to see if the thread fits how you work. Keep using whatever handles the rest of your accounting.",
      },
    ],
  },

  /* ── /vyapar-alternative — buying-intent comparison ──────────────────── */
  {
    path: "/vyapar-alternative",
    region: "IN",
    metaTitle: "Vyapar Alternative for Freelancers (India)",
    description:
      "A Vyapar alternative for freelancers, not shops: DealInSec runs client deals — quotation, e-signed scope, milestone invoices and payment follow-up — instead of inventory-based GST billing. Honest comparison. Pro ₹299/month; free plan, no card.",
    h1: "Looking for a Vyapar alternative?",
    sub: "Vyapar is excellent GST billing and inventory software for shops and product businesses. If you're a freelancer — you sell design, code, words, edits or advice, not stock — DealInSec is built for the way you actually get paid.",
    chips: ["For freelancers, not shops", "Quote → signed scope → invoice", "Pro ₹299/month", "Free plan · no card"],
    shortLabel: "Vyapar Alternative",
    sections: `
<section><div class="wrap">
  <h2>Different tools for different work</h2>
  <p class="sec-sub">Honestly, if you run a shop with stock, Vyapar is a strong choice — inventory, GST billing and accounting in one. DealInSec is for the other kind of work: a freelancer selling scoped services, one client deal at a time.</p>
  <div class="feat">
    <div class="ft"><b>Vyapar is great when…</b><p>you sell products and need inventory, GST billing, stock and day-to-day accounting — the shape of a retail or trading business.</p></div>
    <div class="ft"><b>DealInSec is built when…</b><p>you're a freelancer selling scoped work — a logo, a website, a video edit, a consulting engagement — where the scope, the client's acceptance and the payment matter more than stock.</p></div>
    <div class="ft"><b>No inventory, just deals</b><p>Instead of products and stock levels, DealInSec tracks quotations, e-signed agreements, milestone invoices and who owes you what.</p></div>
    <div class="ft"><b>Protection built in</b><p>Scope-creep checks and payment follow-up are part of the workflow — the risks a freelancer carries, not a shop.</p></div>
  </div>
</div></section>
<section><div class="wrap">
  <h2>Side by side</h2>
  <div class="tbl-scroll"><table class="cmp">
    <tr><th></th><th>Vyapar</th><th>DealInSec</th></tr>
    <tr><td><b>Built for</b></td><td>Shops &amp; product/trading businesses</td><td>Freelancers selling services</td></tr>
    <tr><td><b>Inventory / stock</b></td><td>Yes — a core strength</td><td>Not applicable — deals, not stock</td></tr>
    <tr><td><b>GST tax invoices</b></td><td>Yes</td><td>Free GST invoice tool; in-app invoices record the deal value (not Rule-46 tax invoices)</td></tr>
    <tr><td><b>Quotation → agreement → invoice</b></td><td>Billing-centric</td><td>One connected thread with e-signed agreements</td></tr>
    <tr><td><b>Scope creep &amp; payment chasing</b></td><td>—</td><td>Protection Check + AI-drafted payment reminders</td></tr>
    <tr><td><b>Pricing</b></td><td>See their site</td><td>Free plan; Pro ₹299/month</td></tr>
  </table></div>
  <p class="muted" style="font-size:14px;margin-top:10px">Vyapar is a strong product for what it's built for — check their site for current features. The question is whether you sell stock or sell your work.</p>
</div></section>`,
    faq: [
      {
        q: "Is DealInSec like Vyapar?",
        a: "No — and that's the point. Vyapar is GST billing and inventory software for shops and product businesses. DealInSec runs client deals for freelancers: quotation, e-signed agreement, milestone invoices and payment tracking. If you sell services, not stock, DealInSec fits better.",
      },
      {
        q: "Does DealInSec do GST invoices like Vyapar?",
        a: "For a GST tax invoice with CGST/SGST/IGST computed, use DealInSec's free GST invoice generator (no sign-up). In-app invoices record the agreed deal value and print your PAN/GSTIN but are not Rule-46 tax invoices. Vyapar is the stronger pick if full GST-and-inventory accounting is your main need.",
      },
      {
        q: "I'm a freelancer, not a shop — which fits?",
        a: "DealInSec. Freelance work is about scope, the client's acceptance and getting paid per milestone — not inventory. That's exactly what DealInSec is built for: a free plan for quotations with no card, and Pro at ₹299/month.",
      },
    ],
  },

  /* ── /quotation-software ─────────────────────────────────────────────── */
  {
    path: "/quotation-software",
    region: "IN",
    metaTitle: "Quotation Software for Freelancers in India",
    description:
      "Quotation software for Indian freelancers: itemised quotations with revision rounds and advance terms, a link your client can accept online, and the agreement and invoice from the same deal. Free plan; Pro ₹299/month.",
    h1: "Send clear quotations that help you win work",
    sub: "Make professional, numbered quotations for your clients in minutes and share a link they can open and accept online. When they say yes, create the agreement and the invoice from the same deal, with the same figures.",
    chips: ["Made for freelancers", "Accepted online", "Free plan · no monthly cap", "Pro ₹299/month"],
    shortLabel: "Quotation Software",
    sections: `
<section><div class="wrap">
  <h2>Why quotations made in Excel, Word or a WhatsApp message go wrong</h2>
  <p class="sec-sub">The quotation itself is easy. What breaks is everything after it: the client negotiates on a call, the discount never gets written down, the agreement says one number and the invoice another — and when payment is late, nobody can find the version the client actually accepted.</p>
  <div class="feat">
    <div class="ft"><b>Itemised, numbered, consistent</b><p>Quotations are generated from the deal record — deliverables, quantities, rates, terms — with a stable QT-series number and a clean PDF that carries your name, not ours.</p></div>
    <div class="ft"><b>Revisions with history</b><p>Client negotiated? Issue a revised version. The version the client accepted is the one your agreement and invoice inherit.</p></div>
    <div class="ft"><b>Terms that carry forward</b><p>Advance percentage, balance timeline, revision rounds, validity — set once on the deal, printed on the quotation, carried into the agreement so the documents never contradict each other.</p></div>
    <div class="ft"><b>Quotation tracking</b><p>See which shared quotations your client hasn't accepted yet, right on the dashboard, so you know whom to follow up with.</p></div>
  </div>
  <div class="callout honest"><b>Just need one quotation right now?</b><p>Use the <a href="/tools/quotation-maker">free online quotation maker</a> — no sign-up, GST-ready, instant PDF. The software is for when you're quoting new clients every month, not once a year.</p></div>
</div></section>
<section><div class="wrap">
  <h2>Quotation software vs Excel</h2>
  <div class="tbl-scroll"><table class="cmp">
    <tr><th></th><th>Excel / Word</th><th>DealInSec</th></tr>
    <tr><td><b>Totals</b></td><td>Manual — the classic source of embarrassing errors</td><td>Computed, with Indian formatting (₹1,35,000)</td></tr>
    <tr><td><b>Numbering</b></td><td>Whatever you remember to type</td><td>Stable series, per record</td></tr>
    <tr><td><b>After acceptance</b></td><td>Retype everything into a contract, then again into an invoice</td><td>One click — agreement and invoice inherit the figures</td></tr>
    <tr><td><b>Follow-up</b></td><td>Memory</td><td>Dashboard shows outstanding and expiring quotations</td></tr>
  </table></div>
  <p class="muted" style="font-size:14px;margin-top:10px">More on this in the guides: <a href="/blog/quotation-format">the quotation format</a> · <a href="/blog/how-to-make-a-quotation-online">making a quotation online</a>.</p>
</div></section>`,
    faq: [
      {
        q: "What is quotation software?",
        a: "Quotation software creates professional, itemised price quotations — your details, line items, taxes, terms and a numbered PDF — and tracks what happens to them. Quotation management software also handles the follow-through: revisions, acceptance, and converting the quote into an agreement and invoice, which is what DealInSec does.",
      },
      {
        q: "Is there a free version?",
        a: "Two, honestly: the free quotation maker tool needs no account at all, and every new DealInSec account starts on a free plan (no card) covering deals and their quotations with no monthly cap.",
      },
      {
        q: "Does it handle GST on quotations?",
        a: "Quotations print your GSTIN and say the amounts are subject to applicable taxes, but DealInSec doesn't calculate GST on quotations or in-app invoices. A quotation isn't a tax document; if you're GST-registered and need CGST/SGST/IGST computed on an invoice, use the free GST invoice generator.",
      },
      {
        q: "Is it built for freelancers in India?",
        a: "Yes — it's made for India's freelancers: designers, developers, writers, video editors & photographers, marketers and consultants. Indian number formatting, your PAN and GSTIN on your documents, and pricing in rupees: a free plan, then Pro at ₹299/month.",
      },
      {
        q: "What should a freelancer's quotation include?",
        a: "What you'll deliver, as specific line items; how many revision rounds are included; what's not included; the price, with GST if you're registered; the advance and when the balance is due; and how long the quote is valid. DealInSec's Protection Check flags the missing ones before you send.",
      },
    ],
  },

  /* ── /contract-management ────────────────────────────────────────────── */
  {
    path: "/contract-management",
    region: "IN",
    metaTitle: "Contract Management Software for Freelancers in India",
    description:
      "Contract management for Indian freelancers: agreements generated from accepted quotations, electronic acceptance with an audit record, statuses, and linked invoices. Pro ₹299/month; free plan, no card.",
    h1: "Contract management software for freelancers",
    sub: "Your agreement is generated from the accepted quotation — same scope, same figures — accepted electronically by your client with an audit record, and linked to the invoices it authorises.",
    chips: ["Electronic acceptance + audit record", "Made for freelancers", "Free plan · no card"],
    shortLabel: "Contract Management",
    sections: `
<section><div class="wrap">
  <h2>Contracts that match the deal they came from</h2>
  <p class="sec-sub">The most common contract problem for a freelancer isn't a missing clause — it's having no contract at all, just a scope agreed over WhatsApp. The next most common is an agreement whose numbers quietly disagree with the quotation, or that lives in an email attachment nobody can find when the dispute starts.</p>
  <div class="feat">
    <div class="ft"><b>Generated, not retyped</b><p>The agreement inherits the accepted quotation's scope, deliverables, value and payment terms — and cross-references the quotation number on its face.</p></div>
    <div class="ft"><b>Electronic acceptance, recorded</b><p>Who accepted, when, and with which signature — an execution record printed on the agreement itself. Your client accepts electronically; a signed copy stays on record.</p></div>
    <div class="ft"><b>Status you can see</b><p>Draft, pending, signed — with start and end dates, exclusivity, and the linked invoices, on one screen per client deal.</p></div>
    <div class="ft"><b>Invoices bounded by the contract</b><p>Bill an advance, a balance, or milestones — DealInSec will not let invoices exceed the agreement's value.</p></div>
  </div>
  <div class="callout honest"><b>Honest legal note</b><p>Electronic contracts are recognised in India under Section 10A of the Information Technology Act, 2000. DealInSec records electronic acceptance with an audit record — it is not a Digital Signature Certificate or an Aadhaar eSign, and every agreement says so on its face. For important agreements, have a lawyer review the terms. There's a free <a href="/tools/service-agreement-template">service agreement template</a> if you just need a document today.</p></div>
</div></section>`,
    faq: [
      {
        q: "What is contract management software?",
        a: "Software that creates, tracks and stores your client agreements: generating the contract from agreed terms, recording acceptance, tracking status and dates, and linking the contract to the invoices it authorises. DealInSec does this as part of one deal thread — quotation to agreement to invoice.",
      },
      {
        q: "Are the agreements valid in India?",
        a: "Electronic contracts are recognised in India under Section 10A of the Information Technology Act, 2000. DealInSec records electronic acceptance with an audit record naming who accepted, when, and with which signature. It is not a Digital Signature Certificate or Aadhaar eSign, and agreements state this on their face. We are not a law firm — have important agreements reviewed by a lawyer.",
      },
      {
        q: "Does it work for freelance contracts?",
        a: "That's exactly what it's built for — scoped freelance work with deliverables, a value, a duration and a payment split: a logo and brand kit, a website build, a batch of articles, a video edit, a month of social media, a consulting engagement.",
      },
      {
        q: "What does it cost?",
        a: "Agreements are free, on every plan, along with deals, quotations, invoices and payment tracking, with no monthly cap and no card. Pro, at ₹299/month, adds a larger Client Radar research allowance, more AI outreach drafts and team members.",
      },
      {
        q: "Can my client sign without creating an account?",
        a: "Your client accepts the agreement electronically through a confirmation flow — the execution record then names both parties, and the signed copy stays on the deal thread.",
      },
    ],
  },

  /* ── /proposal-management ────────────────────────────────────────────── */
  {
    path: "/proposal-management",
    region: "IN",
    metaTitle: "Proposal Management Software for Freelancers",
    description:
      "Proposal management for Indian freelancers: itemised, priced proposals (quotations) with revision rounds and advance terms, tracked to acceptance and converted into e-signed agreements and invoices. Free plan, no card.",
    h1: "Proposal management, the quotation-first way",
    sub: "For a freelancer, your proposal is a priced scope with terms — a quotation. DealInSec manages that proposal from first draft to accepted, signed and invoiced.",
    chips: ["Priced proposals with terms", "Tracked to acceptance", "Free plan · no card"],
    shortLabel: "Proposal Management",
    sections: `
<section><div class="wrap">
  <h2>What a proposal needs to actually close</h2>
  <p class="sec-sub">Decks look nice, but clients decide on three things: what exactly you'll deliver, what it costs, and on what terms. DealInSec's proposals are built from those three — an itemised scope, transparent pricing, and payment terms the client can accept on the spot.</p>
  <div class="feat">
    <div class="ft"><b>Scope as line items</b><p>Deliverables with quantities, frequencies and notes — specific rows justify your fee and prevent "that was included, right?" disputes later.</p></div>
    <div class="ft"><b>Terms up front</b><p>Validity, advance percentage, revision rounds — on the proposal itself, so acceptance means accepting the terms, not just the price.</p></div>
    <div class="ft"><b>Versions, tracked</b><p>Negotiations produce revised versions with history — the accepted version is the one that becomes the agreement.</p></div>
    <div class="ft"><b>Acceptance → agreement → invoice</b><p>The moment a proposal is accepted it can become an e-signed agreement and then invoices, with no retyping and no drift.</p></div>
  </div>
  <div class="callout honest"><b>Proposal vs quotation — same document, different word</b><p>For scoped freelance work, a proposal and a quotation are functionally the same artifact: a priced offer with terms. If a client says "send a proposal", send them a DealInSec quotation with well-written deliverables — it reads as one. See the <a href="/blog/quotation-format">format guide</a>.</p></div>
</div></section>`,
    faq: [
      {
        q: "What is proposal management software?",
        a: "Software that creates, sends, tracks and closes client proposals. For a freelancer the proposal is a priced scope with terms — DealInSec builds it as a quotation, tracks revisions and acceptance, and converts the accepted proposal into an e-signed agreement and invoices.",
      },
      {
        q: "How is a proposal different from a quotation?",
        a: "In scoped freelance work, barely at all — both are a priced offer with terms. 'Proposal' tends to be used when there's more narrative around the scope; 'quotation' when the line items dominate. DealInSec's document carries both: itemised deliverables plus notes and terms.",
      },
      {
        q: "Can I track whether the client accepted?",
        a: "Yes — quotation status is tracked on the deal and the dashboard shows outstanding and expiring proposals, so follow-up happens before validity runs out.",
      },
      {
        q: "What happens after acceptance?",
        a: "On every plan, free: the accepted proposal becomes an agreement with the same figures, accepted electronically with an audit record, and then invoices — an advance/balance split or milestones — bounded by the agreement's value. Pro (₹299/month) only adds more AI client research and drafts.",
      },
    ],
  },

  /* ── /invoice-management ─────────────────────────────────────────────── */
  {
    path: "/invoice-management",
    region: "IN",
    metaTitle: "Invoice Management Software for Freelancers in India",
    description:
      "Invoice management for Indian freelancers: invoices generated from agreements, consecutive numbering per financial year, paid/unpaid tracking with dates, and a dashboard of what to bill and chase. Pro ₹299/month; free plan.",
    h1: "Create invoices. Track payments. Follow up professionally.",
    sub: "Invoices generated from the agreement — never more than it's worth — numbered consecutively per financial year, tracked from sent to paid, with a dashboard of what to bill and what to chase today.",
    chips: ["INV-series per financial year", "Paid/unpaid with dates", "Made for freelancers", "Free plan"],
    shortLabel: "Invoice Management",
    sections: `
<section><div class="wrap">
  <h2>The invoice is easy. Keeping track of invoices is the job.</h2>
  <p class="sec-sub">Any tool can print an invoice. Freelance money is lost in the tracking: invoices that never got raised after the client said yes, sent invoices nobody followed up, and totals that quietly exceeded what was agreed.</p>
  <div class="feat">
    <div class="ft"><b>Raised from the agreement</b><p>Advance and balance at any split, or milestone invoices — each cross-referencing the agreement, and the total can never exceed the agreement's value.</p></div>
    <div class="ft"><b>Consecutive numbering</b><p>Per financial year (INV-2627-0001…), automatic — the numbering discipline your CA expects at filing time.</p></div>
    <div class="ft"><b>Paid / unpaid, with dates</b><p>Mark an invoice paid when the UPI or bank transfer lands and the document records the settlement date — a paid invoice prints PAID with the date it was settled.</p></div>
    <div class="ft"><b>The collectible dashboard</b><p>Overdue, due this week, and ready to invoice — the three lists that decide this month's income, on one screen.</p></div>
  </div>
  <div class="callout honest"><b>Honest GST note</b><p>Invoices inside DealInSec record the agreed value and print your PAN and GSTIN, but they do not carry a GST tax computation and are not tax invoices under Rule 46 of the CGST Rules. For a GST invoice with CGST/SGST/IGST computed, use the <a href="/tools/gst-invoice-generator">free GST invoice generator</a> — no sign-up needed. Not sure what to put on yours? See the <a href="/tools/invoice-format/for-freelancers">invoice format for freelancers</a>.</p></div>
</div></section>`,
    faq: [
      {
        q: "What is invoice management software?",
        a: "Software that handles the lifecycle of invoices, not just their creation: raising them against an agreement, numbering them consistently, tracking sent/paid/overdue status, and showing what's collectible. DealInSec does this on the same thread as the quotation and agreement the invoice came from.",
      },
      {
        q: "Does it create GST tax invoices?",
        a: "The free GST invoice generator at dealinsec.com/tools/gst-invoice-generator creates a GST invoice with CGST, SGST and IGST computed, with no sign-up. Invoices inside the app record the agreed value and print your PAN and GSTIN, but they are not tax invoices under Rule 46 of the CGST Rules — we say this plainly rather than let you assume otherwise.",
      },
      {
        q: "Can I bill 50% advance and 50% on delivery?",
        a: "Yes — any split, or separate milestone invoices. DealInSec will not let you invoice more than the agreement is worth.",
      },
      {
        q: "Is there a free plan?",
        a: "The free plan covers deals, quotations, invoices, agreements and payment tracking, with no monthly cap and no card, so you can run real client work before deciding. Pro, at ₹299/month, adds a larger Client Radar research allowance, more AI outreach drafts and team members.",
      },
      {
        q: "What do I do when a client hasn't paid?",
        a: "The dashboard lists overdue invoices, and the Copilot drafts a reminder in the tone you choose — Friendly, Professional, Firm, Final reminder or Hinglish — with the real invoice number and amount; you send it. DealInSec can't force a client to pay, but you'll have the accepted agreement and invoice trail on record if it becomes a dispute.",
      },
    ],
  },

  /* ── /e-signature ────────────────────────────────────────────────────── */
  {
    path: "/e-signature",
    region: "IN",
    metaTitle: "E-Signature for Freelancers in India",
    description:
      "E-signature for Indian freelancers: your client accepts the agreement electronically with an audit record — who signed, when, with which signature — built into the quotation-to-invoice workflow. Honest about what it is. Pro ₹299/month; free plan.",
    h1: "E-signature built into the deal, not bolted on",
    sub: "Your client accepts the agreement electronically with an audit record — who, when, which signature — and the signed document links straight to the quotation before it and the invoices after it.",
    chips: ["Audit record on the document", "Section 10A, IT Act 2000", "Free plan · no card"],
    shortLabel: "E-Signature",
    sections: `
<section><div class="wrap">
  <h2>Signature tools sign documents. This one closes deals.</h2>
  <p class="sec-sub">Standalone e-sign tools give you a signed PDF — and then the signed scope still has to be retyped into an invoice. In DealInSec, signing is one step on a thread: the accepted quotation became this agreement, and the signed agreement authorises the invoices.</p>
  <div class="feat">
    <div class="ft"><b>Execution record on the face</b><p>The agreement prints who accepted it, when, and with which signature — plus your signature image and stamp where you've set them.</p></div>
    <div class="ft"><b>Client-friendly</b><p>Your client accepts electronically through a confirmation flow — the signed copy stays on record, and the printed document reflects the acceptance.</p></div>
    <div class="ft"><b>Signature binding</b><p>The signature captured at creation stays with the document — it doesn't change when someone else views or reprints it.</p></div>
    <div class="ft"><b>Priced for a freelancer</b><p>E-sign is free on every plan, with no per-envelope bill in dollars; Pro (₹299/month) buys more AI client research, not signing.</p></div>
  </div>
  <div class="callout honest"><b>What this is — and isn't</b><p>Electronic contracts are recognised in India under Section 10A of the Information Technology Act, 2000, and DealInSec records electronic acceptance with an audit record. It is <b>not</b> a Digital Signature Certificate (DSC) or an Aadhaar eSign, and every agreement says so on its face. If a client or regulator specifically requires DSC/Aadhaar eSign, use those; for an everyday freelance scope, an accepted document with a clear audit record is the practical option. We are not a law firm — have important agreements reviewed by a lawyer.</p></div>
</div></section>`,
    faq: [
      {
        q: "Are electronic signatures valid in India?",
        a: "Electronic contracts are recognised in India under Section 10A of the Information Technology Act, 2000. DealInSec records electronic acceptance with an audit record — who accepted, when, and with which signature. It is not a Digital Signature Certificate or an Aadhaar eSign, and every agreement states this on its face. This is general information, not legal advice.",
      },
      {
        q: "How is this different from DocuSign-style tools?",
        a: "Standalone tools sign a document you made elsewhere. DealInSec's e-signature is one step in a deal thread: the agreement was generated from your accepted quotation, and once signed it authorises the invoices — same figures throughout, nothing retyped. It's also priced for Indian freelancers rather than per-envelope in dollars.",
      },
      {
        q: "Does my client need an account to sign?",
        a: "Your client accepts the agreement electronically through a confirmation flow; the execution record names both parties and the signed copy stays on the deal thread.",
      },
      {
        q: "What does it cost?",
        a: "E-signed agreements are free, on every plan, with no monthly cap and no card — along with deals, quotations, invoices and payment tracking. Pro, at ₹299/month, buys more AI client research.",
      },
    ],
  },
  /* ── /find-local-clients — local businesses in an Indian city (Client Radar, Google Maps listings) ── */
  {
    path: "/find-local-clients",
    region: "IN",
    updated: "2026-10-18",
    metaTitle: "Find Local Business Clients in Your City for Your Agency",
    description:
      "List local businesses in any Indian city from Google Maps, research the websites that fit, and turn the right ones into leads, deals and paid invoices.",
    h1: "Find local business clients in your city",
    sub: "Type a kind of business and a city — dentists in Siliguri, coaching institutes in Kota, cafes in Pune — and DealInSec lists matching businesses from Google Maps. Research the websites that fit, save the right ones as leads and run each deal through to a paid invoice.",
    chips: ["Any Indian city, or anywhere else", "Listings from Google Maps", "Websites researched with sources", "You approve every message", "Free plan, no card"],
    shortLabel: "Find Local Clients",
    sections: `
<section><div class="wrap">
  <h2>Why local businesses are hard to find with a web search</h2>
  <p class="sec-sub">For a web design, digital marketing or software agency in India, many good clients are down the road: clinics, coaching centres, restaurants, showrooms, builders, salons and family firms. Many of them are on Google Maps but say little anywhere else online, so a general web search lists directories and big brands instead of them.</p>
  <div class="feat">
    <div class="ft"><b>They are on the map</b><p>A clinic or a coaching centre usually keeps its Google Maps listing up to date long before it has much of a website, so a city's listings are where they show up first.</p></div>
    <div class="ft"><b>The website says what they need</b><p>Whether a business already has a website, and what it says, tells you more about how to approach them than any list of names.</p></div>
    <div class="ft"><b>Your city, or someone else's</b><p>Search your own city for clients you can meet, or another city or country where you want to grow. You choose where; it is never set from your own account.</p></div>
  </div>
</div></section>
<section><div class="wrap">
  <h2>How it works</h2>
  <p class="sec-sub">Local search sits inside Client Radar, next to the search for companies online. Nothing is contacted at any step until you send a message yourself.</p>
  <div class="feat">
    <div class="ft"><b>1. Search a city</b><p>Choose Local businesses, type the kind of business and the city, and pick listings with a website, without one, or both. One local search uses one Client Radar search and shows up to 20 businesses.</p></div>
    <div class="ft"><b>2. Look through the listings</b><p>Each business shows its address, phone, website if one is listed and a link to open it in Google Maps, with businesses already in your leads marked.</p></div>
    <div class="ft"><b>3. Research the websites you pick</b><p>Tick the businesses worth a closer look. DealInSec reads each website itself, checks it against your search and records what it finds with the page it came from and the date.</p></div>
    <div class="ft"><b>4. Save the right ones as leads</b><p>A researched business becomes a lead in one step. A business without a website can be saved too, under the name you give it, with a link to its listing.</p></div>
    <div class="ft"><b>5. Reach out yourself</b><p>AI drafts a first message from the facts DealInSec verified. You edit it, approve it and send it from your own email; follow-ups are tasks for you, never automatic.</p></div>
    <div class="ft"><b>6. Quote, sign, invoice, get paid</b><p>When a business says yes, the lead becomes a deal: a quotation they accept online, an agreement they sign online, invoices from that agreement and a clear view of what is paid and overdue.</p></div>
  </div>
</div></section>
<section><div class="wrap">
  <h2>What you see, and what DealInSec keeps</h2>
  <p class="sec-sub">Listings come from Google Maps and are shown for your search only. DealInSec is not a business directory and does not build a database of listings.</p>
  <div class="tbl-scroll"><table class="cmp">
    <tr><th>Information</th><th>What happens to it</th></tr>
    <tr><td><b>Name, address and phone on a listing</b></td><td>Shown for that search, with a link to the listing. Not copied into DealInSec; open the listing for the current details.</td></tr>
    <tr><td><b>A business's own website</b></td><td>Researched only when you choose it. The facts found are kept on the prospect with the page and the date they came from.</td></tr>
    <tr><td><b>A lead you save from a listing</b></td><td>Keeps the name you give it and a link back to the listing.</td></tr>
    <tr><td><b>“No website listed”</b></td><td>Means only that the listing shows none. The business may still have one, and it doesn't mean they need one: check before you pitch.</td></tr>
  </table></div>
  <div class="callout honest"><b>What it doesn't do</b><p>DealInSec doesn't guarantee clients, replies or meetings, and it isn't a contact database: phone numbers and emails are only what a listing or a website publishes, and they aren't verified. It doesn't send messages for you. Searching is limited: the free plan includes ${OB.free.monthlySearches} Client Radar searches every ${OUTBOUND_WINDOW_DAYS} days and Pro (₹${PRICING.proMonthlyInr} a month in India) includes ${OB.pro.monthlySearches}, with researched websites counted separately.</p></div>
</div></section>
<section><div class="wrap">
  <h2>After the first yes</h2>
  <div class="rel-grid">
    <a class="rel-card" href="/quotation-software">Quotation software<span>A quote from the deal that the client accepts online.</span></a>
    <a class="rel-card" href="/e-signature">Agreements signed online<span>The accepted quote becomes the agreement.</span></a>
    <a class="rel-card" href="/freelancer-invoice-software">Invoices and payment tracking<span>Invoices from the agreement; see what is overdue.</span></a>
    <a class="rel-card" href="/tools/gst-invoice-generator">Free GST invoice generator<span>One invoice today, no sign-up.</span></a>
  </div>
  <p class="muted" style="font-size:14px;margin-top:12px">Looking for companies online instead, in India or abroad? Client Radar searches the web for them too; see <a href="/">how DealInSec works</a> and <a href="/for-freelancers">DealInSec for freelancers</a>.</p>
</div></section>`,
    faq: [
      {
        q: "How do I find local clients for my agency with DealInSec?",
        a: "Open Client Radar, choose Local businesses, and type the kind of business and the city, for example dentists in Siliguri. DealInSec lists matching businesses from Google Maps. Pick the ones worth a closer look and DealInSec researches their websites with sources; save the right ones as leads, approve a first message and send it from your own email.",
      },
      {
        q: "Which cities can I search?",
        a: "Any city or area: choose the country and type the place. It works best for the kinds of business people look up on a map, such as clinics, coaching centres, restaurants, salons, showrooms and builders. For companies that work online, such as agencies or software firms, the search for companies online usually finds more.",
      },
      {
        q: "Does DealInSec give me phone numbers and email addresses?",
        a: "A listing shows the phone number and website it publishes, for that search, with a link to the listing. DealInSec doesn't copy them into your leads and doesn't verify them. When it researches a website, it records any contact details the site itself publishes, with the page they came from.",
      },
      {
        q: "Is a business without a website a good lead for a website project?",
        a: "Not necessarily. “No website listed” means only that the listing shows none: the business may have a site the listing doesn't mention, or may not want one. Treat it as a reason to look, not as proof of need.",
      },
      {
        q: "What does local search cost?",
        a: `It is part of Client Radar, with no separate price. One local search uses one Client Radar search: the free plan includes ${OB.free.monthlySearches} every ${OUTBOUND_WINDOW_DAYS} days, and Pro, ₹${PRICING.proMonthlyInr} a month in India, includes ${OB.pro.monthlySearches}. Researching websites uses your plan's researched prospects. The free plan needs no card.`,
      },
    ],
  },
  /* ── /crm-for-freelancers — a simple CRM for Indian freelancers (leads, deals, follow-ups, documents) ── */
  // Every claim is a shipped feature: lead stages, next steps and follow-up dates, facts with sources, the do-not-contact
  // list, a won lead becoming a deal, the dashboard's Today list, quotations accepted online. There is no separate
  // client directory: a client's details live on the lead and the deal, and the page says so.
  {
    path: "/crm-for-freelancers",
    region: "IN",
    updated: "2026-10-19",
    metaTitle: "CRM for Freelancers in India | Manage Clients & Deals",
    description:
      "A simple CRM for Indian freelancers. Manage leads and deals, follow up on time, send quotations and invoice clients from one workspace. Free plan; Pro ₹299/month.",
    h1: "A simple CRM for freelancers in India",
    sub: "Keep every potential client, conversation and deal in one place. Know whom to follow up with today, send a quotation from the deal, and carry the same details through to the agreement and the invoice.",
    chips: ["Leads and deals", "Follow-up dates and next steps", "Quotations accepted online", "Free plan · deals and invoices included", `Pro ₹${PRICING.proMonthlyInr}/month`],
    shortLabel: "CRM for Freelancers",
    sections: `
<section><div class="wrap">
  <h2>Why freelancers lose track of clients</h2>
  <p class="sec-sub">Most freelancers don't need a big sales CRM. They need to remember who asked for a quote, what was promised, when to follow up and what is still unpaid. When that lives across WhatsApp chats, an email inbox and a spreadsheet, good enquiries go cold and invoices wait.</p>
  <div class="feat">
    <div class="ft"><b>Enquiries go cold</b><p>A client asks for a price on Monday; by Friday the conversation is buried under twenty others and nobody followed up.</p></div>
    <div class="ft"><b>Details get re-typed</b><p>The client's name, the scope and the fee are typed again for the quotation, again for the agreement and again for the invoice, and the numbers drift.</p></div>
    <div class="ft"><b>Nobody knows what's next</b><p>Without a next step and a date on each client, the day starts with scrolling instead of working.</p></div>
  </div>
</div></section>
<section><div class="wrap">
  <h2>What the DealInSec CRM does</h2>
  <p class="sec-sub">Built around the way a freelancer actually wins and bills work, from first enquiry to paid invoice.</p>
  <div class="feat">
    <div class="ft"><b>A lead pipeline</b><p>Save each potential client as a lead and move it through stages: new, researching, qualified, contacted, replied, meeting, proposal, then won or lost. Each lead keeps its next step, a follow-up date, notes and the facts you found, with their sources.</p></div>
    <div class="ft"><b>Deals for the work you win</b><p>A won lead becomes a deal in one step. The deal records the client, the engagement model (fixed price, retainer, hourly, milestones and more), the service, the value and the dates. You can also import existing deals from a CSV file.</p></div>
    <div class="ft"><b>What needs you today</b><p>The dashboard lists follow-ups due, quotations your client hasn't accepted yet, agreements waiting for a signature, work ready to invoice and invoices that are overdue, built from your own records.</p></div>
    <div class="ft"><b>Documents from the same deal</b><p>Send a quotation your client can open and accept online, create the agreement your client signs online and the invoices, with the same figures, and record payments as they arrive. All free, on every plan.</p></div>
    <div class="ft"><b>Find new clients</b><p>Client Radar researches companies that fit what you sell, or lists local businesses in a city from Google Maps, with sources for what it finds. The free plan includes ${OB.free.monthlySearches} searches every ${OUTBOUND_WINDOW_DAYS} days.</p></div>
    <div class="ft"><b>Do-not-contact, respected</b><p>Add an email address or a whole domain once and DealInSec won't draft or approve messages to it.</p></div>
  </div>
  <div class="callout honest"><b>What it doesn't do</b><p>There is no separate client directory: a client's details live on their lead and their deals. DealInSec doesn't send emails or WhatsApp messages for you, doesn't schedule meetings, isn't a contact database and doesn't replace your accounting software. Connecting Gmail is in limited early access, so it isn't available to every workspace yet.</p></div>
</div></section>
<section><div class="wrap">
  <h2>Spreadsheet vs DealInSec</h2>
  <div class="tbl-scroll"><table class="cmp">
    <tr><th></th><th>Spreadsheet and chats</th><th>DealInSec</th></tr>
    <tr><td><b>Follow-ups</b></td><td>Whatever you remember</td><td>A follow-up date and next step on every lead, listed when due</td></tr>
    <tr><td><b>Quotation</b></td><td>A separate document, typed again</td><td>Generated from the deal; your client accepts it online</td></tr>
    <tr><td><b>Agreement and invoice</b></td><td>More documents, more re-typing</td><td>From the same deal, with the same figures (Pro)</td></tr>
    <tr><td><b>What's unpaid</b></td><td>Checked in your bank app</td><td>Paid, pending and overdue invoices at a glance (free, every plan)</td></tr>
  </table></div>
</div></section>
<section><div class="wrap">
  <h2>Related</h2>
  <div class="rel-grid">
    <a class="rel-card" href="/quotation-software">Quotation software<span>Clear quotations your client accepts online.</span></a>
    <a class="rel-card" href="/invoice-management">Invoices and payment follow-ups<span>See what is paid, pending and overdue.</span></a>
    <a class="rel-card" href="/find-local-clients">Find local clients<span>Businesses in your city, from Google Maps.</span></a>
    <a class="rel-card" href="/ai-coworkers">AI coworkers<span>Nibo, Mika and Zee help with research and drafts.</span></a>
  </div>
</div></section>`,
    faq: [
      {
        q: "Do freelancers really need a CRM?",
        a: "If you handle more than a few enquiries a month, yes, but a simple one. What matters is knowing who each potential client is, what you quoted, when to follow up and what is unpaid. DealInSec keeps exactly that, and generates the quotation, agreement and invoice from the same deal.",
      },
      {
        q: "Is there a separate list of clients?",
        a: "Not a separate directory. Potential clients are leads, and the people and businesses you work with are recorded on their deals, so their quotations, agreements and invoices stay together.",
      },
      {
        q: "Does DealInSec send follow-up messages for me?",
        a: "No. It reminds you when a follow-up is due and AI can draft the message, but you approve it and send it yourself from your own email or WhatsApp. Nothing is sent automatically.",
      },
      {
        q: "What does it cost?",
        a: `The free plan, with no credit card, includes the lead pipeline, ${OB.free.monthlySearches} Client Radar searches every ${OUTBOUND_WINDOW_DAYS} days, and the whole deal-to-invoice flow — deals, quotations, agreements signed online, invoices and payment tracking — with no monthly cap. Pro is ₹${PRICING.proMonthlyInr} a month in India and raises the AI allowances to ${OB.pro.monthlySearches} searches and ${OB.pro.monthlyDrafts} drafts, with team members included.`,
      },
      {
        q: "Can I bring my existing deals?",
        a: "Yes. Download the CSV template on the import page, fill in your deals and import them; each one goes through the same checks as a deal you create by hand.",
      },
    ],
  },
  /* ── /ai-coworkers — Nibo, Mika and Zee (The Nest, the AI team; code name "league"), for India ───────────────────────────────────────── */
  // Every capability here is what server/ai-league does: Nibo's research always asks first and saves at most
  // LEAGUE_LIMITS.leadsPerRun companies a task; Mika only drafts; Zee's summary is checked against the records; a hand-off
  // always asks; the plan limits come from leagueAllowance(). Nothing here promises clients, replies or accuracy.
  {
    path: "/ai-coworkers",
    region: "IN",
    updated: "2026-10-19",
    metaTitle: "AI Coworkers for Freelancers and Agencies: Nibo, Mika and Zee",
    description:
      "Three AI coworkers inside DealInSec: Nibo researches companies that fit, Mika drafts first messages you approve, Zee briefs you from your own records.",
    h1: "AI coworkers for your business workflow",
    sub: "Meet AI Team, your AI coworkers. Nibo 🔎, the Deal Finder, researches companies that fit what you sell; Mika 💌, the Deal Closer, drafts outreach and follow-ups for you to approve; and Zee 🌱, your Business Buddy, tells you what needs you today, from your own follow-ups and the messages waiting for your approval. They work in the background and ask before anything that spends your allowance or changes something.",
    chips: ["Research with sources", "Drafts only, you send", "Briefings from your records", "Run in the background", "Free plan, no card"],
    shortLabel: "AI Coworkers",
    sections: `
<section><div class="wrap">
  <h2>Three coworkers, three jobs</h2>
  <p class="sec-sub">Each one does real work through the same features you use yourself, as you, with your permissions. Their names and personalities are for you; the rules they follow are the product's.</p>
  <div class="feat">
    <div class="ft"><b>Nibo 🔎, Deal Finder: finds companies that fit</b><p>Describe who you want to work with. Nibo runs an Client Radar search, checks each company's own website, scores it against your ideal client and saves up to ${LEAGUE_LIMITS.leadsPerRun} qualified companies to your leads, each with the evidence and the page it came from. Research always asks before it starts, because it uses one of your searches.</p></div>
    <div class="ft"><b>Mika 💌, Deal Closer: drafts first messages</b><p>For leads you pick, or your newest researched leads, Mika writes a short first email from what was verified about each company. Nothing is sent: you read it, edit it, approve the exact text and send it yourself from your own email. Leads marked do-not-contact are skipped.</p></div>
    <div class="ft"><b>Zee 🌱, Business Buddy: briefs you on what needs you</b><p>Which leads are due a follow-up, which are overdue, and which drafted messages are waiting for your approval, read from your own records. Zee's short summary is checked against those records: one that mentions a figure they don't contain is left out.</p></div>
  </div>
</div></section>
<section><div class="wrap">
  <h2>How they work</h2>
  <div class="feat">
    <div class="ft"><b>Chat, or start a task</b><p>Ask a coworker in its own chat, or start a task from AI Team's page in the app. A task runs on the server, so it keeps going if you close the page, and reports back with what it did and links to the records.</p></div>
    <div class="ft"><b>Approvals stay yours</b><p>Anything that spends your allowance or changes your records waits for your approval, and nothing is sent, paid or signed by a coworker. Handing work from one coworker to another asks you first too.</p></div>
    <div class="ft"><b>They help each other</b><p>A coworker can ask a teammate for a view from the teammate's own records, or call a short team huddle where all three talk a question over and suggest next steps. Talking changes nothing.</p></div>
    <div class="ft"><b>Schedules</b><p>Set a task to run every day, every weekday or every week at a time in your timezone, such as a weekday morning briefing from Zee.</p></div>
  </div>
</div></section>
<section><div class="wrap">
  <h2>What each plan includes</h2>
  <div class="tbl-scroll"><table class="cmp">
    <tr><th></th><th>Free</th><th>Pro (₹${PRICING.proMonthlyInr} a month)</th></tr>
    <tr><td><b>AI outreach drafts every ${OUTBOUND_WINDOW_DAYS} days</b></td><td>${OB.free.monthlyDrafts}</td><td>${OB.pro.monthlyDrafts}</td></tr>
    <tr><td><b>Coworker tasks every ${LEAGUE_WINDOW_DAYS} days</b></td><td>${leagueAllowance("free").monthlyRuns}</td><td>${leagueAllowance("pro").monthlyRuns}</td></tr>
    <tr><td><b>Tasks working at once</b></td><td>${leagueAllowance("free").concurrent}</td><td>${leagueAllowance("pro").concurrent}</td></tr>
    <tr><td><b>Recurring tasks</b></td><td>${leagueAllowance("free").schedules}</td><td>${leagueAllowance("pro").schedules}</td></tr>
  </table></div>
  <div class="callout honest"><b>What they don't do</b><p>They don't guarantee clients, replies or payments, and they don't send messages for you. A task also uses the allowance of the feature it runs: Nibo's research uses Client Radar searches (the free plan includes ${OB.free.monthlySearches} every ${OUTBOUND_WINDOW_DAYS} days, Pro ${OB.pro.monthlySearches}) and Mika's drafts use your plan's AI drafts. AI can be wrong, so every report links to the records and sources it used.</p></div>
</div></section>
<section><div class="wrap">
  <h2>Where the work goes next</h2>
  <div class="rel-grid">
    <a class="rel-card" href="/find-local-clients">Find local clients<span>Businesses in a city from Google Maps, researched with sources.</span></a>
    <a class="rel-card" href="/quotation-software">Quotation software<span>A quote from the deal that the client accepts online.</span></a>
    <a class="rel-card" href="/e-signature">Agreements signed online<span>The accepted quote becomes the agreement.</span></a>
    <a class="rel-card" href="/freelancer-invoice-software">Invoices and payment tracking<span>Invoices from the agreement; see what is overdue.</span></a>
  </div>
</div></section>`,
    faq: [
      {
        q: "What are Nibo, Mika and Zee?",
        a: "Three AI coworkers inside DealInSec. Nibo researches companies that fit what you sell and saves the qualified ones to your leads with evidence, Mika drafts first messages for you to approve and send, and Zee briefs you on what needs you today from your own records.",
      },
      {
        q: "Do they send emails or messages for me?",
        a: "No. Mika writes drafts; you read them, change anything, approve the exact text and send it yourself from your own email. Nothing is sent, paid or signed by a coworker.",
      },
      {
        q: "How do I know Nibo's research is right?",
        a: "Every company Nibo saves comes with the evidence it found and the page it came from, and companies without enough evidence aren't saved as qualified. AI can still be wrong, so check the source before you reach out.",
      },
      {
        q: "Can they work while I'm away?",
        a: "Yes. A task runs on DealInSec's server, so it keeps going if you close the page, and the report appears in the coworker's chat and in your notifications. You can also schedule a task every day, every weekday or every week.",
      },
      {
        q: "What does it cost?",
        a: `The free plan, with no card, includes ${leagueAllowance("free").monthlyRuns} coworker tasks every ${LEAGUE_WINDOW_DAYS} days. Pro, ₹${PRICING.proMonthlyInr} a month in India, includes ${leagueAllowance("pro").monthlyRuns}. Each task also uses the allowance of the feature it runs, such as Client Radar searches for Nibo's research.`,
      },
    ],
  },
  /* ── /for-freelancers — client work, any country ─────────────────────── */
  {
    path: "/for-freelancers",
    region: "global",
    updated: "2026-09-30",
    metaTitle: "Client Deals for Freelancers: Scope, Quote, Agreement, Invoice",
    description:
      "Turn a client's request into a clear scope, a professional quote, a signed agreement and an invoice, then track payment. For freelancers and independent professionals.",
    h1: "Turn client requests into clear scope, signed agreements and paid invoices",
    sub: "Paste what the client asked for, see which terms are missing, send a professional quote, get the agreement signed, invoice the client and track payment — one workflow, for freelancers and independent professionals in any country.",
    chips: ["Scope, revisions and deposits", "Protection Check before you send", "Quote → agreement → invoice", "Free plan in every country", "Not legal advice"],
    shortLabel: "For Freelancers",
    sections: `
<section><div class="wrap">
  <h2>Where client work goes wrong</h2>
  <p class="sec-sub">Most client projects start as a message: “Can you build our website for $1,500? We need it by October 20.” That one sentence doesn't say what the website includes, whether there is a deposit, when the balance is due, how many rounds of changes are included, who owns the finished work or what happens if the client cancels. Each is easy to agree before you start and hard to settle afterwards.</p>
  <div class="feat">
    <div class="ft"><b>The scope is a sentence</b><p>“A website” can mean five pages or fifty. Without a written list of deliverables, whatever the client asks for next can be argued to be part of the price.</p></div>
    <div class="ft"><b>The changes have no limit</b><p>“Just one more small change” is the most expensive sentence in service work. A revision limit written down early turns the extra rounds into a quote instead of a favour.</p></div>
    <div class="ft"><b>The payment has no date</b><p>“We'll pay after launch” can quietly become “whenever”. A deposit and a due date for the balance are what keep a finished project from waiting on someone else's cash flow.</p></div>
    <div class="ft"><b>The record is a chat</b><p>When the terms live in a message thread, the invoice, the quote and the agreement can each say something slightly different, and nobody can point to the version everyone accepted.</p></div>
  </div>
</div></section>
<section><div class="wrap">
  <h2>How a client deal runs in DealInSec</h2>
  <p class="sec-sub">The same deal carries through every step, so the quote, the agreement and the invoice never disagree.</p>
  <div class="feat">
    <div class="ft"><b>1. Deal</b><p>Paste the client's message or fill in the form: client, project, deliverables, deadline, fee, deposit and revisions. The AI reading shows anything the message doesn't say as “Not specified” and never invents it. Nothing is created until you confirm.</p></div>
    <div class="ft"><b>2. Protection Check</b><p>The terms are checked for what is missing or risky — a deposit, a balance due date, a revision limit, cancellation, ownership, acceptance — with the question to ask for each. It never blocks you from continuing.</p></div>
    <div class="ft"><b>3. Quotation</b><p>A professional project quote from the deal, with deliverables, timeline, fee and payment terms. The client can open a link, review it and accept it, with no account.</p></div>
    <div class="ft"><b>4. Agreement</b><p>The accepted quote becomes an agreement with the same figures. The client signs online through a link, and the record shows who signed, when and with which signature.</p></div>
    <div class="ft"><b>5. Invoice</b><p>Invoices are raised from the agreement — deposit, milestone, balance, or the full amount — and can't add up to more than the agreement is worth.</p></div>
    <div class="ft"><b>6. Payment tracking</b><p>See what is pending, due soon, overdue or paid. When one is late, DealInSec drafts a follow-up for you to review and send yourself.</p></div>
  </div>
</div></section>
<section><div class="wrap">
  <h2>What the Protection Check looks at for client work</h2>
  <p class="sec-sub">It checks the wording of your terms and tells you what is worth clarifying. It is not legal advice, and a deal with no findings is not a guarantee of anything.</p>
  <div class="tbl-scroll"><table class="cmp">
    <tr><th>Check</th><th>What it asks</th></tr>
    <tr><td><b>Scope and deliverables</b></td><td>Is there a list of what you'll deliver, and does the wording leave the scope open (“as per requirement”)?</td></tr>
    <tr><td><b>Deposit</b></td><td>Is an advance or deposit due before work starts?</td></tr>
    <tr><td><b>Balance timing</b></td><td>Is there a due window for the rest, or does “on completion” quietly become “whenever”?</td></tr>
    <tr><td><b>Revisions</b></td><td>Is there a limit on rounds of changes, and is anything excluded?</td></tr>
    <tr><td><b>Cancellation</b></td><td>What is owed for work already done if the client cancels?</td></tr>
    <tr><td><b>Ownership</b></td><td>When does the finished work become the client's?</td></tr>
    <tr><td><b>Acceptance</b></td><td>How does the client confirm the work is accepted, and how long do they have?</td></tr>
    <tr><td><b>Late payment</b></td><td>Is there any stated consequence if a payment is late?</td></tr>
  </table></div>
  <p class="muted" style="font-size:14px;margin-top:12px">Try it on a real message without an account: the free <a href="/tools/deal-risk-checker">Deal Risk Checker</a> reads a pasted client request and lists what it says and what it leaves out.</p>
</div></section>
<section><div class="wrap">
  <h2>Example: from a message to a paid invoice</h2>
  <p class="sec-sub">An illustrative project, not a real client, showing how the pieces connect. The figures are examples.</p>
  <div class="tbl-scroll"><table class="cmp">
    <tr><th>Step</th><th>What happens</th></tr>
    <tr><td><b>The message</b></td><td>“Can you build our website for $1,500? We need it by October 20.”</td></tr>
    <tr><td><b>What it states</b></td><td>A fee and a deadline.</td></tr>
    <tr><td><b>What it doesn't say</b></td><td>What the website includes, a deposit, when the balance is due, how many revisions are included, ownership and cancellation.</td></tr>
    <tr><td><b>Protection Check</b></td><td>Raises each of those as a question to put to the client, most important first.</td></tr>
    <tr><td><b>Quotation</b></td><td>Lists the pages, two revision rounds, a 50% deposit and the balance due within seven days of launch. The client accepts it from a link.</td></tr>
    <tr><td><b>Agreement</b></td><td>Carries the same figures. The client signs online.</td></tr>
    <tr><td><b>Invoices</b></td><td>A deposit invoice, then a balance invoice on launch. Together they can't exceed the agreement.</td></tr>
    <tr><td><b>A late payment</b></td><td>Shows as overdue. DealInSec drafts a reminder with the real invoice number, amount and due date; you send it.</td></tr>
  </table></div>
  <div class="callout honest"><b>What DealInSec doesn't do</b><p>It can't make a client pay, and it doesn't collect payments: clients pay you directly and DealInSec records the status. It has no time tracking, client portal, accounting or expense tracking, and it doesn't send reminders by itself. It gives you clear terms in writing before you start, documents that agree with each other and a dated record of what was accepted.</p></div>
</div></section>
<section><div class="wrap">
  <h2>Free tools and guides for client work</h2>
  <div class="rel-grid">
    <a class="rel-card" href="/tools/deal-risk-checker">Deal Risk Checker<span>Paste a client message and see what's missing before you say yes.</span></a>
    <a class="rel-card" href="/tools/quotation-maker">Quotation maker<span>A professional quote as a PDF, in your currency.</span></a>
    <a class="rel-card" href="/tools/service-agreement-template">Freelance contract template<span>Scope, fees, revisions, cancellation and signatures.</span></a>
    <a class="rel-card" href="/blog/scope-creep">Scope creep<span>How to respond when the work grows.</span></a>
    <a class="rel-card" href="/blog/revision-limits">Revision limits<span>Setting a number and pricing the rest.</span></a>
    <a class="rel-card" href="/blog/freelance-payment-terms">Payment terms<span>Deposits, milestones and due dates.</span></a>
  </div>
  <p class="muted" style="font-size:14px;margin-top:12px">Working with brands instead? See <a href="/for-creators">DealInSec for creators</a>. Comparing tools? See the <a href="/freelance-business-management-software">freelance business management software guide</a> and <a href="/bonsai-alternatives">Bonsai alternatives</a>.</p>
</div></section>`,
    faq: [
      {
        q: "What does DealInSec do for a freelancer?",
        a: "It runs one client deal from request to payment: it turns a client's message into a structured deal, checks the terms for what is missing, generates a quotation the client can accept online, creates an agreement the client can sign online, raises invoices from that agreement and tracks what is paid, pending and overdue.",
      },
      {
        q: "Can I paste a client's message instead of filling in a form?",
        a: "Yes. Paste the message and the AI reading extracts the client, project, deliverables, fee, deadline and any terms it states. Anything the message doesn't say is shown as “Not specified” rather than guessed, and nothing is created until you confirm.",
      },
      {
        q: "What is the difference between a quotation and an agreement?",
        a: "A quotation is the priced offer: what you will deliver, when and for how much. An agreement is what both sides accept as the terms of the work. In DealInSec the accepted quotation becomes the agreement with the same figures, so the two cannot disagree.",
      },
      {
        q: "How does the Protection Check help?",
        a: "It reads the terms of the deal and lists what is missing or risky, such as no deposit, no balance due date, no revision limit, unclear cancellation or ownership, each with the question to ask or a line you can add. It checks the wording only and is not legal advice.",
      },
      {
        q: "Does DealInSec collect payments from my clients?",
        a: "No. Clients pay you directly, by whatever method you agree, and DealInSec records the status. It can draft a payment reminder for you to review and send yourself; it never sends one on its own.",
      },
      {
        q: "Can I use DealInSec outside India?",
        a: "Yes. The free plan, which covers deals, quotations, agreements, invoices and payment tracking with no monthly cap and needs no card, is open in every country, in 50 currencies. Paid plans can currently be bought in India only.",
      },
      {
        q: "Is the client's signature legally valid?",
        a: "The client accepts the agreement electronically and DealInSec records who accepted it, when and with which signature. It is not a certificate-based digital signature. Whether an agreement is enforceable depends on its terms and the law that applies, and this is not legal advice, so have a lawyer review anything high-value or unusual.",
      },
    ],
  },

  /* ── /for-creators — brand collaborations, any country ───────────────── */
  {
    path: "/for-creators",
    region: "global",
    updated: "2026-09-30",
    metaTitle: "Brand Deal Agreements, Quotes and Invoices for Creators",
    description:
      "Turn a brand's offer into clear deliverables, usage rights and exclusivity terms, then send a quote, get it signed, invoice the brand and track payment. For creators and UGC creators.",
    h1: "Turn brand offers into clear terms, signed agreements and paid invoices",
    sub: "Paste the brand's message, see which terms are missing — usage rights, exclusivity, approval, payment timing — then send a quote, get the agreement signed, invoice the brand and track payment. For creators, UGC creators and influencers.",
    chips: ["Usage rights and exclusivity", "Protection Check before you say yes", "Brand quote → agreement → invoice", "Free plan in every country", "Not legal advice"],
    shortLabel: "For Creators",
    sections: `
<section><div class="wrap">
  <h2>The problem with a brand offer in a DM</h2>
  <p class="sec-sub">Brand deals usually start as a short message: “We'd love 2 Instagram Reels and 3 stories for $800. We'd also like to use the content for ads.” That is a real offer, and it leaves most of the deal open: how long the brand can use your content, whether ad use is included in the fee, whether you can work with competing brands, how many rounds of changes you owe and when you are paid.</p>
  <div class="feat">
    <div class="ft"><b>The deliverables are loose</b><p>“A few posts” or “some stories” can grow. A count, a format and a platform for each piece keep the brief from expanding after you agree.</p></div>
    <div class="ft"><b>The usage is open</b><p>Posting content yourself is different from a brand running it as an ad. Without a stated channel and period, “use the content” has no end date.</p></div>
    <div class="ft"><b>The exclusivity is assumed</b><p>Whether you can work with a competitor during or after the campaign should be a stated term, with a category and a length, not something both sides assume differently.</p></div>
    <div class="ft"><b>The payment has no date</b><p>“We'll pay after posting” can become weeks. A deposit and a due date written down before you start are what make the fee arrive on a schedule.</p></div>
  </div>
</div></section>
<section><div class="wrap">
  <h2>Deal analysis: paste the message</h2>
  <p class="sec-sub">Paste the brand's email or DM and DealInSec reads it into a brand deal: the brand, campaign, deliverables, platform, fee, deadline, revisions and any usage, exclusivity or approval terms it states. Anything the message doesn't say is shown as “Not specified”, never guessed, and nothing is created until you confirm.</p>
  <div class="callout honest"><b>Try it without an account</b><p>The free <a href="/tools/deal-risk-checker">Deal Risk Checker</a> reads a pasted brand offer in your browser and lists what it says, what it leaves out and the questions to ask. The optional AI reading is the only step that sends the message anywhere, and only when you press it.</p></div>
</div></section>
<section><div class="wrap">
  <h2>What the Protection Check looks at for a brand deal</h2>
  <p class="sec-sub">It checks the wording of the terms and tells you what is worth clarifying before you say yes. Each finding says why it matters and what to ask. It is not legal advice, and a deal with no findings is not a guarantee of anything.</p>
  <div class="tbl-scroll"><table class="cmp">
    <tr><th>Check</th><th>What it asks</th></tr>
    <tr><td><b>Usage rights</b></td><td>Where can the brand use the content, and does that include paid advertising?</td></tr>
    <tr><td><b>Usage duration</b></td><td>For how long? Usage with no end date can turn a one-off fee into a permanent licence.</td></tr>
    <tr><td><b>Open-ended wording</b></td><td>Does it say “in perpetuity” or “all media”?</td></tr>
    <tr><td><b>Exclusivity</b></td><td>Is a competitor category ruled out, and for how long?</td></tr>
    <tr><td><b>Approval</b></td><td>Who approves the content, how quickly, and how many rounds of changes are included?</td></tr>
    <tr><td><b>Deliverables and platform</b></td><td>How many pieces, in what format, on which platform?</td></tr>
    <tr><td><b>Payment timing</b></td><td>Is there a deposit, and when is the rest due?</td></tr>
    <tr><td><b>Cancellation and ownership</b></td><td>What is owed if the campaign is cancelled, and who owns the content?</td></tr>
  </table></div>
</div></section>
<section><div class="wrap">
  <h2>Deliverables, usage rights and exclusivity, in plain terms</h2>
  <h3>Deliverables</h3>
  <p>A deliverable is one piece of content the brand is paying for: for example a Reel, a set of stories, a TikTok or a YouTube integration. Listing each with its platform and quantity is the cleanest way to say what the fee covers.</p>
  <h3>Usage rights</h3>
  <p>Usage rights describe what the brand may do with your content after it is made: post it on its own channels, run it as a paid ad, put it on its website, and for how long. Practice varies between brands and countries, so the useful habit is to ask and write the answer down. The Brand Collaboration deal type has fields for the usage rights and the usage duration, and whatever you enter is written into the quotation and the agreement.</p>
  <h3>Exclusivity</h3>
  <p>Exclusivity limits who else you can work with, usually a competing category for a set period. It matters because it can turn away other paid work. If a brand wants it, the category and the length are worth stating, and whether it changes the fee is worth asking.</p>
  <p class="muted" style="font-size:14px">What you leave blank stays blank: nothing is filled in for you, and an agreement only states the terms the deal actually carries.</p>
</div></section>
<section><div class="wrap">
  <h2>Quotation, agreement, invoice and payment record for a brand deal</h2>
  <div class="feat">
    <div class="ft"><b>Quotation</b><p>Brand, campaign, deliverables, platforms, usage, exclusivity, fee and payment terms in one document the brand can open from a link and accept, with no account.</p></div>
    <div class="ft"><b>Agreement</b><p>Written from the deal's own terms, so the usage, exclusivity and approval you agreed are what the document says. The brand signs online, and the record shows who signed, when and with which signature.</p></div>
    <div class="ft"><b>Invoice</b><p>An invoice raised from the agreement: deposit, balance or the full amount, in your currency, and never more than the agreement is worth.</p></div>
    <div class="ft"><b>Payment tracking</b><p>See which brand payments are pending, due soon, overdue or paid. When one is late, DealInSec drafts a follow-up for you to review and send.</p></div>
  </div>
</div></section>
<section><div class="wrap">
  <h2>Example: one brand offer, before and after</h2>
  <p class="sec-sub">An illustrative offer, not a real brand or customer.</p>
  <div class="tbl-scroll"><table class="cmp">
    <tr><th>The offer says</th><th>It doesn't say</th><th>What Protection Check would ask</th></tr>
    <tr><td>2 Instagram Reels and 3 stories for $800</td><td>The deadline, or when payment is due</td><td>Confirm the posting dates and when the fee is paid.</td></tr>
    <tr><td>“We'd also like to use the content for ads”</td><td>Which ad channels, for how long, and whether ads are in the fee</td><td>Ask which channels, how long, and whether ad use is included or charged separately.</td></tr>
    <tr><td>—</td><td>Exclusivity, approval and revisions</td><td>Ask whether competitors are ruled out and for how long, who approves the content and how many rounds of changes are included.</td></tr>
  </table></div>
  <div class="callout honest"><b>What DealInSec doesn't do</b><p>It isn't a marketplace: it doesn't find you brand deals or connect you with brands. It doesn't collect payment; brands pay you directly and DealInSec records the status. It can't make a brand pay, has no time tracking, client portal or accounting, and doesn't send reminders by itself. It gives you clear terms in writing before you agree, documents that agree with each other and a dated record of what was accepted.</p></div>
</div></section>
<section><div class="wrap">
  <h2>Free tools and guides for brand deals</h2>
  <div class="rel-grid">
    <a class="rel-card" href="/tools/deal-risk-checker">Deal Risk Checker<span>Paste a brand's message and see what's missing.</span></a>
    <a class="rel-card" href="/tools/quotation-maker">Quotation maker<span>A professional quote as a PDF, in your currency.</span></a>
    <a class="rel-card" href="/tools/bill-generator">Invoice generator<span>An invoice with your logo and details.</span></a>
    <a class="rel-card" href="/tools/payment-reminder-email-generator">Payment reminder generator<span>A polite follow-up for a late payment.</span></a>
    <a class="rel-card" href="/blog/freelance-payment-terms">Payment terms<span>Deposits, milestones and due dates.</span></a>
    <a class="rel-card" href="/blog/freelance-contract-terms">Contract terms<span>What a contract should say.</span></a>
  </div>
  <p class="muted" style="font-size:14px;margin-top:12px">Doing client projects as well? See <a href="/for-freelancers">DealInSec for freelancers</a>.</p>
</div></section>`,
    faq: [
      {
        q: "Is DealInSec for creators and influencers?",
        a: "Yes. When you sign up, choose “I work with brands” and the app uses brand wording, offers the Brand Collaboration deal type first and adds optional fields for campaign, usage rights, usage duration, exclusivity and approval. It is the same workflow and the same pricing as for client work, and you can change the setting any time.",
      },
      {
        q: "What are usage rights in a brand deal?",
        a: "Usage rights describe what the brand may do with your content after it is made, such as posting it on its own channels, running it as a paid ad or using it on its website, and for how long. Practice varies, so it is worth asking and writing the answer into the agreement.",
      },
      {
        q: "What is exclusivity in an influencer agreement?",
        a: "Exclusivity limits who else you can work with, usually a competing category for a set period. If a brand asks for it, the category and the length are worth stating, and whether it changes the fee is worth asking.",
      },
      {
        q: "Do I need a written agreement for a brand collaboration?",
        a: "Writing the terms down makes clear to both sides what was agreed: the deliverables, the fee and when it is paid, how the content may be used and for how long. Whether a particular document is enforceable depends on its terms and where you are, so this is not legal advice; for a high-value or unusual deal, have a lawyer review it.",
      },
      {
        q: "Does DealInSec find brand deals or collect payment from brands?",
        a: "No. It is not a marketplace and does not find deals. Brands pay you directly, and DealInSec records the status of each invoice. It can draft a payment reminder for you to review and send yourself.",
      },
      {
        q: "Can I use DealInSec outside India?",
        a: "Yes. The free plan, which covers deals, quotations, agreements, invoices and payment tracking with no monthly cap and needs no card, is open in every country, in 50 currencies. Paid plans can currently be bought in India only.",
      },
      {
        q: "Is the brand's signature legally valid?",
        a: "The brand accepts the agreement electronically and DealInSec records who accepted it, when and with which signature. It is not a certificate-based digital signature. Whether an agreement is enforceable depends on its terms and the law that applies, and this is not legal advice.",
      },
    ],
  },

  /* ── /for-web-developers — solo web developers in India ───────────────── */
  {
    path: "/for-web-developers",
    region: "IN",
    updated: "2026-11-12",
    metaTitle: "Find Web Development Clients with AI",
    description:
      "How freelance web developers in India find clients with DealInSec: AI research of businesses that are growing or visibly under-served online, dated evidence with sources, and outreach drafts you approve and send yourself.",
    h1: "Find web development clients, with evidence instead of bidding",
    sub: "Describe the businesses you build for — MERN, Next.js, WordPress or Shopify work, in India or abroad — and Client Radar researches companies against that profile: what they do, how they're moving and why now, each with its source. You approve every message and send it yourself.",
    chips: ["For freelance web developers", "India and international clients", "Evidence with sources", "You send every message", "Free plan, no card"],
    shortLabel: "For Web Developers",
    sections: `
<section><div class="wrap">
  <h2>The web developer's client problem</h2>
  <p class="sec-sub">You can build anything, and that is exactly the problem: “web developer” is a commodity on a marketplace. On Upwork you bid against the world's lowest price; on referrals you wait. Meanwhile the businesses that would happily pay for your work — growing companies whose web presence trails the business — never see you, because nobody is systematically looking for them.</p>
  <div class="feat">
    <div class="ft"><b>Marketplaces own the client</b><p>The platform holds the relationship, the reviews and the ranking. One algorithm change and next month is empty. Direct clients are the ones who come back and refer.</p></div>
    <div class="ft"><b>Referrals aren't a pipeline</b><p>They are the best clients and the worst strategy: unpredictable in timing, price-anchored by whoever referred you, and gone the quarter you need them most.</p></div>
    <div class="ft"><b>Prospecting by hand is a second job</b><p>Finding a growing business, reading its site, spotting why now, finding who to write to — 20 minutes per company, so it never happens consistently.</p></div>
    <div class="ft"><b>Generic outreach burns the niche</b><p>“We provide best website development services” has trained every founder to delete. A message that names something true about their business is the only kind that works.</p></div>
  </div>
</div></section>
<section><div class="wrap">
  <h2>What Client Radar does with a developer's profile</h2>
  <p class="sec-sub">You describe who you build for once — say, <i>“D2C brands and clinics in India, 5–100 people, whose site or booking doesn't match the size of the business; I build Next.js and Shopify”</i> — and each search researches companies against it.</p>
  <div class="feat">
    <div class="ft"><b>It reads their actual website</b><p>Not a stale directory: each company's own site is checked against your profile — industry, size, location, what they sell — and the fit is scored with reasons.</p></div>
    <div class="ft"><b>It finds the “why now”</b><p>Hiring posts, launches, new locations, an expanding catalogue — recent, dated signals shown with their sources, because “you opened a second branch last month” is what makes a message land.</p></div>
    <div class="ft"><b>It names decision makers where public</b><p>Founders and directors named on the site or publicly listed are surfaced. Contact details aren't always available, and DealInSec never invents them — unknowns are shown as unknowns.</p></div>
    <div class="ft"><b>Local mode for your city</b><p>For local work — clinics, gyms, CA firms — it can list businesses in any city from Google Maps and research the listed websites you pick. A listing without a website link says only that; DealInSec won't claim a business “has no website”. See <a href="/find-local-clients">finding local clients</a>.</p></div>
  </div>
  <div class="callout honest"><b>What it honestly can't do</b><p>No tool can guarantee you clients, replies or projects, and research is never unlimited: the free plan includes ${OB.free.monthlySearches} searches every ${OUTBOUND_WINDOW_DAYS} days (up to ${OB.free.maxCompanies} companies each), Pro ${OB.pro.monthlySearches} (up to ${OB.pro.maxCompanies} each). What it replaces is the hours of searching and reading — the judgement and the sending stay yours.</p></div>
</div></section>
<section><div class="wrap">
  <h2>Outreach a developer can stand behind</h2>
  <p class="sec-sub">Mika drafts the first message from the facts that were verified about each company — the hiring post, the launch, the gap you chose to raise — never from imagination. You edit it, approve the exact text and send it from your own email or WhatsApp. Nothing is ever sent automatically, and a do-not-contact list is checked first.</p>
  <p class="sec-sub">A first message built this way reads like one professional writing to another: <i>“Congrats on the Baner branch — noticed bookings still run on calls. I build booking systems for clinics; worth a 2-minute example?”</i> The craft is in our guide to <a href="/blog/personalized-cold-email">personalised cold email</a>, and the research routine behind it in <a href="/blog/how-to-research-a-company-before-outreach">researching a company before outreach</a>.</p>
</div></section>
<section><div class="wrap">
  <h2>From reply to project</h2>
  <p class="sec-sub">Interested replies become leads with stages, next steps and follow-up dates, so “ask me next quarter” actually gets asked. Zee briefs you each day on which follow-ups are due, and when you win the work, the deal, quotation and agreement side is there for the paperwork. Start with the guide: <a href="/blog/how-to-find-web-development-clients">how to find web development clients</a>.</p>
</div></section>`,
    faq: [
      {
        q: "How does DealInSec help a web developer find clients?",
        a: "You describe the businesses you build for, and Client Radar searches the web or lists local businesses in a city, reads each company's own website against your profile, and shows recent dated signals — hiring, launches, expansion — with their sources. You pick who is worth contacting, approve an AI-drafted first message based on those verified facts, and send it yourself.",
      },
      {
        q: "Can it find businesses that need a new website?",
        a: "It finds businesses that fit your profile and are visibly moving — growing, hiring, launching — which is when companies invest in their web presence. It won't claim a business 'needs a website': what a listing or site shows is presented as what was observed, inferences are labelled as inferences, and the conversation about what they need is yours to have.",
      },
      {
        q: "Does it work for international clients too?",
        a: "Yes. Searches can target the US, the UK, Canada, Australia, the UAE, India and other countries, whichever you choose. Many Indian developers use it for both: local businesses in their city and project clients abroad.",
      },
      {
        q: "Does DealInSec send the outreach for me?",
        a: "No, and that is deliberate. It drafts the message from verified facts; you edit, approve the exact text and send it from your own email or WhatsApp. A message from you converts better, and your sender reputation stays in your hands.",
      },
      {
        q: "What does it cost for a freelance developer?",
        a: `The free plan is permanent and needs no card: ${OB.free.monthlySearches} Client Radar searches every ${OUTBOUND_WINDOW_DAYS} days (up to ${OB.free.maxCompanies} companies each), ${OB.free.monthlyDrafts} AI outreach drafts, the leads pipeline and the AI coworkers. Pro is ₹${PRICING.proMonthlyInr} a month in India with larger allowances, paid monthly with no auto-renewal.`,
      },
      {
        q: "Is this a freelance marketplace or a contact database?",
        a: "Neither. There are no job posts to bid on and no stored database of contacts being resold. Each search researches companies fresh against your profile, with sources shown, and contact details aren't always available — it is a research tool, not a directory.",
      },
    ],
  },

  /* ── /for-seo-freelancers — SEO specialists and consultants ────────────── */
  {
    path: "/for-seo-freelancers",
    region: "IN",
    updated: "2026-11-12",
    metaTitle: "Find SEO Clients: AI Prospecting for SEO Freelancers",
    description:
      "How SEO freelancers and consultants in India find clients with DealInSec: AI research that spots businesses investing in growth, evidence with sources and dates, and personalised outreach you approve and send yourself.",
    h1: "Find SEO clients who are already investing in growth",
    sub: "The best SEO client isn't the site with the worst rankings — it's the business that is moving: launching, hiring, publishing, running ads. Client Radar finds and researches those businesses against your profile, with dated evidence, and you approve and send every message yourself.",
    chips: ["For SEO freelancers and consultants", "Buying signals with dates", "India and international", "Drafts you approve", "Free plan, no card"],
    shortLabel: "For SEO Freelancers",
    sections: `
<section><div class="wrap">
  <h2>Why SEO prospecting is harder than SEO</h2>
  <p class="sec-sub">You can rank a client's site, but ranking yourself for “SEO services” against funded agencies is a different war — and inbound alone decides who finds you, at what budget. The freelancers with full retainers run outbound too: they find businesses that are spending on growth and show them, specifically, what their search presence is leaving on the table.</p>
  <div class="feat">
    <div class="ft"><b>The wrong prospect wastes months</b><p>A business with no budget and no urgency “would love SEO” and never signs. The right prospect is already paying for growth somewhere — ads, content hires, new locations.</p></div>
    <div class="ft"><b>Audits sent cold get deleted</b><p>An unsolicited 14-point teardown insults whoever built the site. One observed, dated fact plus one question starts conversations.</p></div>
    <div class="ft"><b>Research by hand doesn't scale</b><p>Reading a company's site, checking what they publish, finding who decides — twenty minutes each is why most SEO freelancers prospect only in dry months.</p></div>
    <div class="ft"><b>Retainers need a pipeline</b><p>SEO is sold on trust and timing. A pipeline of researched conversations, warmed over weeks, is what turns “maybe later” into a retainer when later arrives.</p></div>
  </div>
</div></section>
<section><div class="wrap">
  <h2>Signals that say “this business will pay for SEO”</h2>
  <p class="sec-sub">Describe your ideal client — say, <i>“D2C and services businesses in India, 10–200 people, already publishing or advertising, where search is an obvious growth channel”</i> — and Client Radar researches companies against it, surfacing the signals that matter to an SEO pitch:</p>
  <div class="feat">
    <div class="ft"><b>Growth investment</b><p>Hiring for marketing, content or sales roles; new product or location launches — dated, sourced, and the natural first line of your message.</p></div>
    <div class="ft"><b>Content activity — or its absence</b><p>What the company's own site shows: an active blog, a dead one, thin service pages. Shown as what was observed on which page, so your pitch quotes reality.</p></div>
    <div class="ft"><b>Fit against your niche</b><p>Industry, size and location are checked against your profile and scored with reasons, so a thin market is said plainly instead of padded with bad fits.</p></div>
    <div class="ft"><b>The person to write to</b><p>Founders and marketing leads named publicly are surfaced with the source. Where no contact is public, it says so — guessed emails burn sender domains, so DealInSec never invents one.</p></div>
  </div>
  <div class="callout honest"><b>No ranking promises — theirs or ours</b><p>You already know not to guarantee rankings; we don't guarantee clients. What DealInSec replaces is the slow part: finding and reading companies. The free plan includes ${OB.free.monthlySearches} searches every ${OUTBOUND_WINDOW_DAYS} days, Pro ${OB.pro.monthlySearches}, and research is never unlimited.</p></div>
</div></section>
<section><div class="wrap">
  <h2>Outreach that reads like a consultant, not a cold blast</h2>
  <p class="sec-sub">Mika drafts the first message from the verified facts on each company — <i>“you're hiring two content writers, but the blog hasn't published since March; usually that means distribution is the gap”</i> — framed as an observation and a question, never an accusation. You edit, approve the exact text and send from your own email or LinkedIn. Follow-ups are drafted when due; you send those too. Templates and structure: <a href="/blog/personalized-cold-email">the personalised cold email guide</a>.</p>
</div></section>
<section><div class="wrap">
  <h2>A pipeline built for long SEO sales cycles</h2>
  <p class="sec-sub">SEO deals close on the second or fifth touch, months after the first. Every conversation lives on a lead with a stage, recorded facts with sources, and a follow-up date; <a href="/ai-coworkers">Zee's briefing</a> tells you each day which follow-ups are due, so no warm prospect goes cold by accident. The wider method is in <a href="/blog/how-to-find-clients-as-a-freelancer-in-india">the client-finding system</a> and <a href="/blog/how-to-research-a-company-before-outreach">researching a company before outreach</a>.</p>
</div></section>`,
    faq: [
      {
        q: "How does DealInSec find SEO clients?",
        a: "You describe your ideal client once, and each Client Radar search researches companies against that profile: it reads each company's own website, checks fit by industry, size and location, and surfaces dated growth signals — hiring, launches, content activity — with sources. You choose who to contact and send every message yourself.",
      },
      {
        q: "Does it audit a prospect's SEO?",
        a: "No — it is prospect research, not an SEO audit tool. It records what was observed on the company's own pages (an inactive blog, thin service pages, what they sell and to whom) with sources, which gives your outreach true, specific material. The audit you sell remains your craft.",
      },
      {
        q: "Can I find clients outside India?",
        a: "Yes. Searches target whichever countries you choose — the US, the UK, Canada, Australia, the UAE, India and others — so an Indian SEO consultant can prospect internationally and locally from the same workspace.",
      },
      {
        q: "Will it send cold emails for me?",
        a: "No. It drafts from verified facts; you approve the exact text and send it from your own email or LinkedIn. Nothing is sent automatically, follow-ups included, and a do-not-contact list is checked before any draft.",
      },
      {
        q: "What does it cost?",
        a: `The free plan is permanent: ${OB.free.monthlySearches} searches every ${OUTBOUND_WINDOW_DAYS} days (up to ${OB.free.maxCompanies} companies each), ${OB.free.monthlyDrafts} AI drafts, the pipeline and the AI coworkers, no card. Pro is ₹${PRICING.proMonthlyInr} a month in India with larger allowances and team seats, paid monthly with no auto-renewal.`,
      },
    ],
  },

  /* ── /for-digital-marketing-agencies — 2–10 person agencies ────────────── */
  {
    path: "/for-digital-marketing-agencies",
    region: "IN",
    updated: "2026-11-12",
    metaTitle: "Client Acquisition for Digital Marketing Agencies",
    description:
      "How 2–10 person digital marketing agencies in India build a client pipeline with DealInSec: AI prospect research with evidence, founder-approved outreach, shared leads and follow-ups, and team seats on one plan.",
    h1: "Give your agency the pipeline you'd build for a client",
    sub: "Your agency sells systematic growth — and runs on referrals. DealInSec gives a 2–10 person marketing agency its own engine: AI research of businesses showing real buying signals, outreach the founder approves rather than writes, and one shared pipeline with owners and follow-up dates.",
    chips: ["For agencies of 2–10 people", "Buying signals with sources", "Founder-approved outreach", "Shared pipeline and seats", "Free plan, no card"],
    shortLabel: "For Marketing Agencies",
    sections: `
<section><div class="wrap">
  <h2>The cobbler's children problem</h2>
  <p class="sec-sub">Every small agency knows the irony: you build acquisition systems for clients while your own growth hangs on referrals and the founder's network. It works until a retainer churns in a quiet month. The fix isn't a sales hire you can't afford yet — it's running, for yourselves, the discipline you sell.</p>
  <div class="feat">
    <div class="ft"><b>Referral dependence</b><p>Referrals are wonderful and unownable. An agency that can't generate its own conversations can't choose its clients or defend its pricing.</p></div>
    <div class="ft"><b>Founder-bottlenecked sales</b><p>The founder's voice closes deals, but the founder writing every message from scratch caps outbound at whatever a stolen Sunday allows.</p></div>
    <div class="ft"><b>Leads scattered across DMs</b><p>Prospects live in WhatsApp, LinkedIn and three inboxes. “Ask me next quarter” is forgotten by next week — the pipeline leaks from memory, not rejection.</p></div>
    <div class="ft"><b>Research nobody has time for</b><p>Knowing a prospect before writing — their business, their activity, why now — is the difference between agency-grade outreach and spam. At twenty minutes a company, it loses to client work every time.</p></div>
  </div>
</div></section>
<section><div class="wrap">
  <h2>Prospecting that spots businesses already buying growth</h2>
  <p class="sec-sub">Describe the clients your agency wants — industry, size, geography, the problem you solve — and Client Radar researches companies against that profile: it reads each company's own website, scores the fit with reasons, and surfaces dated buying signals with sources. For a marketing agency those signals are the pitch: hiring a first sales lead, launching a product, opening a city, visible marketing under-investment next to same-size competitors. Local-business agencies can start from <a href="/find-local-clients">Google Maps listings in any city</a>; agencies hunting nationally or abroad choose the countries per search.</p>
  <div class="callout honest"><b>Research, not a contact database</b><p>Companies are researched fresh against your profile, with sources shown; inferences are labelled and unknowns stay unknowns. Contact details aren't always available, and nothing here guarantees replies or retainers — it makes the researched conversation affordable at agency volume. Free: ${OB.free.monthlySearches} searches every ${OUTBOUND_WINDOW_DAYS} days; Pro: ${OB.pro.monthlySearches} (up to ${OB.pro.maxCompanies} companies each).</p></div>
</div></section>
<section><div class="wrap">
  <h2>The founder approves; the team and the AI do the legwork</h2>
  <p class="sec-sub">In <a href="/ai-coworkers">AI Team</a>, Nibo researches companies against your profile and saves qualified ones to Leads with their evidence; Mika drafts first messages and follow-ups from verified facts only; Zee briefs the team each morning on which follow-ups are due and which drafts await approval. A person — usually the founder — edits and approves every message and sends it from the agency's own email, WhatsApp or LinkedIn. Outreach keeps the founder's voice without consuming the founder's week, and nothing is ever sent automatically.</p>
</div></section>
<section><div class="wrap">
  <h2>One pipeline the whole team works</h2>
  <p class="sec-sub">Every lead carries a stage, an owner, recorded facts with sources, and a follow-up date. Pro includes ${PRO_INCLUDED_SEATS} team members with roles, so the pipeline is shared rather than forwarded, and the weekly review takes fifteen minutes instead of an archaeology session. The playbook in long form: <a href="/blog/how-digital-marketing-agencies-get-clients">how small marketing agencies get clients</a>.</p>
</div></section>`,
    faq: [
      {
        q: "How does DealInSec help a marketing agency win clients?",
        a: "It runs the acquisition system an agency would design for itself: AI research of companies matching your ideal-client profile with dated buying signals and sources, outreach drafted from those verified facts for the founder to approve and send, and a shared pipeline of leads with owners and follow-up dates. The agency sends every message itself.",
      },
      {
        q: "What buying signals does it surface?",
        a: "Recent, dated, sourced events from each company's own site and public pages: hiring (and for which roles), product and location launches, expansion, content activity or its absence. Signals are shown with where they were found; inferences are labelled as inferences.",
      },
      {
        q: "Can my team use it together?",
        a: `Yes. Pro includes ${PRO_INCLUDED_SEATS} team members with roles and an activity log, so research, drafting and follow-ups are shared work on one pipeline instead of forwarded screenshots. Extra seats are ₹${EXTRA_SEAT_PRICE_INR} each a month.`,
      },
      {
        q: "Does it send campaigns automatically?",
        a: "No. DealInSec never sends email, WhatsApp or social messages on its own. Mika drafts; a person approves the exact text and sends it from the agency's own accounts. That is a deliberate product rule, not a missing feature — agency reputation rides on every message.",
      },
      {
        q: "Can we prospect for clients abroad as well as in India?",
        a: "Yes. Each search targets whichever countries you choose — the US, the UK, Canada, Australia, the UAE, India and others — and local mode lists businesses in a specific city from Google Maps for local-client work.",
      },
      {
        q: "What does it cost an agency?",
        a: `Start free, no card: ${OB.free.monthlySearches} searches every ${OUTBOUND_WINDOW_DAYS} days, ${OB.free.monthlyDrafts} AI drafts and the pipeline. Pro is ₹${PRICING.proMonthlyInr} a month in India — larger allowances, unlimited deals and ${PRO_INCLUDED_SEATS} seats — paid monthly with no auto-renewal, so a quiet month costs nothing further.`,
      },
    ],
  },

  /* ── /for-web-development-agencies — small dev shops ───────────────────── */
  {
    path: "/for-web-development-agencies",
    region: "IN",
    updated: "2026-11-12",
    metaTitle: "Find Clients for Your Web Development Agency",
    description:
      "How small web development agencies in India keep a project pipeline full with DealInSec: AI research of growing businesses in India and abroad, decision-maker discovery, and personalised outreach your team approves and sends.",
    h1: "Keep your dev agency's project pipeline full between referrals",
    sub: "Project businesses die of gaps: the bench between one build ending and the next beginning. Client Radar researches growing businesses — in India and the markets you choose abroad — with dated evidence of why now, and your team approves and sends every message itself.",
    chips: ["For web development agencies", "Project pipeline, not job boards", "India + international markets", "Decision makers where public", "Free plan, no card"],
    shortLabel: "For Web Dev Agencies",
    sections: `
<section><div class="wrap">
  <h2>The bench is the business killer</h2>
  <p class="sec-sub">A small development agency's economics break not on rates but on gaps — the three weeks between projects when salaries run and revenue doesn't. Subcontracting fills benches at half-rates; job boards mean bidding against twenty agencies on price. The agencies that escape both keep a steady outbound rhythm, so the next project is in conversation before the current one ships.</p>
  <div class="feat">
    <div class="ft"><b>Project work needs constant refill</b><p>Retainers renew; projects end. A dev agency needs new conversations every single month, even when — especially when — delivery is busy.</p></div>
    <div class="ft"><b>RFPs and boards are price wars</b><p>Where twenty agencies see the same brief, the cheapest competent bid wins. Outreach you originated has no competing bids attached.</p></div>
    <div class="ft"><b>International work needs targeting</b><p>US and UK projects pay multiples of Indian rates, but “abroad” isn't a strategy — finding the right overseas businesses to write to is the hard part.</p></div>
    <div class="ft"><b>Nobody owns prospecting</b><p>Between sprints, code reviews and client calls, “business development” is everyone's job and no one's — until the bench makes it an emergency.</p></div>
  </div>
</div></section>
<section><div class="wrap">
  <h2>Research aimed at project-sized problems</h2>
  <p class="sec-sub">Describe the clients you build for — <i>“funded startups and SMEs, 10–200 people, in India, the US or the UK, investing in product or expansion”</i> — and Client Radar reads each company's own website against that profile, scores the fit with reasons, and surfaces the dated signals that precede development budgets: new funding or products, hiring engineers or product roles, second locations, a site visibly behind the business. Each finding carries its source and date, decision makers are named where public, and thin markets are said plainly. Searches target whichever countries you choose per run — prospect Pune and Portland from the same workspace.</p>
  <div class="callout honest"><b>Limits, stated upfront</b><p>Research is never unlimited (${OB.free.monthlySearches} searches every ${OUTBOUND_WINDOW_DAYS} days free, ${OB.pro.monthlySearches} on Pro, up to ${OB.pro.maxCompanies} companies each), contact details aren't always findable, and no tool can promise projects. It makes researched targeting affordable; winning the work stays your job.</p></div>
</div></section>
<section><div class="wrap">
  <h2>Outreach with an engineer's respect for facts</h2>
  <p class="sec-sub">Mika drafts first messages strictly from what was verified about each company — the funding note, the hiring page, what their site shows — with inferences framed as questions. Your team edits, approves the exact text and sends from your own email or LinkedIn; follow-ups are drafted when due and sent the same way. Nothing goes out automatically. The message structure that earns replies is in <a href="/blog/personalized-cold-email">the personalised cold email guide</a>; the overseas specifics in <a href="/blog/find-international-clients-from-india">finding international clients from India</a>.</p>
</div></section>
<section><div class="wrap">
  <h2>A pipeline that survives delivery crunches</h2>
  <p class="sec-sub">Leads carry stages, owners, recorded evidence and follow-up dates; <a href="/ai-coworkers">Zee's daily briefing</a> resurfaces what delivery weeks buried, and Nibo can keep researching on a schedule so the top of the funnel never empties. Pro includes ${PRO_INCLUDED_SEATS} seats, so prospecting is a team rhythm rather than a founder's midnight task. When a project is won, the deal and its paperwork follow on the same record. Longer read: <a href="/blog/how-to-find-web-development-clients">how to find web development clients</a>.</p>
</div></section>`,
    faq: [
      {
        q: "How does DealInSec keep a dev agency's pipeline full?",
        a: "By making researched outbound a weekly rhythm instead of a bench-time emergency: Client Radar researches businesses matching your profile with dated evidence, Nibo can run those searches on a schedule, Mika drafts outreach from the verified facts, and your team approves and sends every message. Leads, owners and follow-up dates live on one shared pipeline.",
      },
      {
        q: "Can we target US, UK or Gulf clients?",
        a: "Yes — each search targets the countries you choose: the US, the UK, Canada, Australia, the UAE, India and others. Many Indian dev agencies run both motions from one workspace: local and national clients plus one overseas market.",
      },
      {
        q: "Does it find decision makers' contact details?",
        a: "It surfaces founders and relevant leads where they are publicly named, with the source shown. Public contact details aren't always available, and DealInSec never invents or sells them — where nothing is public, it says so, and a contact form or company inbox is the honest route.",
      },
      {
        q: "Is this like bidding on job boards?",
        a: "No — there are no briefs to bid on. It is the opposite motion: you originate conversations with businesses showing real investment signals, before a brief exists, so there is no twenty-agency price war attached.",
      },
      {
        q: "Does anything get sent automatically?",
        a: "No. Every message — first touch and follow-ups — is approved as exact text by a person on your team and sent from your own accounts. A do-not-contact list is checked before drafting.",
      },
      {
        q: "What does it cost?",
        a: `Free to start, no card: ${OB.free.monthlySearches} searches every ${OUTBOUND_WINDOW_DAYS} days with the pipeline and AI coworkers. Pro is ₹${PRICING.proMonthlyInr} a month in India: ${OB.pro.monthlySearches} searches every ${OUTBOUND_WINDOW_DAYS} days, ${OB.pro.monthlyDrafts} drafts, unlimited deals and ${PRO_INCLUDED_SEATS} team seats, paid monthly with no auto-renewal.`,
      },
    ],
  },

  /* ── /for-software-agencies — SaaS / mobile / custom dev shops ─────────── */
  {
    path: "/for-software-agencies",
    region: "IN",
    updated: "2026-11-12",
    metaTitle: "Find Clients for Your Software Development Agency",
    description:
      "How small software agencies in India — SaaS, mobile and custom development teams — find qualified business clients with DealInSec: AI company research, buying signals with sources, and outreach your team approves and sends.",
    h1: "Find software clients by evidence, not by bidding portals",
    sub: "Custom software is bought on trust, by named people, over weeks — exactly the sale that researched, personal outreach wins. Client Radar researches companies against your profile across the countries you choose, shows the evidence, and your team approves and sends every message.",
    chips: ["For software development agencies", "SaaS, mobile and custom builds", "Longer B2B sales cycles", "Evidence with sources", "Free plan, no card"],
    shortLabel: "For Software Agencies",
    sections: `
<section><div class="wrap">
  <h2>Selling software projects is a trust sale</h2>
  <p class="sec-sub">Nobody signs a custom development engagement from a cold catalogue. The buyer is a founder or operations head with a process that hurts; the sale happens over weeks of credible conversation. That is bad news for bulk blasts and bidding portals — and exactly the terrain where a small agency with researched, specific outreach beats bigger names.</p>
  <div class="feat">
    <div class="ft"><b>The buyer is a person, not a company</b><p>A 120-person logistics firm doesn't buy software; its operations director does. Knowing who, and what their month looks like, is half the sale.</p></div>
    <div class="ft"><b>Pain is visible before the RFP</b><p>Hiring a fourth support executive, scaling a manual process, launching a second product — the signals that precede a build are public and dated, if someone is looking.</p></div>
    <div class="ft"><b>Portals commoditise you</b><p>On a bidding portal your senior team competes with a price list. In an originated conversation you're the specialist who noticed something true.</p></div>
    <div class="ft"><b>Long cycles leak</b><p>A warm prospect in week two goes cold by week nine because nobody owned the follow-up. Software sales die of silence more than of rejection.</p></div>
  </div>
</div></section>
<section><div class="wrap">
  <h2>Company research built for a software pitch</h2>
  <p class="sec-sub">Describe your ideal client — <i>“SMEs and startups, 20–500 people, in India or the US, running operations-heavy businesses: logistics, healthcare, education, D2C”</i> — and Client Radar reads each company's own website against it: what they do, how big they are, what they're hiring for, what changed recently. Each finding is dated and carries its source; what the AI infers (“a growing support team may mean repetitive tickets worth automating”) is labelled as inference, never dressed as fact. Decision makers publicly named are surfaced with the page they came from. Searches run across whichever countries you choose, so a Bengaluru team can prospect Mumbai and Boston in the same week.</p>
  <div class="callout honest"><b>What stays yours</b><p>Scoping, estimating and closing stay your craft; DealInSec doesn't promise projects, replies or contacts for every company. The free plan includes ${OB.free.monthlySearches} searches every ${OUTBOUND_WINDOW_DAYS} days (up to ${OB.free.maxCompanies} companies each); Pro ${OB.pro.monthlySearches} (up to ${OB.pro.maxCompanies}). Research is never unlimited.</p></div>
</div></section>
<section><div class="wrap">
  <h2>First messages a technical founder would send</h2>
  <p class="sec-sub">Mika drafts from the verified facts on each company — the hiring post, the launch, the process their own pages describe — in the shape that works for considered sales: one observation, one plausible connection framed as a question, one line of proof, a small ask. Your team edits and approves the exact text and sends it from your own email or LinkedIn. Nothing sends automatically, and follow-ups — where most software deals are actually won — are drafted when due for the same approval. See <a href="/blog/how-to-research-a-company-before-outreach">researching a company before outreach</a> and <a href="/blog/personalized-cold-email">the personalised cold email structure</a>.</p>
</div></section>
<section><div class="wrap">
  <h2>Weeks-long deals, tracked like engineering work</h2>
  <p class="sec-sub">Every prospect is a lead with a stage, an owner, the recorded evidence and a follow-up date — so the week-nine silence never happens by accident. <a href="/ai-coworkers">Zee briefs the team daily</a> on due follow-ups and waiting drafts; Nibo keeps scheduled research filling the funnel during delivery crunches; and Pro's ${PRO_INCLUDED_SEATS} seats make it the team's pipeline, not a founder's spreadsheet. For overseas motion specifics: <a href="/blog/find-international-clients-from-india">finding international clients from India</a>.</p>
</div></section>`,
    faq: [
      {
        q: "How does DealInSec help a software agency find clients?",
        a: "It researches companies against your ideal-client profile — reading each company's own website, scoring fit, surfacing dated signals like hiring, launches and scaling operations, with sources — and drafts personalised first messages from those verified facts. Your team approves and sends everything itself, and tracks the long sales cycle on a shared pipeline.",
      },
      {
        q: "We sell big-ticket custom builds. Does cold outreach even work for that?",
        a: "Bulk blasts don't; researched, specific, person-to-person notes do — big engagements still begin with one credible conversation. DealInSec's role is making each conversation researched (evidence with dates and sources) and making the weeks of follow-up systematic, which is where considered sales are usually lost.",
      },
      {
        q: "Can it find CTOs or operations heads to write to?",
        a: "It surfaces decision makers where they are publicly named — on the company's site or public pages — with the source shown. It doesn't buy, scrape or invent personal contact data; where no contact is public, it says so and the company's own channels are the route.",
      },
      {
        q: "Does it work for international prospecting?",
        a: "Yes. Each search targets the countries you choose — the US, the UK, Canada, Australia, the UAE, India and others — which suits agencies running an India-plus-one-overseas-market motion.",
      },
      {
        q: "Will it ever send something without us?",
        a: "No. Drafts become messages only after a person approves the exact text, and sending happens from your own email, WhatsApp or LinkedIn. The do-not-contact list is checked before drafting. This is a product rule — your agency's name is on every message.",
      },
      {
        q: "What does it cost?",
        a: `The free plan is permanent and needs no card: ${OB.free.monthlySearches} Client Radar searches every ${OUTBOUND_WINDOW_DAYS} days, ${OB.free.monthlyDrafts} AI drafts, pipeline and coworkers. Pro is ₹${PRICING.proMonthlyInr} a month in India with ${OB.pro.monthlySearches} searches, ${OB.pro.monthlyDrafts} drafts, unlimited deals and ${PRO_INCLUDED_SEATS} seats — paid monthly, no auto-renewal.`,
      },
    ],
  },

  /* ── /for-ai-automation-consultants — AI/automation specialists ────────── */
  {
    path: "/for-ai-automation-consultants",
    region: "IN",
    updated: "2026-11-12",
    metaTitle: "Find Clients for AI Automation Services",
    description:
      "How AI automation consultants and agencies in India find clients with DealInSec: research that spots manual, repetitive processes in growing businesses, labelled inferences with sources, and outreach you approve and send.",
    h1: "Find businesses whose manual work is your next project",
    sub: "You sell time back — but the businesses drowning in manual processes aren't searching for “AI automation consultant”. Client Radar finds growing companies and reads their own pages for the signals of repetitive work, labels every inference honestly, and you approve and send each message yourself.",
    chips: ["For AI automation consultants", "Process-pain signals", "Inference labelled as inference", "You send every message", "Free plan, no card"],
    shortLabel: "For AI Automation",
    sections: `
<section><div class="wrap">
  <h2>Your market doesn't know your category exists</h2>
  <p class="sec-sub">The clinic re-typing bookings into three systems, the exporter answering the same forty WhatsApp questions, the D2C brand with a support team growing faster than sales — they experience pain, not “a need for AI automation”. They won't find you by searching. You find them by spotting, from the outside, the shape of repetitive work — and starting an honest conversation about it.</p>
  <div class="feat">
    <div class="ft"><b>Demand is latent</b><p>Nobody budgets for a category they can't name. The sale starts with showing a specific business its own specific time-sink — which takes research, not ads.</p></div>
    <div class="ft"><b>Hype has salted the field</b><p>Founders get ten “AI will transform your business” blasts a week. Credibility now belongs to the message that names one concrete process and asks one modest question.</p></div>
    <div class="ft"><b>Guessing wrong is fatal</b><p>Tell a company it “clearly struggles with manual invoicing” when it doesn't, and you're spam. Automation outreach must keep observed facts and inferences rigorously apart.</p></div>
    <div class="ft"><b>Every niche is yours — so none is</b><p>Automation sells everywhere, which makes targeting everything tempting and fatal. A profile — industry, size, process — is what turns searches into conversations.</p></div>
  </div>
</div></section>
<section><div class="wrap">
  <h2>Research that respects the line between fact and inference</h2>
  <p class="sec-sub">Describe who you automate for — <i>“operations-heavy SMEs in India, 10–200 people: clinics, logistics, coaching institutes, D2C brands”</i> — and Client Radar reads each company's own site against it. The facts come dated and sourced: hiring three support executives, opening a second branch, a catalogue that doubled. The automation-shaped reading — “a growing support team may be handling repetitive status questions” — is shown as a <b>labelled inference</b>, kept apart from evidence, because that distinction is exactly what keeps your outreach credible in a hype-soaked inbox.</p>
  <div class="callout honest"><b>Built-in honesty, because your pitch needs it</b><p>Sources on every finding, unknowns shown as unknowns, no invented contacts, and no promise of clients or replies. Free: ${OB.free.monthlySearches} searches every ${OUTBOUND_WINDOW_DAYS} days (up to ${OB.free.maxCompanies} companies each); Pro: ${OB.pro.monthlySearches} (up to ${OB.pro.maxCompanies}). Research is never unlimited.</p></div>
</div></section>
<section><div class="wrap">
  <h2>Outreach that sounds like a consultant, not a gold rush</h2>
  <p class="sec-sub">Mika drafts from the verified facts and frames the automation angle as a question: <i>“Saw you're hiring a third support executive for the Pune warehouse — congrats. Teams at that stage often spend hours on repeated status queries; is that true for you? I automate exactly that for logistics firms.”</i> You edit, approve the exact text and send from your own email or WhatsApp; follow-ups draft when due for the same approval. Nothing sends itself. Structure and examples: <a href="/blog/personalized-cold-email">the personalised cold email guide</a>.</p>
</div></section>
<section><div class="wrap">
  <h2>From first reply to scoped pilot</h2>
  <p class="sec-sub">Automation deals move through discovery calls and small pilots — weeks where follow-up discipline is the whole game. Leads hold the evidence, the stage and the next date; <a href="/ai-coworkers">Zee's briefing</a> surfaces what's due; Nibo keeps scheduled research running while you deliver. And you'll recognise the product's own ethic — an AI that does the legwork while a person approves everything that matters is precisely what you sell. Wider system: <a href="/blog/how-to-find-clients-as-a-freelancer-in-india">the client-finding system</a>.</p>
</div></section>`,
    faq: [
      {
        q: "How does DealInSec find clients for an AI automation consultant?",
        a: "You describe the businesses and processes you automate, and Client Radar researches companies against that profile: dated, sourced facts from each company's own pages (hiring, growth, expanding operations) plus clearly labelled inferences about where repetitive work may live. You decide who is worth contacting, approve a draft grounded in those facts, and send it yourself.",
      },
      {
        q: "Won't my outreach drown in the AI hype flood?",
        a: "Generic AI pitches do drown. What survives is specificity: a message naming one true, dated fact about the business and asking one modest question about one concrete process. That is the shape DealInSec's research and drafting push you toward — and why inferences are labelled, so you never assert what you haven't verified.",
      },
      {
        q: "Does it identify which processes a company should automate?",
        a: "It surfaces signals — roles being hired, how the business describes its own operations — and offers possible readings, always labelled as inference. The actual process discovery is your discovery call; presenting a guess as a diagnosis would be dishonest, and the product refuses to do it.",
      },
      {
        q: "Can I prospect internationally?",
        a: "Yes. Searches target whichever countries you choose — the US, the UK, Canada, Australia, the UAE, India and others — and local mode lists businesses in a specific city for local automation work.",
      },
      {
        q: "Does DealInSec send messages or run campaigns on its own?",
        a: "Never. Every message — first touch and follow-up — is approved as exact text by you and sent from your own email, WhatsApp or LinkedIn, with a do-not-contact list checked first.",
      },
      {
        q: "What does it cost?",
        a: `Free forever to start, no card: ${OB.free.monthlySearches} searches every ${OUTBOUND_WINDOW_DAYS} days, ${OB.free.monthlyDrafts} AI drafts, pipeline and AI coworkers. Pro is ₹${PRICING.proMonthlyInr} a month in India with larger allowances and ${PRO_INCLUDED_SEATS} team seats, paid monthly with no auto-renewal.`,
      },
    ],
  },

];

/* ── Rendering ─────────────────────────────────────────────────────────── */

const THREAD_HIGHLIGHT: Record<string, ThreadStep> = {
  "/find-local-clients": "find",
  "/for-web-developers": "find",
  "/for-seo-freelancers": "find",
  "/for-digital-marketing-agencies": "find",
  "/for-web-development-agencies": "find",
  "/for-software-agencies": "find",
  "/for-ai-automation-consultants": "find",
  "/crm-for-freelancers": "lead",
  "/quotation-software": "quote",
  "/contract-management": "contract",
  "/proposal-management": "quote",
  "/invoice-management": "invoice",
  "/e-signature": "contract",
};

/** Renders any category/comparison page. `siblings` are the pages to show under
 *  "The rest of the thread" (the pillar is always added). */
export function renderCategoryPage(p: CategoryPage, siblings: RelatedLink[]): string {
  const url = SITE_ORIGIN + p.path;
  const offers =
    p.region === "IN"
      ? [
          { "@type": "Offer", name: "DealInSec Pro", price: String(PRICING.proMonthlyInr), priceCurrency: "INR", description: `Pro plan ₹${PRICING.proMonthlyInr}/month; free plan available` },
        ]
      : // Never advertise a price that cannot be bought from where the reader is. The description leads with client
        // research, because this is the entity description answer engines read off /about and the global pages.
        [{ "@type": "Offer", name: "Free plan", price: "0", priceCurrency: "USD", description: `${OB.free.monthlySearches} Client Radar searches every ${OUTBOUND_WINDOW_DAYS} days, ${OB.free.monthlyDrafts} AI outreach drafts you approve and send yourself, the leads pipeline, and the whole deal-to-invoice flow with no monthly cap. Available in every country.` }];
  const jsonLd: object[] = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "DealInSec",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description: p.description,
      url,
      offers,
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE_ORIGIN + "/" },
        { "@type": "ListItem", position: 2, name: p.shortLabel, item: url },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: p.faq.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
    ...(p.extraJsonLd ?? []),
  ];

  const ogImg = p.ogImage
    ? `<meta property="og:image" content="${SITE_ORIGIN}${esc(p.ogImage.src)}" />
<meta property="og:image:width" content="${p.ogImage.w}" />
<meta property="og:image:height" content="${p.ogImage.h}" />
<meta property="og:image:alt" content="${esc(p.ogImage.alt)}" />
<meta name="twitter:image" content="${SITE_ORIGIN}${esc(p.ogImage.src)}" />`
    : "";
  const chips = p.chips.map((c) => `<span class="chip">${esc(c)}</span>`).join("");
  const faqHtml = p.faq.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join("");

  const body = `
<div class="hero"><div class="wrap">
  <h1>${esc(p.h1)}</h1>
  <p class="sub">${esc(p.sub)}</p>
  <div class="hero-ctas">
    <a class="btn" href="${SIGNUP}" data-cta>Get started free →</a>
    <a class="btn ghost" href="/tools">Try the free tools</a>
  </div>
  <div class="chips">${chips}</div>
</div></div>
${threadSection(THREAD_HIGHLIGHT[p.path] ?? "none")}
${p.path === "/ai-coworkers" ? "" : aiTeamSection()}
${p.sections}
<section><div class="wrap faq">
  <h2>Frequently asked questions</h2>
  ${faqHtml}
</div></section>
${relatedSection(p.path, siblings)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(p.metaTitle)} | DealInSec</title>
<meta name="description" content="${esc(p.description)}" />
<link rel="canonical" href="${url}" />
<meta name="robots" content="index,follow,max-image-preview:large" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${esc(p.metaTitle)} | DealInSec" />
<meta property="og:description" content="${esc(p.description)}" />
<meta property="og:url" content="${url}" />
<meta property="og:site_name" content="DealInSec" />
<meta name="twitter:card" content="${p.ogImage ? "summary_large_image" : "summary"}" />
<meta name="twitter:title" content="${esc(p.metaTitle)} | DealInSec" />
<meta name="twitter:description" content="${esc(p.description)}" />
${ogImg}
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="icon" href="/favicon.ico" sizes="any" />
${FONT_HEAD}
${gaSnippet()}
${STYLES}
${jsonLd.map((b) => `<script type="application/ld+json">${JSON.stringify(b).replace(/</g, "\\u003c")}</script>`).join("\n")}
</head>
<body>
${header()}
<main>${body}</main>
${ctaBand(p.region)}
${footer(p.region)}
</body>
</html>`;
}

/* ── Public wiring ─────────────────────────────────────────────────────── */

/** Paths for the sitemap (the SW/router exclusion list lives in shared/ssr-paths.ts). */
export const CATEGORY_PATHS = PAGES.map((p) => p.path);

export function categorySitemapPaths(): string[] {
  return CATEGORY_PATHS;
}

export function registerCategoryPages(app: Express) {
  for (const p of PAGES) {
    // A global page is related only to other global pages (the pillar is always
    // added): the India pages are written for India and must not appear on a page
    // that carries no India framing. India pages may link to everything.
    const siblings = p.region === "global" ? PAGES.filter((x) => x.region === "global") : PAGES;
    app.get(p.path, (_req, res) => res.type("html").send(renderCategoryPage(p, siblings)));
  }
}
