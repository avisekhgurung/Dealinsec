/**
 * Comparison and pillar pages — the commercial layer for a GLOBAL audience:
 *
 *   /freelance-business-management-software   the pillar
 *   /bonsai-alternatives                       "Bonsai alternatives"
 *   /bonsai-vs-dealinsec                       "bonsai pricing", "bonsai vs dealinsec"
 *
 * Rendered by the same renderer as the category pages (region "global"): no
 * rupee prices, no India framing, and structured data that advertises only the
 * free plan — a price nobody in the reader's country can pay is not an offer.
 *
 * HOW THESE PAGES STAY HONEST
 *  1. Every competitor price and feature below comes from that vendor's OWN
 *     pricing page, opened on `reviewedOn`. Aggregator sites disagree with each
 *     other and with the vendors (HoneyBook, Dubsado and Indy all differed), so
 *     none is used as a source. A vendor that has not been checked on the date
 *     printed must be removed, not left with stale numbers.
 *  2. Tables are generated from VENDORS / FEATURES, and the reviewed date is
 *     rendered next to every table from the same data, so the visible text and
 *     the data cannot drift (server/seo.test.ts asserts it).
 *  3. A feature cell only says what the vendor's pricing page lists. "—" means
 *     "not listed on the pricing page on the review date", which is not proof
 *     the product lacks it; the page says so.
 *  4. DealInSec's own column states its real limits: it does not track time,
 *     run a client portal, do accounting or collect card payments, and its paid
 *     plan can only be bought in India today.
 *
 * When you refresh prices: re-open each pricing URL, update the numbers, set a
 * new `reviewedOn`, and bump `updated` on the pages.
 */
import type { Express } from "express";
import { esc } from "./tools/layout";
import { renderCategoryPage, type CategoryPage } from "./category-pages";

export const REVIEWED_ON = "2026-09-26";

interface VendorPlan {
  name: string;
  /** As printed on the vendor's page, e.g. "$25/user/month". */
  monthly?: string;
  annual?: string;
  note?: string;
}

export interface Vendor {
  key: "bonsai" | "moxie" | "honeybook" | "dubsado" | "indy";
  name: string;
  pricingUrl: string;
  /** ISO date this vendor's own pricing page was last opened and read. */
  reviewedOn: string;
  trial: string;
  plans: VendorPlan[];
  /** What the pricing page itself says about billing. */
  billing: string;
}

export const VENDORS: Vendor[] = [
  {
    key: "bonsai",
    name: "Bonsai",
    pricingUrl: "https://www.hellobonsai.com/pricing",
    reviewedOn: REVIEWED_ON,
    trial: "7 days",
    billing: "Per user. The lower price applies when billed annually; Elite has a 3-user minimum.",
    plans: [
      { name: "Basic", monthly: "$15", annual: "$9" },
      { name: "Essentials", monthly: "$25", annual: "$19", note: "Adds invoices & payments, proposals & contracts, client portal, expense and income tracking" },
      { name: "Premium", monthly: "$39", annual: "$29" },
      { name: "Elite", monthly: "$59", annual: "$49", note: "3-user minimum" },
    ],
  },
  {
    key: "moxie",
    name: "Moxie",
    pricingUrl: "https://www.withmoxie.com/pricing",
    reviewedOn: REVIEWED_ON,
    trial: "14 days",
    billing: "Monthly or annual; the lower price applies when billed annually.",
    plans: [
      { name: "Starter", monthly: "$12", annual: "$10" },
      { name: "Pro", monthly: "$25", annual: "$20", note: "Adds a white-labelled client portal, workflow automation and integrations" },
      { name: "Teams", monthly: "$40", annual: "$32", note: "Up to five team members" },
    ],
  },
  {
    key: "honeybook",
    name: "HoneyBook",
    pricingUrl: "https://www.honeybook.com/pricing",
    reviewedOn: REVIEWED_ON,
    trial: "30 days, no card",
    billing: "Monthly or billed yearly; card payments carry processing fees listed on the page.",
    plans: [
      { name: "Starter", monthly: "$29", annual: "$29" },
      { name: "Essentials", monthly: "$59", annual: "$49", note: "Adds scheduler, automations and QuickBooks Online integration" },
      { name: "Premium", monthly: "$129", annual: "$109" },
    ],
  },
  {
    key: "dubsado",
    name: "Dubsado",
    pricingUrl: "https://www.dubsado.com/pricing",
    reviewedOn: REVIEWED_ON,
    trial: "21 days",
    billing: "Shown as annual prices; the monthly equivalents are the page's own.",
    plans: [
      { name: "Starter", annual: "$335/year", note: "About $27.92/month" },
      { name: "Premier", annual: "$525/year", note: "About $43.75/month; adds unlimited lead forms, advanced scheduling, automated workflows" },
    ],
  },
  {
    key: "indy",
    name: "Indy",
    pricingUrl: "https://weareindy.com/pricing",
    reviewedOn: REVIEWED_ON,
    trial: "7 days on Pro",
    billing: "A free plan, plus a Pro bundle shown at $12.50/month against $300 billed every two years.",
    plans: [
      { name: "Free", monthly: "$0", note: "3 proposals, contracts, invoices and clients per month" },
      { name: "Pro", monthly: "$12.50/month", annual: "$300 every 2 years", note: "Unlimited proposals, contracts, invoices and clients" },
    ],
  },
];

const vendor = (k: Vendor["key"]) => VENDORS.find((v) => v.key === k)!;

const reviewedNote = (vs: Vendor[]) =>
  `<p class="muted" style="font-size:14px;margin-top:10px">Prices read from ${vs
    .map((v) => `<a href="${esc(v.pricingUrl)}" rel="noopener noreferrer" target="_blank">${esc(v.name)}'s pricing page</a>`)
    .join(", ")} on <time datetime="${REVIEWED_ON}">26 September 2026</time>. Prices change — check the vendor before you buy.</p>`;

function pricingTable(vs: Vendor[]): string {
  const rows = vs
    .flatMap((v) =>
      v.plans.map(
        (p, i) =>
          `<tr>${i === 0 ? `<td rowspan="${v.plans.length}"><b>${esc(v.name)}</b><br><span class="muted" style="font-size:13px">Trial: ${esc(v.trial)}</span></td>` : ""}<td>${esc(p.name)}</td><td>${esc(p.monthly ?? "—")}</td><td>${esc(p.annual ?? "—")}</td><td>${esc(p.note ?? "")}</td></tr>`,
      ),
    )
    .join("");
  return `<div class="tbl-scroll"><table class="cmp">
    <tr><th>Tool</th><th>Plan</th><th>Monthly</th><th>Annual billing</th><th>Notes from the pricing page</th></tr>
    ${rows}
  </table></div>`;
}

/* ── Feature matrix ────────────────────────────────────────────────────── */

type Col = Vendor["key"] | "dealinsec";

interface FeatureRow {
  label: string;
  cells: Partial<Record<Col, string>>;
}

/** "—" = not listed on the vendor's pricing page on the review date. */
const FEATURES: FeatureRow[] = [
  { label: "Proposals / quotations", cells: { bonsai: "Proposals (Essentials)", moxie: "Proposals, quotes (Starter)", honeybook: "Proposals (Starter)", indy: "Proposals", dealinsec: "Quotations, with a client acceptance link (Free)" } },
  { label: "Contracts / e-signature", cells: { bonsai: "Contracts (Essentials)", moxie: "Contracts (Starter)", honeybook: "Contracts (Starter)", indy: "Contracts", dealinsec: "Agreements with a public signing link (Pro)" } },
  { label: "Invoicing", cells: { bonsai: "Invoices (Essentials)", moxie: "Invoicing (Starter)", honeybook: "Invoices (Starter)", indy: "Invoices", dealinsec: "Invoices from the agreement (Pro)" } },
  { label: "Collects payments online", cells: { bonsai: "Yes — invoices & payments", moxie: "Yes — invoicing & payments", honeybook: "Yes — card fees listed", indy: "—", dealinsec: "No — tracks payment status; your client pays you directly" } },
  { label: "Time tracking", cells: { bonsai: "Yes (Basic)", moxie: "Yes", honeybook: "—", indy: "Yes", dealinsec: "No" } },
  { label: "Client portal", cells: { bonsai: "Yes (Essentials)", moxie: "White-labelled portal (Pro)", honeybook: "Yes (Starter)", indy: "Branded portal (Pro)", dealinsec: "No — public links for a quotation and an agreement" } },
  { label: "Accounting / expenses", cells: { bonsai: "Expense & income tracking (Essentials)", moxie: "Basic accounting", honeybook: "QuickBooks Online integration (Essentials)", indy: "—", dealinsec: "No" } },
  { label: "Checks terms for scope risk before you send", cells: { bonsai: "—", moxie: "—", honeybook: "—", indy: "—", dealinsec: "Yes — Protection Check" } },
];

function featureTable(cols: Col[]): string {
  const head = cols.map((c) => `<th>${c === "dealinsec" ? "DealInSec" : esc(vendor(c as Vendor["key"]).name)}</th>`).join("");
  const rows = FEATURES.map(
    (f) => `<tr><td><b>${esc(f.label)}</b></td>${cols.map((c) => `<td>${esc(f.cells[c] ?? "—")}</td>`).join("")}</tr>`,
  ).join("");
  return `<div class="tbl-scroll"><table class="cmp">
    <tr><th></th>${head}</tr>
    ${rows}
  </table></div>
  <p class="muted" style="font-size:14px;margin-top:10px">"—" means the feature is not listed on that vendor's pricing page on the review date. It does not prove the product lacks it — check the vendor.</p>`;
}

const AVAILABILITY = `<div class="callout honest"><b>Where DealInSec's paid plan is available</b><p>The free plan (4 deals a month, each with its quotation) and the 7-day Pro trial are open in every country, with no card. Paid plans can currently be bought in India only (₹99/month or ₹999/year); we can't yet take payments from other countries, and we'll say so here as soon as that changes.</p></div>`;

const METHODOLOGY = (vs: Vendor[]) => `<section><div class="wrap">
  <h2>How this comparison was made</h2>
  <p class="sec-sub">Each competitor's prices and features were read from that vendor's own pricing page on <time datetime="${REVIEWED_ON}">26 September 2026</time> (${vs.map((v) => esc(v.name)).join(", ")}). Aggregator and review sites were not used as sources, because they disagree with each other and with the vendors. Feature cells contain only what the vendor's pricing page lists. DealInSec's column describes what the product does today, including what it does not do. We make DealInSec, so read this with that in mind and verify anything that matters to you on the vendors' own sites.</p>
</div></section>`;

/* ── Pages ─────────────────────────────────────────────────────────────── */

const HERO_IMAGE = { src: "/blog/quotation-software-vs-excel-laptop.webp", alt: "A laptop on a desk showing a dashboard of charts and figures", w: 1600, h: 1140 };

export const COMPARISON_PAGES: CategoryPage[] = [
  /* ── The pillar ───────────────────────────────────────────────────────── */
  {
    path: "/freelance-business-management-software",
    region: "global",
    updated: REVIEWED_ON,
    ogImage: HERO_IMAGE,
    metaTitle: "Freelance Business Management Software: Deal to Paid",
    description:
      "What freelance business management software should do — quotes, agreements, invoices and payment tracking on one record per client — and where DealInSec fits, and where it doesn't.",
    h1: "Freelance business management software, built around the client deal",
    sub: "Freelancers don't need an enterprise CRM. They need every client deal — quotation, agreement, invoice, payment — on one record that stays consistent. Here is what to look for, and where DealInSec fits.",
    chips: ["Quote → agreement → invoice → payment", "50 currencies", "Free plan in every country", "7-day Pro trial · no card"],
    shortLabel: "Freelance Business Management",
    sections: `
<section><div class="wrap">
  <h2>What freelance business management software is — and isn't</h2>
  <p class="sec-sub">The phrase covers three different kinds of product. Knowing which one you need saves months of trial and error.</p>
  <div class="feat">
    <div class="ft"><b>Deal-to-paid tools</b><p>Run each client engagement: the quotation, the signed scope, the invoices and who has paid. This is where DealInSec sits.</p></div>
    <div class="ft"><b>All-in-one suites</b><p>Add time tracking, project tasks, a client portal, expenses and sometimes accounting. Bonsai, Moxie and HoneyBook are examples; see the <a href="/bonsai-alternatives">comparison</a>.</p></div>
    <div class="ft"><b>Freelancer CRM</b><p>Manage leads, contacts and a sales pipeline before a deal exists. DealInSec is not a CRM: it starts when a deal does.</p></div>
    <div class="ft"><b>Accounting software</b><p>Books, taxes and reconciliation. Separate again — DealInSec records what you billed and what is paid, and does not replace an accountant or bookkeeping tool.</p></div>
  </div>
</div></section>
<section><div class="wrap">
  <h2>What to check before you choose</h2>
  <ul>
    <li><b>Do the documents agree with each other?</b> A quotation that turns into an agreement that turns into an invoice — with the same figures — removes the retyping where mistakes happen.</li>
    <li><b>Can the client accept and sign without an account?</b> Anything that makes your client register will slow a yes down.</li>
    <li><b>Does it protect the scope?</b> Missing revision limits, no advance and vague deliverables are where freelancers lose money. Look for a check before you send.</li>
    <li><b>Does it show what you are owed?</b> Overdue and due-this-week, at a glance, so chasing is a habit and not a memory test.</li>
    <li><b>Does it work in your currency and country?</b> Tax fields, invoice numbering and date formats differ. So does what the software can charge you — see availability below.</li>
    <li><b>What does it not do?</b> If you need time tracking, a client portal or expense tracking, say so up front.</li>
  </ul>
</div></section>
<section><div class="wrap">
  <h2>Start with the free tools</h2>
  <p class="sec-sub">You can run a real deal today without an account. Each tool works in any country and runs in your browser.</p>
  <div class="feat">
    <div class="ft"><b><a href="/tools/quotation-maker">Quotation maker</a></b><p>Itemised quote with terms, in your currency, as a PDF.</p></div>
    <div class="ft"><b><a href="/tools/service-agreement-template">Freelance agreement template</a></b><p>Scope, fees, revisions, cancellation and signatures.</p></div>
    <div class="ft"><b><a href="/tools/bill-generator">Invoice generator</a></b><p>A clean invoice with optional tax and a paid/due stamp.</p></div>
    <div class="ft"><b><a href="/tools/payment-reminder-email-generator">Payment reminder email generator</a></b><p>A polite reminder, friendly to final notice, from your invoice details.</p></div>
  </div>
</div></section>
<section><div class="wrap">
  <h2>How DealInSec fits — and where it doesn't</h2>
  <div class="feat">
    <div class="ft"><b>What it does</b><p>Deals, quotations with a client acceptance link, agreements with a public signing link, invoices drawn from the agreement, payment tracking, a Protection Check on your terms, and AI-drafted follow-ups you review and send yourself.</p></div>
    <div class="ft"><b>What it doesn't do</b><p>Track time, run a client portal, do accounting or expenses, schedule meetings, send reminders automatically or collect card payments — your client pays you directly and you mark the invoice paid.</p></div>
    <div class="ft"><b>Who it suits</b><p>Freelancers and solo service providers whose income comes from scoped client deals — a website, a brand, a batch of articles, an edit — and who want the scope signed and the payment followed up.</p></div>
    <div class="ft"><b>Who should look elsewhere</b><p>Anyone who needs hourly time tracking, a full client portal or built-in accounting. The <a href="/bonsai-alternatives">alternatives page</a> compares five options with prices read from their own sites.</p></div>
  </div>
  ${AVAILABILITY}
</div></section>
<section><div class="wrap">
  <h2>Go deeper</h2>
  <p class="sec-sub">See how it handles each step: <a href="/quotation-software">quotation software</a>, <a href="/contract-management">contract management</a>, <a href="/e-signature">e-signature</a> and <a href="/invoice-management">invoice management</a> (these pages are written for India). Comparing tools? Start with <a href="/bonsai-vs-dealinsec">Bonsai vs DealInSec</a>. Chasing money? Read the <a href="/blog/payment-reminder-email">payment reminder email templates</a>. Working from India? <a href="/refrens-alternative">Refrens</a> and <a href="/vyapar-alternative">Vyapar</a> comparisons are there too.</p>
</div></section>`,
    faq: [
      {
        q: "What is freelance business management software?",
        a: "Software that runs the business side of freelancing: winning and scoping deals, sending quotations or proposals, agreeing terms, invoicing and following up on payment. Some products add time tracking, project management, a client portal and accounting. DealInSec focuses on the deal from quotation to payment.",
      },
      {
        q: "Is DealInSec a freelancer CRM?",
        a: "No. It does not manage leads, contacts or a sales pipeline. It starts when a deal starts and keeps the quotation, agreement, invoice and payment status together for each client.",
      },
      {
        q: "Does DealInSec have time tracking, a client portal or accounting?",
        a: "No. It does not track time, run a client portal or do accounting and expenses. Clients receive public links to accept a quotation and sign an agreement, but there is no client login area.",
      },
      {
        q: "Can I use DealInSec for free?",
        a: "Yes. The free plan covers 4 deals a month, each with its quotation, and every new account starts with a 7-day Pro trial with no card, in every country. Agreements, invoices and payment tracking are part of Pro, which can currently be bought in India only.",
      },
      {
        q: "Does DealInSec collect payments from my clients?",
        a: "No. It tracks payment status. Your client pays you directly, by bank transfer or however you already get paid, and you mark the invoice paid.",
      },
    ],
  },

  /* ── Bonsai alternatives ──────────────────────────────────────────────── */
  {
    path: "/bonsai-alternatives",
    region: "global",
    updated: REVIEWED_ON,
    ogImage: HERO_IMAGE,
    metaTitle: "Bonsai Alternatives for Freelancers: Pricing Compared",
    description:
      "Bonsai alternatives for freelancers — Moxie, HoneyBook, Dubsado, Indy and DealInSec — with prices read from each vendor's own page (reviewed 26 Sep 2026) and honest trade-offs.",
    h1: "Bonsai alternatives for freelancers: features, pricing and workflow",
    sub: "Bonsai is a capable all-in-one suite. If its per-user pricing, its feature spread or its workflow isn't the right fit, here are five ways to run your client work — compared from each vendor's own pricing page.",
    chips: ["Prices from vendors' own pages", "Reviewed 26 Sep 2026", "Honest trade-offs", "No 'best' claims"],
    shortLabel: "Bonsai Alternatives",
    sections: `
<section><div class="wrap">
  <h2>Why freelancers look for a Bonsai alternative</h2>
  <p class="sec-sub">Common reasons, in the order people mention them: the price per user, needing only part of the suite (proposals, contracts and invoices, without the rest), wanting a free tier, or preferring a different workflow. None of that makes Bonsai a bad product — it is a broad one, and breadth is not what everyone wants.</p>
</div></section>
<section><div class="wrap">
  <h2>Bonsai's pricing, for reference</h2>
  ${pricingTable([vendor("bonsai")])}
  ${reviewedNote([vendor("bonsai")])}
  <p style="margin-top:12px">Invoicing, contracts and proposals start on the Essentials plan, so the entry price for those is the Essentials price, per user. Time tracking and task management are on every plan.</p>
</div></section>
<section><div class="wrap">
  <h2>The alternatives, side by side</h2>
  <div class="feat">
    <div class="ft"><b>Moxie</b><p><i>Best for:</i> an all-in-one that includes time tracking, basic accounting and invoicing at a lower entry price. <i>Pricing:</i> Starter $12/month ($10 billed annually), Pro $25, Teams $40. <i>Trade-off:</i> the white-labelled client portal and workflow automation sit on the Pro plan.</p></div>
    <div class="ft"><b>HoneyBook</b><p><i>Best for:</i> client-services businesses that want proposals, contracts, invoices and lead forms in one place. <i>Pricing:</i> Starter $29/month, Essentials $59 ($49 billed yearly), Premium $129 ($109). <i>Trade-off:</i> card payments carry processing fees, and automation and scheduling start on Essentials.</p></div>
    <div class="ft"><b>Dubsado</b><p><i>Best for:</i> service businesses that lean on forms, client portals and workflows. <i>Pricing:</i> Starter $335/year, Premier $525/year. <i>Trade-off:</i> shown as annual prices, and unlimited lead forms, advanced scheduling and workflows are on Premier.</p></div>
    <div class="ft"><b>Indy</b><p><i>Best for:</i> solo freelancers who want a free tier to start. <i>Pricing:</i> Free (3 proposals, contracts, invoices and clients a month); Pro shown at $12.50/month against $300 billed every two years. <i>Trade-off:</i> the free plan is capped at three of each per month.</p></div>
    <div class="ft"><b>DealInSec</b><p><i>Best for:</i> freelancers whose income comes from scoped client deals and who want the quotation, the signed agreement, the invoice and the follow-up on one record, with a check on the terms before sending. <i>Pricing:</i> free plan (4 deals a month with quotations); Pro at ₹99/month or ₹999/year, bought in India only today. <i>Trade-off:</i> no time tracking, client portal, accounting or online payment collection.</p></div>
  </div>
  ${AVAILABILITY}
</div></section>
<section><div class="wrap">
  <h2>Prices in one table</h2>
  ${pricingTable([vendor("moxie"), vendor("honeybook"), vendor("dubsado"), vendor("indy")])}
  ${reviewedNote([vendor("moxie"), vendor("honeybook"), vendor("dubsado"), vendor("indy")])}
</div></section>
<section><div class="wrap">
  <h2>What each one lists, feature by feature</h2>
  ${featureTable(["bonsai", "moxie", "honeybook", "indy", "dealinsec"])}
  <p class="muted" style="font-size:14px">Dubsado is left out of this table because its pricing page lists features by plan in a different shape; see its pricing page above.</p>
</div></section>
<section><div class="wrap">
  <h2>How to choose</h2>
  <ul>
    <li><b>You track hours or bill by the hour:</b> pick a suite with time tracking (Bonsai, Moxie or Indy). DealInSec doesn't have it.</li>
    <li><b>You want clients to log in and see everything:</b> choose one with a client portal.</li>
    <li><b>You mostly sell scoped projects and lose money to scope creep or late payment:</b> the deal-to-paid workflow and the pre-send check are the point of DealInSec.</li>
    <li><b>You want to start free:</b> Indy's and DealInSec's free plans cover different limits — three of each document a month versus four deals a month with quotations.</li>
    <li><b>You need to take card payments through the tool:</b> Bonsai, Moxie and HoneyBook list it; DealInSec doesn't.</li>
  </ul>
  <p>For the head-to-head with the most-searched option, see <a href="/bonsai-vs-dealinsec">Bonsai vs DealInSec</a>; for the wider picture, <a href="/freelance-business-management-software">freelance business management software</a>.</p>
</div></section>
${METHODOLOGY(VENDORS)}`,
    faq: [
      {
        q: "What is the best alternative to Bonsai?",
        a: "It depends on what you need. Moxie is the closest all-in-one at a lower entry price, HoneyBook suits client-services businesses that want lead forms and scheduling, Indy has a free tier, and DealInSec suits freelancers who want each client deal — quotation, signed agreement, invoice, payment status — on one record. This page compares them without ranking them.",
      },
      {
        q: "Is there a free alternative to Bonsai?",
        a: "Indy lists a free plan with three proposals, contracts, invoices and clients a month, and DealInSec's free plan covers four deals a month with quotations. Bonsai offers a 7-day free trial rather than a free plan.",
      },
      {
        q: "How much does Bonsai cost?",
        a: "On Bonsai's own pricing page on 26 September 2026: Basic $15, Essentials $25, Premium $39 and Elite $59 per user per month, or $9, $19, $29 and $49 per user per month when billed annually. Invoicing, proposals and contracts start on Essentials. Check the page before you buy, as prices change.",
      },
      {
        q: "Can I use DealInSec's paid plan outside India?",
        a: "Not yet. The free plan and the 7-day Pro trial are open in every country, but paid plans can currently be bought in India only. We can't yet take payments from other countries.",
      },
      {
        q: "Why do other comparison sites show different prices?",
        a: "Vendors change plans and prices, and third-party sites often lag or mix monthly and annual figures. The prices here were read from each vendor's own pricing page on the date shown, and that date is printed next to every table.",
      },
    ],
  },

  /* ── Bonsai vs DealInSec ──────────────────────────────────────────────── */
  {
    path: "/bonsai-vs-dealinsec",
    region: "global",
    updated: REVIEWED_ON,
    ogImage: HERO_IMAGE,
    metaTitle: "Bonsai vs DealInSec: Pricing & Features Compared",
    description:
      "Bonsai vs DealInSec, honestly: Bonsai's current pricing (reviewed 26 Sep 2026), what each includes, what DealInSec doesn't do, and who each is for.",
    h1: "Bonsai vs DealInSec: an honest comparison for freelancers",
    sub: "Bonsai is a broad freelance suite priced per user. DealInSec is narrower: it runs each client deal from quotation to payment. They overlap on proposals, contracts and invoices, and differ on almost everything else.",
    chips: ["Bonsai pricing, read from its own page", "What DealInSec doesn't do", "Reviewed 26 Sep 2026", "No 'best' claims"],
    shortLabel: "Bonsai vs DealInSec",
    sections: `
<section><div class="wrap">
  <h2>The short answer</h2>
  <div class="callout honest"><b>Choose Bonsai if…</b><p>you want an all-in-one suite: time tracking, tasks, a client portal, expense tracking and payments collected in the tool, with integrations. Its plans are priced per user.</p></div>
  <div class="callout honest"><b>Choose DealInSec if…</b><p>your income comes from scoped client deals and you want the quotation, the signed agreement, the invoice and the payment follow-up on one record — with a check on your terms before you send. It has no time tracking, client portal or accounting, and it doesn't collect payments for you.</p></div>
</div></section>
<section><div class="wrap">
  <h2>Pricing side by side</h2>
  ${pricingTable([vendor("bonsai")])}
  <div class="tbl-scroll"><table class="cmp">
    <tr><th>Tool</th><th>Plan</th><th>Price</th><th>What you get</th></tr>
    <tr><td rowspan="2"><b>DealInSec</b><br><span class="muted" style="font-size:13px">7-day Pro trial, no card, in every country</span></td><td>Free</td><td>$0 / ₹0</td><td>4 deals a month, each with its quotation, in every country</td></tr>
    <tr><td>Pro</td><td>₹99/month or ₹999/year (India only)</td><td>Unlimited deals, agreements with a signing link, invoices, payment tracking</td></tr>
  </table></div>
  ${reviewedNote([vendor("bonsai")])}
  ${AVAILABILITY}
  <p style="margin-top:12px">To compare like with like: Bonsai's invoicing, proposals and contracts start on Essentials ($25 per user per month, $19 billed annually). DealInSec's equivalent is Pro, with a per-account price rather than per user.</p>
</div></section>
<section><div class="wrap">
  <h2>Feature by feature</h2>
  ${featureTable(["bonsai", "dealinsec"])}
</div></section>
<section><div class="wrap">
  <h2>What Bonsai has that DealInSec doesn't</h2>
  <ul>
    <li>Time tracking and task management on every plan.</li>
    <li>A client portal (Essentials and above).</li>
    <li>Collecting payments through invoices, in the tool.</li>
    <li>Expense and income tracking, scheduling and forms.</li>
    <li>Integrations such as QuickBooks, Xero, Zapier and Calendly on higher plans, and native mobile apps.</li>
  </ul>
  <p>If two or three of those matter to you, Bonsai is the better fit and DealInSec isn't a substitute.</p>
</div></section>
<section><div class="wrap">
  <h2>What DealInSec does differently</h2>
  <div class="feat">
    <div class="ft"><b>One thread per client</b><p>The quotation becomes the agreement and the agreement becomes the invoice, and DealInSec won't let you invoice more than the agreement is worth. Nothing is retyped.</p></div>
    <div class="ft"><b>Protection Check</b><p>Reads your terms before you send and flags risky wording — unlimited revisions, no advance, no payment deadline — and suggests lines to add. Nothing is added unless you approve it.</p></div>
    <div class="ft"><b>Links clients can use without an account</b><p>A quotation link the client can accept, and an agreement link they sign by drawing or typing a signature. The agreement records who signed, when and with which signature — electronic acceptance with an audit record, not a certified e-signature.</p></div>
    <div class="ft"><b>Follow-up you review and send</b><p>Copilot drafts a payment reminder from the real invoice — number, amount, due date, days overdue. It only drafts. You send it, and nothing is sent automatically.</p></div>
  </div>
</div></section>
<section><div class="wrap">
  <h2>Who each is for</h2>
  <div class="tbl-scroll"><table class="cmp">
    <tr><th></th><th>Bonsai</th><th>DealInSec</th></tr>
    <tr><td><b>Built around</b></td><td>The whole freelance business: projects, time, clients, money</td><td>The client deal, from quotation to payment</td></tr>
    <tr><td><b>Pricing model</b></td><td>Per user, four plans</td><td>Free plan, then one Pro plan (India only today)</td></tr>
    <tr><td><b>Strongest when</b></td><td>You want one suite for delivery and admin</td><td>You want scoped deals signed, invoiced and followed up</td></tr>
    <tr><td><b>Weakest when</b></td><td>You only need quotes, contracts and invoices</td><td>You need time tracking, a portal or accounting</td></tr>
  </table></div>
</div></section>
${METHODOLOGY([vendor("bonsai")])}`,
    faq: [
      {
        q: "How much does Bonsai cost?",
        a: "On Bonsai's own pricing page on 26 September 2026: Basic $15, Essentials $25, Premium $39 and Elite $59 per user per month, or $9, $19, $29 and $49 per user per month billed annually. Invoicing, proposals and contracts start on Essentials. Prices change, so check the page.",
      },
      {
        q: "Is DealInSec a Bonsai alternative?",
        a: "For part of it. They overlap on quotations or proposals, agreements and invoices. DealInSec has no time tracking, client portal, accounting or online payment collection, so it suits freelancers who mainly need to run scoped client deals rather than a full suite.",
      },
      {
        q: "Does DealInSec have time tracking?",
        a: "No. DealInSec does not track time, so it is not a fit if you bill by the hour and need timesheets.",
      },
      {
        q: "Does DealInSec collect payments like Bonsai?",
        a: "No. DealInSec tracks payment status. Your client pays you directly and you mark the invoice paid, so it never handles your client's money.",
      },
      {
        q: "Can I use DealInSec's paid plan outside India?",
        a: "Not yet. The free plan and the 7-day Pro trial are open in every country, but paid plans can currently be bought in India only (₹99/month or ₹999/year).",
      },
    ],
  },
];

/** Paths for the sitemap, each with the date the page was last reviewed. */
export function comparisonSitemapPaths(): { loc: string; lastmod?: string }[] {
  return COMPARISON_PAGES.map((p) => ({ loc: p.path, lastmod: p.updated }));
}

export function registerComparisonPages(app: Express) {
  for (const p of COMPARISON_PAGES) {
    app.get(p.path, (_req, res) => res.type("html").send(renderCategoryPage(p, COMPARISON_PAGES)));
  }
}
