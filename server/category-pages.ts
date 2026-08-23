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
 * Same architecture as /tools and /blog: complete server-rendered HTML,
 * registered BEFORE the SPA catch-all. Every path here must ALSO be in
 * vite.config.ts navigateFallbackDenylist (and the NetworkFirst exclusion),
 * and in the landing page's plain-anchor checks — otherwise the PWA service
 * worker / wouter swallow the navigation.
 *
 * Copy rules (standing): no invented customers, counts or testimonials; no
 * "legally binding" claims — electronic acceptance with an audit record,
 * hedged, exactly as the product's own documents state it; in-app invoices
 * are NOT Rule-46 GST tax invoices and the invoice page says so plainly.
 */
import type { Express } from "express";
import { esc, SITE_ORIGIN, LOGO_SVG } from "./tools/layout";

const SIGNUP = "/auth?mode=signup&utm_source=category&utm_medium=page";

interface Faq {
  q: string;
  a: string;
}

interface CategoryPage {
  path: string;
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
      <a href="/tools">Free Tools</a>
      <a href="/blog">Blog</a>
      <a href="/#pricing">Pricing</a>
    </nav>
    <a class="btn" href="${SIGNUP}">Start free →</a>
  </div></header>`;
}

function footer(): string {
  return `<footer class="site"><div class="wrap">
    <div class="links">
      <a href="/">Product</a>
      <a href="/interior-design-software">For Interior Designers</a>
      <a href="/quotation-software">Quotation Software</a>
      <a href="/contract-management">Contract Management</a>
      <a href="/invoice-management">Invoice Management</a>
      <a href="/e-signature">E-Signature</a>
      <a href="/tools">Free Tools</a>
      <a href="/blog">Blog</a>
      <a href="/terms">Terms</a>
      <a href="/privacy">Privacy</a>
    </div>
    <div class="muted">© 2026 DealInSec — deal management software for India's service businesses: quotation, e-signed agreement, invoice and payment tracking on one thread.</div>
  </div></footer>`;
}

function ctaBand(): string {
  return `<div class="cta-band"><div class="wrap">
    <h2>One deal. One thread. Zero retyping.</h2>
    <p>Quotation, e-signed agreement, invoice and payment tracking that always agree with each other — built for India's service businesses.</p>
    <a class="btn" href="${SIGNUP}">Start your 7-day free trial →</a>
    <span class="sub-note">No card required · Free plan after the trial · ₹999/month or ₹9,999/year for Pro</span>
  </div></div>`;
}

/** The quote → agreement → invoice → payment walk, highlighting this page's step. */
function threadSection(highlight: "quote" | "contract" | "invoice" | "track" | "none"): string {
  const steps: { key: string; n: string; title: string; body: string }[] = [
    { key: "quote", n: "1", title: "Quotation", body: "Generated from the deal record — itemised deliverables, terms, a stable number (QT-series) and a clean PDF in your name." },
    { key: "contract", n: "2", title: "Agreement", body: "The accepted quotation becomes an agreement with the same figures. Electronic acceptance is recorded — who, when, which signature." },
    { key: "invoice", n: "3", title: "Invoice", body: "Billed from the agreement — advance/balance or milestones — and DealInSec won't let you invoice more than the agreement is worth." },
    { key: "track", n: "4", title: "Payment tracking", body: "Overdue, due this week, signed-but-not-invoiced — the dashboard tells you what is collectible today." },
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

function relatedSection(currentPath: string): string {
  const cards = PAGES.filter((p) => p.path !== currentPath)
    .map((p) => `<a class="rel-card" href="${esc(p.path)}">${esc(p.shortLabel)}<span>${esc(p.h1)}</span></a>`)
    .join("");
  return `<section><div class="wrap">
    <h2>The rest of the thread</h2>
    <div class="rel-grid">${cards}</div>
  </div></section>`;
}

/* ── Pages ─────────────────────────────────────────────────────────────── */

const PAGES: CategoryPage[] = [
  /* ── /interior-design-software — the sharp ICP wedge ──────────────────── */
  {
    path: "/interior-design-software",
    metaTitle: "Interior Design Software — Quotations, Agreements & Payments",
    description:
      "The deal & payment software for Indian interior designers: quotation → e-signed agreement → milestone invoices on one thread, scope-creep protection, and payment reminders. Paste a client's WhatsApp chat and it drafts the deal. Free 7-day trial, no card.",
    h1: "The deal & payment OS for interior designers",
    sub: "Quotation, e-signed agreement, milestone invoices and payment chasing on one thread — built for the way Indian interior studios actually run projects. Paste the client's WhatsApp chat; it drafts the deal.",
    chips: ["Made for interiors", "Milestone billing", "Scope-creep protection", "Free 7-day trial · no card"],
    shortLabel: "For Interior Designers",
    sections: `
<section><div class="wrap">
  <h2>Where interior projects leak money</h2>
  <p class="sec-sub">It's never the design that costs you — it's what happens around it. A ₹8 lakh project agreed on WhatsApp, "just one more change" a dozen times, an advance taken with no written scope, and a final payment that never comes because nobody can prove what was agreed. DealInSec closes every one of those gaps.</p>
  <div class="feat">
    <div class="ft"><b>Paste the chat, get the deal</b><p>Paste the client's WhatsApp conversation and the Copilot drafts the deal — client, rooms, scope, amount, advance terms. You confirm; it never invents a number you didn't say.</p></div>
    <div class="ft"><b>Scope-creep protection</b><p>Before you send, a Protection Check flags the gaps designers bleed on — no revision limit, no exclusions (civil work, furniture), no advance — and suggests the terms to add.</p></div>
    <div class="ft"><b>Milestone billing, bounded</b><p>Bill 50% advance, stage payments, balance on handover — each invoice tied to the signed agreement, and never more than the project is worth.</p></div>
    <div class="ft"><b>Payment chasing, in your voice</b><p>The Copilot drafts the follow-up for an overdue payment — English or Hinglish — using the real invoice number. You press send; it never messages a client on its own.</p></div>
  </div>
  <div class="callout honest"><b>Just need a quotation today?</b><p>Use the <a href="/tools/quotation-maker">free quotation maker</a> or grab a ready <a href="/tools/quotation-templates">interior quotation template</a> — no sign-up. The app is for when you're running projects every month and want them all on one thread.</p></div>
</div></section>
<section><div class="wrap">
  <h2>WhatsApp + Excel vs DealInSec</h2>
  <div class="tbl-scroll"><table class="cmp">
    <tr><th></th><th>WhatsApp + Excel + memory</th><th>DealInSec</th></tr>
    <tr><td><b>The scope</b></td><td>Agreed verbally, argued later</td><td>E-signed agreement with revision limits &amp; exclusions</td></tr>
    <tr><td><b>Extra work</b></td><td>"You said you'd change it for free"</td><td>A change-order quotation before it's executed</td></tr>
    <tr><td><b>Milestone invoices</b></td><td>Retyped each time, drift creeps in</td><td>Generated from the agreement, always consistent</td></tr>
    <tr><td><b>The final payment</b></td><td>Chased awkwardly, or never</td><td>The dashboard shows what's overdue; the Copilot drafts the nudge</td></tr>
  </table></div>
  <p class="muted" style="font-size:14px;margin-top:10px">Guides for interiors: <a href="/blog/quotation-format">interior quotation format</a> · <a href="/blog/fake-quotation">client not paying — the written-trail method</a>.</p>
</div></section>`,
    faq: [
      {
        q: "Is DealInSec built for interior designers?",
        a: "Yes — it's the sharpest fit. Interior projects are high-value and milestone-billed, with scope that shifts constantly, which is exactly what DealInSec manages: quotation → e-signed agreement → stage invoices on one thread, with scope-creep protection and payment tracking. It works for adjacent studios (architects, contractors, agencies) too.",
      },
      {
        q: "Can it handle stage-wise / milestone billing?",
        a: "Yes. Bill a 50% advance, stage payments, and a balance on handover — any split — with each invoice tied to the signed agreement, and DealInSec won't let you invoice more than the project is worth.",
      },
      {
        q: "How does it stop scope creep?",
        a: "Two ways: the agreement records the exact deliverables, revision limit and exclusions the client accepted; and the Protection Check flags when those are missing before you send. Extra work becomes a change-order quotation instead of a free favour.",
      },
      {
        q: "Does it create GST invoices for my studio?",
        a: "In-app invoices record the agreed value and print your PAN and GSTIN, but they are not Rule-46 GST tax invoices. For a GST tax invoice with CGST/SGST/IGST computed, use the free GST invoice generator — no sign-up.",
      },
      {
        q: "What does it cost?",
        a: "A 7-day Pro trial with no card, then a free plan covering 4 deals a month. Pro is ₹999/month or ₹9,999/year — less than one forgotten milestone invoice — with unlimited projects, agreements, invoices, payment tracking and 5 team seats.",
      },
    ],
  },

  /* ── /refrens-alternative — buying-intent comparison ─────────────────── */
  {
    path: "/refrens-alternative",
    metaTitle: "Refrens Alternative for Deal-Led Service Businesses (India)",
    description:
      "A Refrens alternative built for service businesses that run deals: quotation → e-signed agreement → milestone invoices → payment tracking on one thread, with scope-creep protection. Honest comparison. Free 7-day trial, no card.",
    h1: "Looking for a Refrens alternative?",
    sub: "Refrens is a solid invoicing and quotation platform. DealInSec is built for a different job — running the whole client deal, from quotation to signed agreement to milestone invoices to getting paid, on one thread.",
    chips: ["Made for India", "Deal → agreement → invoice", "Scope-creep protection", "Free 7-day trial · no card"],
    shortLabel: "Refrens Alternative",
    sections: `
<section><div class="wrap">
  <h2>When Refrens fits — and when DealInSec does</h2>
  <p class="sec-sub">This is an honest comparison, not a takedown. Both are made in India and priced in rupees; they're built for different jobs, and the right pick depends on how your work runs.</p>
  <div class="feat">
    <div class="ft"><b>Refrens is great when…</b><p>your main need is invoicing and quotations — a broad billing and accounting toolkit with a strong free tier, popular with freelancers who mostly send documents fast.</p></div>
    <div class="ft"><b>DealInSec is built when…</b><p>your work is deal-shaped: you quote, sign a scope, deliver in stages and chase payment. The quotation, agreement and invoices live on one record and can't drift apart.</p></div>
    <div class="ft"><b>The difference in one line</b><p>Refrens documents your billing; DealInSec runs the deal around it — e-signed agreements, scope-creep protection, and payment chasing built into the same thread.</p></div>
    <div class="ft"><b>Where DealInSec is sharpest</b><p>High-value, milestone-billed service work — interior design, architecture, agencies, consulting — where a forgotten invoice or unsigned scope costs real money.</p></div>
  </div>
</div></section>
<section><div class="wrap">
  <h2>Side by side</h2>
  <div class="tbl-scroll"><table class="cmp">
    <tr><th></th><th>Refrens</th><th>DealInSec</th></tr>
    <tr><td><b>Core job</b></td><td>Invoicing, quotations &amp; accounting</td><td>Running the whole client deal to payment</td></tr>
    <tr><td><b>Quotation</b></td><td>Yes</td><td>Yes — and it converts into the agreement &amp; invoice</td></tr>
    <tr><td><b>E-signed agreements</b></td><td>Focused on billing docs</td><td>Built in — acceptance recorded with an audit trail</td></tr>
    <tr><td><b>Scope-creep protection</b></td><td>—</td><td>Protection Check flags missing revision limits, exclusions, advance</td></tr>
    <tr><td><b>Payment chasing</b></td><td>Reminders</td><td>AI-drafted follow-ups (English/Hinglish), you send</td></tr>
    <tr><td><b>Best for</b></td><td>Freelancers wanting fast billing</td><td>Deal-led service businesses &amp; studios</td></tr>
  </table></div>
  <p class="muted" style="font-size:14px;margin-top:10px">Refrens is a capable product — check their site for current features and pricing. Pick the tool that matches how your work actually runs.</p>
</div></section>`,
    faq: [
      {
        q: "Is DealInSec a free Refrens alternative?",
        a: "DealInSec has a free plan (4 deals a month) and a 7-day Pro trial with no card, plus free no-sign-up tools (GST invoice, quotation maker, bill maker). It isn't a clone of Refrens, though — it's built to run the whole deal, not just billing, so compare on the job you need done.",
      },
      {
        q: "Why choose DealInSec over Refrens?",
        a: "Choose DealInSec if your work is deal-shaped — you quote, sign a scope, deliver in stages and chase payment — and you want those documents on one consistent thread with e-signed agreements and scope-creep protection. Choose Refrens if your main need is fast, broad invoicing and accounting. They're built for different jobs.",
      },
      {
        q: "Can I switch from Refrens to DealInSec?",
        a: "Yes — start with the free trial and run one live deal end to end (quotation → agreement → invoice) to see if the thread fits how you work. Keep using whatever handles the rest of your accounting.",
      },
    ],
  },

  /* ── /vyapar-alternative — buying-intent comparison ──────────────────── */
  {
    path: "/vyapar-alternative",
    metaTitle: "Vyapar Alternative for Service Businesses (India)",
    description:
      "A Vyapar alternative for service businesses, not shops: DealInSec runs client deals — quotation, e-signed agreement, milestone invoices and payment tracking — instead of inventory-based GST billing. Honest comparison. Free trial, no card.",
    h1: "Looking for a Vyapar alternative?",
    sub: "Vyapar is excellent GST billing and inventory software for shops and product businesses. If you sell services — design, consulting, agency work — not stock, DealInSec is built for the way you actually get paid.",
    chips: ["For service businesses", "Deal → agreement → invoice", "Made for India", "Free 7-day trial · no card"],
    shortLabel: "Vyapar Alternative",
    sections: `
<section><div class="wrap">
  <h2>Different tools for different businesses</h2>
  <p class="sec-sub">Honestly, if you run a shop with stock, Vyapar is a strong choice — inventory, GST billing and accounting in one. DealInSec is for the other kind of business: the one that sells scoped services, one deal at a time.</p>
  <div class="feat">
    <div class="ft"><b>Vyapar is great when…</b><p>you sell products and need inventory, GST billing, stock and day-to-day accounting — the shape of a retail or trading business.</p></div>
    <div class="ft"><b>DealInSec is built when…</b><p>you sell services on high-value, milestone-billed projects — interiors, architecture, agencies, consulting — where the scope, the agreement and the payment matter more than stock.</p></div>
    <div class="ft"><b>No inventory, just deals</b><p>Instead of products and stock levels, DealInSec tracks quotations, e-signed agreements, milestone invoices and who owes you what.</p></div>
    <div class="ft"><b>Protection built in</b><p>Scope-creep flags and payment chasing are part of the workflow — the risks a service business carries, not a shop.</p></div>
  </div>
</div></section>
<section><div class="wrap">
  <h2>Side by side</h2>
  <div class="tbl-scroll"><table class="cmp">
    <tr><th></th><th>Vyapar</th><th>DealInSec</th></tr>
    <tr><td><b>Built for</b></td><td>Shops &amp; product/trading businesses</td><td>Deal-led service businesses</td></tr>
    <tr><td><b>Inventory / stock</b></td><td>Yes — a core strength</td><td>Not applicable — deals, not stock</td></tr>
    <tr><td><b>GST tax invoices</b></td><td>Yes</td><td>Free GST invoice tool; in-app invoices record the deal value (not Rule-46 tax invoices)</td></tr>
    <tr><td><b>Quotation → agreement → invoice</b></td><td>Billing-centric</td><td>One connected thread with e-signed agreements</td></tr>
    <tr><td><b>Scope creep &amp; payment chasing</b></td><td>—</td><td>Protection Check + AI payment reminders</td></tr>
  </table></div>
  <p class="muted" style="font-size:14px;margin-top:10px">Vyapar is a strong product for what it's built for — check their site for current features. The question is whether you sell stock or sell deals.</p>
</div></section>`,
    faq: [
      {
        q: "Is DealInSec like Vyapar?",
        a: "No — and that's the point. Vyapar is GST billing and inventory software for shops and product businesses. DealInSec runs client deals for service businesses: quotation, e-signed agreement, milestone invoices and payment tracking. If you sell services, not stock, DealInSec fits better.",
      },
      {
        q: "Does DealInSec do GST invoices like Vyapar?",
        a: "For a GST tax invoice with CGST/SGST/IGST computed, use DealInSec's free GST invoice generator (no sign-up). In-app invoices record the agreed deal value and print your PAN/GSTIN but are not Rule-46 tax invoices. Vyapar is the stronger pick if full GST-and-inventory accounting is your main need.",
      },
      {
        q: "I'm a freelancer/designer, not a shop — which fits?",
        a: "DealInSec. Service work is about scope, agreements and getting paid per milestone — not inventory. That's exactly what DealInSec is built for, with a free plan and a 7-day trial with no card.",
      },
    ],
  },

  /* ── /quotation-software ─────────────────────────────────────────────── */
  {
    path: "/quotation-software",
    metaTitle: "Quotation Software for Small Businesses in India",
    description:
      "Online quotation software for Indian service businesses: itemised quotations with GST and terms, numbered PDFs, revision tracking — and each quote converts into an agreement and invoice. Free 7-day trial, no card.",
    h1: "Quotation software that doesn't stop at the quotation",
    sub: "Make professional, numbered quotations online in minutes — then convert the accepted quote into an e-signed agreement and an invoice with the same figures, automatically.",
    chips: ["Made for India", "GST-aware", "Free 7-day trial · no card", "Free plan after"],
    shortLabel: "Quotation Software",
    sections: `
<section><div class="wrap">
  <h2>Why quotations made in Excel and Word go wrong</h2>
  <p class="sec-sub">The quotation itself is easy. What breaks is everything after it: the client negotiates on a phone call, the discount never gets written down, the agreement says one number and the invoice another — and when payment is late, nobody can find the version the client actually accepted.</p>
  <div class="feat">
    <div class="ft"><b>Itemised, numbered, consistent</b><p>Quotations are generated from the deal record — deliverables, quantities, rates, terms — with a stable QT-series number and a clean PDF that carries your business name, not ours.</p></div>
    <div class="ft"><b>Revisions with history</b><p>Client negotiated? Issue a revised version. The document the client accepted is the one your agreement and invoice inherit.</p></div>
    <div class="ft"><b>Terms that carry forward</b><p>Advance percentage, balance timeline, validity — set once on the deal, printed on the quotation, carried into the agreement so the documents never contradict each other.</p></div>
    <div class="ft"><b>Quotation tracking</b><p>See which quotations are outstanding, accepted or expiring from the dashboard — the follow-up happens before the validity runs out.</p></div>
  </div>
  <div class="callout honest"><b>Just need one quotation right now?</b><p>Use the <a href="/tools/quotation-maker">free online quotation maker</a> — no sign-up, GST-aware, instant PDF. The software is for when quotations are a weekly habit, not a one-off.</p></div>
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
        a: "Quotation software creates professional, itemised price quotations — business details, line items, taxes, terms and a numbered PDF — and tracks what happens to them. Quotation management software also handles the follow-through: revisions, acceptance, and converting the quote into an agreement and invoice, which is what DealInSec does.",
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
        q: "Is it built for small businesses in India?",
        a: "Yes — Indian number formatting, GST-aware documents, PAN/GSTIN on your papers, and pricing in rupees (free plan; Pro at ₹999/month or ₹9,999/year). It's made for service businesses: consultants, designers, architects, agencies, contractors.",
      },
      {
        q: "Can my sales team use it together?",
        a: "Yes — Pro includes 5 team seats with roles and permissions, so a colleague can prepare quotations without seeing your whole pipeline, and an accounts person can be limited to invoices and payments.",
      },
    ],
  },

  /* ── /contract-management ────────────────────────────────────────────── */
  {
    path: "/contract-management",
    metaTitle: "Contract Management Software for Small Businesses in India",
    description:
      "Contract management software for Indian service businesses: agreements generated from accepted quotations, electronic acceptance with an audit record, statuses, linked invoices. Free 7-day trial, no card.",
    h1: "Contract management software for service businesses",
    sub: "Your agreement is generated from the accepted quotation — same scope, same figures — accepted electronically with an audit record, and linked to the invoices it authorises.",
    chips: ["Electronic acceptance + audit record", "Made for India", "Free 7-day trial · no card"],
    shortLabel: "Contract Management",
    sections: `
<section><div class="wrap">
  <h2>Contracts that match the deal they came from</h2>
  <p class="sec-sub">The most common contract problem in a small service business isn't a missing clause — it's an agreement whose numbers quietly disagree with the quotation, or that lives in an email attachment nobody can find when the dispute starts.</p>
  <div class="feat">
    <div class="ft"><b>Generated, not retyped</b><p>The agreement inherits the accepted quotation's scope, deliverables, value and payment terms — and cross-references the quotation number on its face.</p></div>
    <div class="ft"><b>Electronic acceptance, recorded</b><p>Who accepted, when, and with which signature — an execution record printed on the agreement itself. Counterparties accept electronically; a signed copy stays on record.</p></div>
    <div class="ft"><b>Status you can see</b><p>Draft, pending, signed — with start and end dates, exclusivity, and the linked invoices, on one screen per deal.</p></div>
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
        q: "Are the agreements legally valid in India?",
        a: "Electronic contracts are recognised in India under Section 10A of the Information Technology Act, 2000. DealInSec records electronic acceptance with an audit record naming who accepted, when, and with which signature. It is not a Digital Signature Certificate or Aadhaar eSign, and agreements state this on their face. We are not a law firm — have important agreements reviewed by a lawyer.",
      },
      {
        q: "Is it suitable for service contracts?",
        a: "That's exactly what it's built for — scoped service engagements with deliverables, a value, a duration and a payment split: design projects, consulting retainers, agency engagements, construction work packages.",
      },
      {
        q: "What does it cost for a small business?",
        a: "A 7-day Pro trial with no card, then a free plan (4 deals a month). Pro is ₹999/month or ₹9,999/year and adds unlimited deals, agreements, invoices, payment tracking and 5 team seats.",
      },
      {
        q: "Can my client sign without creating an account?",
        a: "Your counterparty accepts the agreement electronically through a confirmation flow — the execution record then names both parties, and the signed copy stays on the deal thread.",
      },
    ],
  },

  /* ── /proposal-management ────────────────────────────────────────────── */
  {
    path: "/proposal-management",
    metaTitle: "Proposal Management Software for Service Businesses",
    description:
      "Proposal management for Indian service businesses: itemised, priced proposals (quotations) with terms, tracked to acceptance and converted into e-signed agreements and invoices. Free 7-day trial.",
    h1: "Proposal management, the quotation-first way",
    sub: "In a service business, your proposal is a priced scope with terms — a quotation. DealInSec manages that proposal from first draft to accepted, signed and invoiced.",
    chips: ["Priced proposals with terms", "Tracked to acceptance", "Free 7-day trial · no card"],
    shortLabel: "Proposal Management",
    sections: `
<section><div class="wrap">
  <h2>What a proposal needs to actually close</h2>
  <p class="sec-sub">Decks look nice, but clients decide on three things: what exactly you'll deliver, what it costs, and on what terms. DealInSec's proposals are built from those three — an itemised scope, transparent pricing, and payment terms the client can accept on the spot.</p>
  <div class="feat">
    <div class="ft"><b>Scope as line items</b><p>Deliverables with quantities, frequencies and notes — specific rows justify the price and prevent "that was included, right?" disputes later.</p></div>
    <div class="ft"><b>Terms up front</b><p>Validity, advance percentage, revision limits — on the proposal itself, so acceptance means accepting the terms, not just the price.</p></div>
    <div class="ft"><b>Versions, tracked</b><p>Negotiations produce revised versions with history — the accepted version is the one that becomes the agreement.</p></div>
    <div class="ft"><b>Acceptance → agreement → invoice</b><p>The moment a proposal is accepted it can become an e-signed agreement and then invoices, with no retyping and no drift.</p></div>
  </div>
  <div class="callout honest"><b>Proposal vs quotation — same document, different word</b><p>For scoped service work, a proposal and a quotation are functionally the same artifact: a priced offer with terms. If your clients say "send a proposal", send them a DealInSec quotation with well-written deliverables — it reads as one. See the <a href="/blog/quotation-format">format guide</a>.</p></div>
</div></section>`,
    faq: [
      {
        q: "What is proposal management software?",
        a: "Software that creates, sends, tracks and closes client proposals. For service businesses the proposal is a priced scope with terms — DealInSec builds it as a quotation, tracks revisions and acceptance, and converts the accepted proposal into an e-signed agreement and invoices.",
      },
      {
        q: "How is a proposal different from a quotation?",
        a: "In scoped service work, barely at all — both are a priced offer with terms. 'Proposal' tends to be used when there's more narrative around the scope; 'quotation' when the line items dominate. DealInSec's document carries both: itemised deliverables plus notes and terms.",
      },
      {
        q: "Can I track whether the client accepted?",
        a: "Yes — quotation status is tracked on the deal and the dashboard shows outstanding and expiring proposals, so follow-up happens before validity runs out.",
      },
      {
        q: "What happens after acceptance?",
        a: "The accepted proposal becomes an agreement with the same figures, accepted electronically with an audit record, and then invoices — an advance/balance split or milestones — bounded by the agreement's value.",
      },
    ],
  },

  /* ── /invoice-management ─────────────────────────────────────────────── */
  {
    path: "/invoice-management",
    metaTitle: "Invoice Management Software for Small Businesses in India",
    description:
      "Invoice management software for Indian service businesses: invoices generated from agreements, consecutive numbering per financial year, paid/unpaid tracking with dates, and a dashboard of what's collectible. Free 7-day trial.",
    h1: "Invoice management software that knows what you're owed",
    sub: "Invoices generated from the agreement — never more than it's worth — numbered consecutively per financial year, tracked from sent to paid, with a dashboard of what's collectible today.",
    chips: ["INV-series per financial year", "Paid/unpaid with dates", "Made for India", "Free 7-day trial"],
    shortLabel: "Invoice Management",
    sections: `
<section><div class="wrap">
  <h2>The invoice is easy. Managing invoices is the job.</h2>
  <p class="sec-sub">Any tool can print an invoice. The money is lost in the management: invoices that never got raised after signing, sent invoices nobody followed up, and totals that quietly exceeded what the contract allowed.</p>
  <div class="feat">
    <div class="ft"><b>Raised from the agreement</b><p>Advance and balance at any split, or milestone invoices — each cross-referencing the agreement, and the total can never exceed the agreement's value.</p></div>
    <div class="ft"><b>Consecutive numbering</b><p>Per financial year (INV-2627-0001…), automatic — the numbering discipline accountants and auditors expect.</p></div>
    <div class="ft"><b>Paid / unpaid, with dates</b><p>Mark an invoice paid and the document records the settlement date — a paid invoice prints PAID with the date it was settled.</p></div>
    <div class="ft"><b>The collectible dashboard</b><p>Overdue, due this week, and signed-but-not-yet-invoiced — the three lists that decide this month's cash flow, on one screen.</p></div>
  </div>
  <div class="callout honest"><b>Honest GST note</b><p>Invoices inside DealInSec record the agreed contract value and print your PAN and GSTIN, but they do not carry a GST tax computation and are not tax invoices under Rule 46 of the CGST Rules. For a GST invoice with CGST/SGST/IGST computed, use the <a href="/tools/gst-invoice-generator">free GST invoice generator</a> — no sign-up needed.</p></div>
</div></section>`,
    faq: [
      {
        q: "What is invoice management software?",
        a: "Software that handles the lifecycle of invoices, not just their creation: raising them against an agreement, numbering them consistently, tracking sent/paid/overdue status, and showing what's collectible. DealInSec does this on the same thread as the quotation and agreement the invoice came from.",
      },
      {
        q: "Does it create GST tax invoices?",
        a: "The free GST invoice generator at dealinsec.com/tools/gst-invoice-generator creates a GST invoice with CGST, SGST and IGST computed, with no sign-up. Invoices inside the app record the agreed contract value and print your PAN and GSTIN, but they are not tax invoices under Rule 46 of the CGST Rules — we say this plainly rather than let you assume otherwise.",
      },
      {
        q: "Can I bill 50% advance and 50% on delivery?",
        a: "Yes — any split, or separate milestone invoices. DealInSec will not let you invoice more than the agreement is worth.",
      },
      {
        q: "Is there a free plan?",
        a: "Yes — a 7-day Pro trial with no card, then a free plan covering 4 deals a month. Pro (₹999/month or ₹9,999/year) adds unlimited invoices, payment tracking and 5 team seats.",
      },
      {
        q: "Can my accountant get limited access?",
        a: "Yes — invite them with a role limited to invoices and payments; they won't see your deal pipeline. Roles are editable per your needs.",
      },
    ],
  },

  /* ── /e-signature ────────────────────────────────────────────────────── */
  {
    path: "/e-signature",
    metaTitle: "E-Signature Software for Small Businesses in India",
    description:
      "E-signature for Indian service businesses: agreements accepted electronically with an audit record — who signed, when, with which signature — built into the quotation-to-invoice workflow. Honest about what it is. Free 7-day trial.",
    h1: "E-signature software built into the deal, not bolted on",
    sub: "Your agreement is accepted electronically with an audit record — who, when, which signature — and the signed document links straight to the quotation before it and the invoices after it.",
    chips: ["Audit record on the document", "Section 10A, IT Act 2000", "Free 7-day trial · no card"],
    shortLabel: "E-Signature",
    sections: `
<section><div class="wrap">
  <h2>Signature tools sign documents. This one closes deals.</h2>
  <p class="sec-sub">Standalone e-sign tools give you a signed PDF — and then the signed scope still has to be retyped into an invoice. In DealInSec, signing is one step on a thread: the accepted quotation became this agreement, and the signed agreement authorises the invoices.</p>
  <div class="feat">
    <div class="ft"><b>Execution record on the face</b><p>The agreement prints who accepted it, when, and with which signature — plus your signature image and company stamp where you've set them.</p></div>
    <div class="ft"><b>Counterparty-friendly</b><p>Your client accepts electronically through a confirmation flow — the signed copy stays on record, and the printed document reflects the acceptance.</p></div>
    <div class="ft"><b>Signature binding</b><p>The signature captured at creation stays with the document — it doesn't change when someone else views or reprints it.</p></div>
    <div class="ft"><b>Priced for Indian small business</b><p>E-sign is included in the deal workflow — free trial, free plan, and Pro at ₹999/month — rather than a separate per-envelope bill in dollars.</p></div>
  </div>
  <div class="callout honest"><b>What this is — and isn't</b><p>Electronic contracts are recognised in India under Section 10A of the Information Technology Act, 2000, and DealInSec records electronic acceptance with an audit record. It is <b>not</b> a Digital Signature Certificate (DSC) or an Aadhaar eSign, and every agreement says so on its face. If a regulator or counterparty specifically requires DSC/Aadhaar eSign, use those; for everyday service agreements, an accepted document with a clear audit record is what most businesses actually need. We are not a law firm — have important agreements reviewed by a lawyer.</p></div>
</div></section>`,
    faq: [
      {
        q: "Are electronic signatures legally valid in India?",
        a: "Electronic contracts are recognised in India under Section 10A of the Information Technology Act, 2000. DealInSec records electronic acceptance with an audit record — who accepted, when, and with which signature. It is not a Digital Signature Certificate or an Aadhaar eSign, and every agreement states this on its face. This is general information, not legal advice.",
      },
      {
        q: "How is this different from DocuSign-style tools?",
        a: "Standalone tools sign a document you made elsewhere. DealInSec's e-signature is one step in a deal thread: the agreement was generated from your accepted quotation, and once signed it authorises the invoices — same figures throughout, nothing retyped. It's also priced for Indian small businesses rather than per-envelope in dollars.",
      },
      {
        q: "Does my client need an account to sign?",
        a: "Your counterparty accepts the agreement electronically through a confirmation flow; the execution record names both parties and the signed copy stays on the deal thread.",
      },
      {
        q: "What does it cost?",
        a: "E-signature is part of the normal plans — 7-day Pro trial with no card, free plan after (4 deals a month), Pro at ₹999/month or ₹9,999/year with unlimited agreements.",
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

function categoryPage(p: CategoryPage): string {
  const url = SITE_ORIGIN + p.path;
  const jsonLd: object[] = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "DealInSec",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description: p.description,
      url,
      offers: { "@type": "Offer", price: "999", priceCurrency: "INR", description: "Pro plan ₹999/month or ₹9,999/year; free plan and 7-day trial available" },
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
  ];

  const chips = p.chips.map((c) => `<span class="chip">${esc(c)}</span>`).join("");
  const faqHtml = p.faq.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join("");

  const body = `
<div class="hero"><div class="wrap">
  <h1>${esc(p.h1)}</h1>
  <p class="sub">${esc(p.sub)}</p>
  <div class="hero-ctas">
    <a class="btn" href="${SIGNUP}">Start free trial →</a>
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
${relatedSection(p.path)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(p.metaTitle)} | DealInSec</title>
<meta name="description" content="${esc(p.description)}" />
<link rel="canonical" href="${url}" />
<meta name="robots" content="index,follow" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${esc(p.metaTitle)} | DealInSec" />
<meta property="og:description" content="${esc(p.description)}" />
<meta property="og:url" content="${url}" />
<meta property="og:site_name" content="DealInSec" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="${esc(p.metaTitle)} | DealInSec" />
<meta name="twitter:description" content="${esc(p.description)}" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
${STYLES}
${jsonLd.map((b) => `<script type="application/ld+json">${JSON.stringify(b).replace(/</g, "\\u003c")}</script>`).join("\n")}
</head>
<body>
${header()}
<main>${body}</main>
${ctaBand()}
${footer()}
</body>
</html>`;
}

/* ── Public wiring ─────────────────────────────────────────────────────── */

/** Paths for the sitemap AND for the SW/router exclusion lists. */
export const CATEGORY_PATHS = PAGES.map((p) => p.path);

export function categorySitemapPaths(): string[] {
  return CATEGORY_PATHS;
}

export function registerCategoryPages(app: Express) {
  for (const p of PAGES) {
    app.get(p.path, (_req, res) => res.type("html").send(categoryPage(p)));
  }
}
