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
 * so nothing here may link to it. Pricing on every page: Free ₹0 (4 deals a
 * month, quotations only — agreements, invoices and payment tracking are Pro
 * via requirePro), Pro ₹99/month or ₹999/year. No founding offer, no Deal
 * Boost, no team seats in marketing copy.
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
import { esc, SITE_ORIGIN, LOGO_SVG, gaSnippet } from "./tools/layout";

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
  body{margin:0;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg);line-height:1.65;-webkit-font-smoothing:antialiased}
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
  .brand{display:inline-flex;align-items:center;gap:10px;font-size:18px;font-weight:700;line-height:1;letter-spacing:-.025em;color:#171717}
  .brand:hover{text-decoration:none}
  .logo{flex-shrink:0;filter:drop-shadow(0 1px 1px rgba(0,0,0,.05))}
  .brand-accent{background:linear-gradient(135deg,#059669 0%,#0D9488 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:#0D9488}
  .nav{display:none;align-items:center;gap:2px}
  @media(min-width:820px){.nav{display:flex}}
  .nav a{padding:8px 14px;border-radius:10px;font-size:14px;font-weight:600;color:var(--muted)}
  .nav a:hover{color:var(--ink);background:hsl(210 20% 93%);text-decoration:none}
  footer.site{background:#fff;border-top:1px solid var(--line);padding:34px 0;color:var(--muted);font-size:14px}
  footer.site .links{display:flex;gap:18px;flex-wrap:wrap;margin-bottom:10px}
  .muted{color:var(--muted)}

  .hero{padding:56px 0 26px;text-align:center}
  .hero h1{font-size:clamp(28px,4.8vw,44px);font-weight:800;letter-spacing:-.02em;max-width:820px;margin:0 auto 12px}
  .hero p.sub{font-size:clamp(16px,2.2vw,19px);color:var(--muted);max-width:680px;margin:0 auto 22px}
  .hero-ctas{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
  .chips{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin:22px 0 0}
  .chip{font-size:13px;font-weight:600;color:var(--accent-fg);background:var(--accent-bg);border:1px solid var(--accent-line);border-radius:999px;padding:6px 12px}

  section{padding:26px 0}
  section h2{font-size:clamp(21px,3vw,27px);font-weight:800;letter-spacing:-.01em}
  section p,section li{font-size:16px;color:var(--ink)}
  .sec-sub{color:var(--muted);max-width:720px}

  .thread{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:18px}
  @media(max-width:860px){.thread{grid-template-columns:1fr 1fr}}
  @media(max-width:520px){.thread{grid-template-columns:1fr}}
  .th-card{background:var(--card);border:1px solid var(--card-line);border-radius:16px;padding:20px;box-shadow:0 1px 2px rgba(16,24,40,.04)}
  .th-card .n{width:32px;height:32px;border-radius:50%;background:var(--accent-bg);color:var(--accent-fg);font-weight:800;display:grid;place-items:center;margin-bottom:10px;font-size:14px}
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
  .cta-band h2{color:#fff;font-size:clamp(22px,3.5vw,30px);font-weight:800;margin:0 0 8px}
  .cta-band p{color:#DCFCE7;max-width:600px;margin:0 auto 20px;font-size:16px}
  .cta-band .btn{background:#fff;color:var(--green-d)}
  .cta-band .btn:hover{background:#F0FDF4}
  .cta-band .sub-note{display:block;color:#A7F3D0;font-size:13px;margin-top:12px}
</style>`;

function header(): string {
  return `<header class="site"><div class="wrap">
    <a class="brand" href="/" aria-label="DealInSec home">${LOGO_SVG}<span class="brand-text">Deal<span class="brand-accent">insec</span></span></a>
    <nav class="nav">
      <a href="/">Product</a>
      <a href="/for-freelancers">Freelancers</a>
      <a href="/for-creators">Creators</a>
      <a href="/tools">Free Tools</a>
      <a href="/blog">Blog</a>
      <a href="/#pricing">Pricing</a>
    </nav>
    <a class="btn" href="${SIGNUP}">Start free →</a>
  </div></header>`;
}

function footer(region: "IN" | "global"): string {
  const tagline =
    region === "IN"
      ? "for India's freelancers: quotation, e-signed agreement, invoice and payment tracking on one thread per client."
      : "for freelancers and creators worldwide: quotation, e-signed agreement, invoice and payment tracking on one thread per client or brand.";
  return `<footer class="site"><div class="wrap">
    <div class="links">
      <a href="/">Product</a>
      <a href="/freelance-business-management-software">Freelance Business Management</a>
      <a href="/for-freelancers">For Freelancers</a>
      <a href="/for-creators">For Creators</a>
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
    </div>
    <div class="muted">© 2026 DealInSec — ${tagline}</div>
  </div></footer>`;
}

function ctaBand(region: "IN" | "global"): string {
  const sub =
    region === "IN"
      ? "Quotation, e-signed scope, invoices and payment follow-up that always agree with each other — built for India's freelancers."
      : "Quotation, e-signed scope, invoices and payment follow-up that always agree with each other — built for freelancers and creators, wherever you bill from.";
  const note =
    region === "IN"
      ? "No card required · Free plan after the trial · Pro ₹99/month or ₹999/year"
      : "No card required · Free plan and 7-day Pro trial in every country · Paid plans currently available in India";
  return `<div class="cta-band"><div class="wrap">
    <h2>One client. One thread. Zero retyping.</h2>
    <p>${sub}</p>
    <a class="btn" href="${SIGNUP}" data-cta>Start your 7-day free trial →</a>
    <span class="sub-note">${note}</span>
  </div></div>`;
}

/** The quote → agreement → invoice → payment walk, highlighting this page's step. */
function threadSection(highlight: "quote" | "contract" | "invoice" | "track" | "none"): string {
  const steps: { key: string; n: string; title: string; body: string }[] = [
    { key: "quote", n: "1", title: "Quotation", body: "Generated from the deal record — itemised deliverables, revision rounds, terms, a stable number (QT-series) and a clean PDF in your name." },
    { key: "contract", n: "2", title: "Agreement", body: "The accepted quotation becomes an agreement with the same figures. Electronic acceptance is recorded — who, when, which signature." },
    { key: "invoice", n: "3", title: "Invoice", body: "Billed from the agreement — advance/balance or milestones — and DealInSec won't let you invoice more than the agreement is worth." },
    { key: "track", n: "4", title: "Payment tracking", body: "Overdue, due this week, ready to invoice — the dashboard tells you what to bill and what to chase today." },
  ];
  const cards = steps
    .map((s) => `<div class="th-card${s.key === highlight ? " hl" : ""}"><div class="n">${s.n}</div><b>${s.title}</b><p>${s.body}</p></div>`)
    .join("");
  return `<section><div class="wrap">
    <h2>One thread from quotation to payment</h2>
    <p class="sec-sub">Every document is generated from the one before it, so the numbers never drift between your quotation, your agreement and your invoice.</p>
    <div class="thread">${cards}</div>
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
      "For India's freelancers: quotation, e-signed scope, advance & milestone invoices with your PAN/GSTIN, and payment reminders drafted in English or Hinglish — on one thread per client. Free plan; Pro ₹99/month.",
    h1: "Invoice software for Indian freelancers who are tired of chasing payments",
    sub: "For India's freelancers — designers, developers, writers, video editors & photographers, marketers and consultants. Quote the work, get the scope accepted in writing, bill the advance and milestones, and follow up on late payments — one thread per client, ₹99/month.",
    chips: ["Advance + milestone billing", "Signed, timestamped scope", "Reminders in English or Hinglish", "Pro ₹99/month · free plan", "7-day trial · no card"],
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
    <tr><td><b>Your details</b></td><td>PAN and GSTIN typed in again</td><td>PAN and GSTIN from your profile on every document — GST-ready</td></tr>
    <tr><td><b>Getting paid</b></td><td>You remember, then chase awkwardly</td><td>Overdue list, plus a drafted reminder in the tone you pick</td></tr>
    <tr><td><b>Cost</b></td><td>—</td><td>Free plan for quotations; Pro ₹99/month or ₹999/year</td></tr>
  </table></div>
  <div class="callout honest"><b>What it costs, plainly</b><p>Free is ₹0: 4 deals a month, each with its quotation. Pro is ₹99/month, or ₹999/year (about ₹83/month — ₹189 less than paying monthly), and adds e-signed agreements, invoices, payment tracking and unlimited deals. Every account starts with a 7-day Pro trial, no card. DealInSec takes no percentage of your project value. Just need one invoice today? The <a href="/tools/gst-invoice-generator">free GST invoice generator</a> and <a href="/tools/quotation-maker">quotation maker</a> need no sign-up.</p></div>
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
        a: "Free is ₹0 for 4 deals a month, each with its quotation. Pro is ₹99/month or ₹999/year (about ₹83/month) and adds e-signed agreements, invoices, payment tracking and unlimited deals. Every new account gets a 7-day Pro trial with no card, and DealInSec takes no percentage of your project value.",
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
      "A Refrens alternative for Indian freelancers who want the whole client deal on one thread: quotation → e-signed scope → advance & milestone invoices → payment follow-up. Honest comparison. Pro ₹99/month; free 7-day trial, no card.",
    h1: "Looking for a Refrens alternative?",
    sub: "Refrens is a solid invoicing and quotation platform. DealInSec is built for a different job — running each client deal a freelancer takes on, from quotation to accepted scope to milestone invoices to getting paid, on one thread.",
    chips: ["Built for freelancers", "Quote → signed scope → invoice", "Pro ₹99/month", "Free 7-day trial · no card"],
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
    <tr><td><b>Pricing</b></td><td>See their site</td><td>Free plan; Pro ₹99/month or ₹999/year</td></tr>
    <tr><td><b>Best for</b></td><td>Fast, broad invoicing &amp; accounting</td><td>Freelancers who want the scope signed and the payment followed up</td></tr>
  </table></div>
  <p class="muted" style="font-size:14px;margin-top:10px">Refrens is a capable product — check their site for current features and pricing. Pick the tool that matches how your work actually runs.</p>
</div></section>`,
    faq: [
      {
        q: "Is DealInSec a free Refrens alternative?",
        a: "DealInSec has a free plan (4 deals a month, each with its quotation) and a 7-day Pro trial with no card, plus free no-sign-up tools (GST invoice, quotation maker, bill maker). Agreements, invoices and payment tracking are on Pro at ₹99/month or ₹999/year. It isn't a clone of Refrens, though — it's built to run the whole deal, not just billing, so compare on the job you need done.",
      },
      {
        q: "Why would a freelancer choose DealInSec over Refrens?",
        a: "Choose DealInSec if your work is deal-shaped — you quote, get the scope accepted, deliver in stages and chase payment — and you want those documents on one consistent thread with e-signed agreements and scope-creep checks. Choose Refrens if your main need is fast, broad invoicing and accounting. They're built for different jobs.",
      },
      {
        q: "Can I switch from Refrens to DealInSec?",
        a: "Yes — start with the free trial and run one live client deal end to end (quotation → agreement → invoice) to see if the thread fits how you work. Keep using whatever handles the rest of your accounting.",
      },
    ],
  },

  /* ── /vyapar-alternative — buying-intent comparison ──────────────────── */
  {
    path: "/vyapar-alternative",
    region: "IN",
    metaTitle: "Vyapar Alternative for Freelancers (India)",
    description:
      "A Vyapar alternative for freelancers, not shops: DealInSec runs client deals — quotation, e-signed scope, milestone invoices and payment follow-up — instead of inventory-based GST billing. Honest comparison. Pro ₹99/month; free trial, no card.",
    h1: "Looking for a Vyapar alternative?",
    sub: "Vyapar is excellent GST billing and inventory software for shops and product businesses. If you're a freelancer — you sell design, code, words, edits or advice, not stock — DealInSec is built for the way you actually get paid.",
    chips: ["For freelancers, not shops", "Quote → signed scope → invoice", "Pro ₹99/month", "Free 7-day trial · no card"],
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
    <tr><td><b>Pricing</b></td><td>See their site</td><td>Free plan; Pro ₹99/month or ₹999/year</td></tr>
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
        a: "DealInSec. Freelance work is about scope, the client's acceptance and getting paid per milestone — not inventory. That's exactly what DealInSec is built for: a free plan for quotations, Pro at ₹99/month, and a 7-day trial with no card.",
      },
    ],
  },

  /* ── /quotation-software ─────────────────────────────────────────────── */
  {
    path: "/quotation-software",
    region: "IN",
    metaTitle: "Quotation Software for Freelancers in India",
    description:
      "Online quotation software for Indian freelancers: itemised quotes with GST, revision rounds and advance terms, numbered PDFs in your name — and each accepted quote converts into an agreement and invoice. Free plan; Pro ₹99/month.",
    h1: "Quotation software that doesn't stop at the quotation",
    sub: "Make professional, numbered quotations for your clients in minutes — then convert the accepted quote into an e-signed agreement and an invoice with the same figures, automatically.",
    chips: ["Made for freelancers", "GST-ready", "Free plan · 4 deals a month", "Pro ₹99/month"],
    shortLabel: "Quotation Software",
    sections: `
<section><div class="wrap">
  <h2>Why quotations made in Excel, Word or a WhatsApp message go wrong</h2>
  <p class="sec-sub">The quotation itself is easy. What breaks is everything after it: the client negotiates on a call, the discount never gets written down, the agreement says one number and the invoice another — and when payment is late, nobody can find the version the client actually accepted.</p>
  <div class="feat">
    <div class="ft"><b>Itemised, numbered, consistent</b><p>Quotations are generated from the deal record — deliverables, quantities, rates, terms — with a stable QT-series number and a clean PDF that carries your name, not ours.</p></div>
    <div class="ft"><b>Revisions with history</b><p>Client negotiated? Issue a revised version. The version the client accepted is the one your agreement and invoice inherit.</p></div>
    <div class="ft"><b>Terms that carry forward</b><p>Advance percentage, balance timeline, revision rounds, validity — set once on the deal, printed on the quotation, carried into the agreement so the documents never contradict each other.</p></div>
    <div class="ft"><b>Quotation tracking</b><p>See which quotations are outstanding, accepted or expiring from the dashboard — the follow-up happens before the validity runs out.</p></div>
  </div>
  <div class="callout honest"><b>Just need one quotation right now?</b><p>Use the <a href="/tools/quotation-maker">free online quotation maker</a> — no sign-up, GST-ready, instant PDF. The software is for when you're quoting new clients every month, not once a year.</p></div>
</div></section>
<section><div class="wrap">
  <h2>Quotation software vs Excel</h2>
  <div class="tbl-scroll"><table class="cmp">
    <tr><th></th><th>Excel / Word</th><th>DealInSec</th></tr>
    <tr><td><b>Math &amp; GST</b></td><td>Manual — the classic source of embarrassing errors</td><td>Computed, with Indian formatting (₹1,35,000)</td></tr>
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
        a: "Two, honestly: the free quotation maker tool needs no account at all, and every new DealInSec account starts with a 7-day Pro trial (no card) followed by a free plan covering 4 deals a month, each with a quotation.",
      },
      {
        q: "Does it handle GST on quotations?",
        a: "Yes — quotations can show GST so the client sees the final payable amount. Note that a quotation is not a tax document; tax applies on the invoice. For a GST tax invoice with CGST/SGST/IGST computation, use the free GST invoice generator.",
      },
      {
        q: "Is it built for freelancers in India?",
        a: "Yes — it's made for India's freelancers: designers, developers, writers, video editors & photographers, marketers and consultants. Indian number formatting, GST-ready documents, your PAN/GSTIN on your papers, and pricing in rupees: a free plan, then Pro at ₹99/month or ₹999/year.",
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
      "Contract management for Indian freelancers: agreements generated from accepted quotations, electronic acceptance with an audit record, statuses, and linked invoices. Pro ₹99/month; free 7-day trial, no card.",
    h1: "Contract management software for freelancers",
    sub: "Your agreement is generated from the accepted quotation — same scope, same figures — accepted electronically by your client with an audit record, and linked to the invoices it authorises.",
    chips: ["Electronic acceptance + audit record", "Made for freelancers", "Free 7-day trial · no card"],
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
        a: "Agreements are part of Pro: ₹99/month or ₹999/year, with unlimited deals, agreements, invoices and payment tracking. Every new account starts with a 7-day Pro trial with no card; after that the free plan covers 4 deals a month with quotations.",
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
      "Proposal management for Indian freelancers: itemised, priced proposals (quotations) with revision rounds and advance terms, tracked to acceptance and converted into e-signed agreements and invoices. Free 7-day trial.",
    h1: "Proposal management, the quotation-first way",
    sub: "For a freelancer, your proposal is a priced scope with terms — a quotation. DealInSec manages that proposal from first draft to accepted, signed and invoiced.",
    chips: ["Priced proposals with terms", "Tracked to acceptance", "Free 7-day trial · no card"],
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
        a: "On Pro (₹99/month or ₹999/year), the accepted proposal becomes an agreement with the same figures, accepted electronically with an audit record, and then invoices — an advance/balance split or milestones — bounded by the agreement's value.",
      },
    ],
  },

  /* ── /invoice-management ─────────────────────────────────────────────── */
  {
    path: "/invoice-management",
    region: "IN",
    metaTitle: "Invoice Management Software for Freelancers in India",
    description:
      "Invoice management for Indian freelancers: invoices generated from agreements, consecutive numbering per financial year, paid/unpaid tracking with dates, and a dashboard of what to bill and chase. Pro ₹99/month; free 7-day trial.",
    h1: "Invoice management software that knows what you're owed",
    sub: "Invoices generated from the agreement — never more than it's worth — numbered consecutively per financial year, tracked from sent to paid, with a dashboard of what to bill and what to chase today.",
    chips: ["INV-series per financial year", "Paid/unpaid with dates", "Made for freelancers", "Free 7-day trial"],
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
        a: "The free plan covers 4 deals a month, each with its quotation. Invoices, agreements and payment tracking are Pro — ₹99/month, or ₹999/year (about ₹83/month). Every new account gets a 7-day Pro trial with no card, so you can raise real invoices before deciding.",
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
      "E-signature for Indian freelancers: your client accepts the agreement electronically with an audit record — who signed, when, with which signature — built into the quotation-to-invoice workflow. Honest about what it is. Pro ₹99/month; free 7-day trial.",
    h1: "E-signature built into the deal, not bolted on",
    sub: "Your client accepts the agreement electronically with an audit record — who, when, which signature — and the signed document links straight to the quotation before it and the invoices after it.",
    chips: ["Audit record on the document", "Section 10A, IT Act 2000", "Free 7-day trial · no card"],
    shortLabel: "E-Signature",
    sections: `
<section><div class="wrap">
  <h2>Signature tools sign documents. This one closes deals.</h2>
  <p class="sec-sub">Standalone e-sign tools give you a signed PDF — and then the signed scope still has to be retyped into an invoice. In DealInSec, signing is one step on a thread: the accepted quotation became this agreement, and the signed agreement authorises the invoices.</p>
  <div class="feat">
    <div class="ft"><b>Execution record on the face</b><p>The agreement prints who accepted it, when, and with which signature — plus your signature image and stamp where you've set them.</p></div>
    <div class="ft"><b>Client-friendly</b><p>Your client accepts electronically through a confirmation flow — the signed copy stays on record, and the printed document reflects the acceptance.</p></div>
    <div class="ft"><b>Signature binding</b><p>The signature captured at creation stays with the document — it doesn't change when someone else views or reprints it.</p></div>
    <div class="ft"><b>Priced for a freelancer</b><p>E-sign is part of Pro — ₹99/month or ₹999/year, with a 7-day free trial — rather than a separate per-envelope bill in dollars.</p></div>
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
        a: "E-signed agreements are part of Pro — ₹99/month or ₹999/year, with unlimited agreements. Every new account starts with a 7-day Pro trial with no card; the free plan after that covers 4 deals a month with quotations only.",
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
        a: "Yes. The free plan, which covers 4 deals a month with their quotations, and a 7-day Pro trial with no card are open in every country, in 50 currencies. Paid plans can currently be bought in India only.",
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
        a: "Yes. The free plan, which covers 4 deals a month with their quotations, and a 7-day Pro trial with no card are open in every country, in 50 currencies. Paid plans can currently be bought in India only.",
      },
      {
        q: "Is the brand's signature legally valid?",
        a: "The brand accepts the agreement electronically and DealInSec records who accepted it, when and with which signature. It is not a certificate-based digital signature. Whether an agreement is enforceable depends on its terms and the law that applies, and this is not legal advice.",
      },
    ],
  },

];

/* ── Rendering ─────────────────────────────────────────────────────────── */

const THREAD_HIGHLIGHT: Record<string, "quote" | "contract" | "invoice" | "track"> = {
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
          { "@type": "Offer", name: "Pro Monthly", price: "99", priceCurrency: "INR", description: "Pro plan ₹99/month; free plan and 7-day trial available" },
          { "@type": "Offer", name: "Pro Annual", price: "999", priceCurrency: "INR", description: "Pro plan ₹999/year (about ₹83/month)" },
        ]
      : // Never advertise a price that cannot be bought from where the reader is.
        [{ "@type": "Offer", name: "Free plan", price: "0", priceCurrency: "USD", description: "4 deals a month with quotations; 7-day Pro trial, in every country" }];
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
    <a class="btn" href="${SIGNUP}" data-cta>Start free trial →</a>
    <a class="btn ghost" href="/tools">Try the free tools</a>
  </div>
  <div class="chips">${chips}</div>
</div></div>
${threadSection(THREAD_HIGHLIGHT[p.path] ?? "none")}
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
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
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
