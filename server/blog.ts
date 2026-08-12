/**
 * DealInSec Blog — server-rendered, indexable articles for organic search.
 *
 * Same architecture as the free-tool pages: Express returns complete HTML
 * (registered BEFORE the SPA catch-all in server/index.ts), so crawlers read
 * real content in the initial response. Every new top-level route here must
 * also be in vite.config.ts navigateFallbackDenylist or the installed PWA's
 * service worker will shadow it with the SPA shell.
 *
 * Posts target researched keywords (Ubersuggest, Aug 2026): "quotation
 * format", "quote format", "quotation making", "make quotation online",
 * "make online quotation", "fake quotation". Content rules: India-specific,
 * honest (no invented statistics, hedged legal statements, "not legal
 * advice"), and every post funnels into /tools/quotation-maker + sign-up.
 *
 * Add posts to the POSTS array; index, routes, sitemap and cross-links update
 * automatically.
 */
import type { Express } from "express";
import { esc, SITE_ORIGIN, LOGO_SVG } from "./tools/layout";

const SIGNUP = "/auth?mode=signup&utm_source=blog&utm_medium=post";

interface Faq {
  q: string;
  a: string;
}

interface HeroImage {
  /** Site-relative path under client/public (e.g. "/blog/x.webp"). */
  src: string;
  alt: string;
  w: number;
  h: number;
}

interface BlogPost {
  slug: string;
  /** On-page H1. */
  title: string;
  /** <title> tag (keep under ~60 chars before the site name). */
  metaTitle: string;
  description: string;
  /** ISO date, e.g. "2026-08-13". */
  date: string;
  readMins: number;
  /** Card text on /blog. */
  excerpt: string;
  /** Free stock photo (Unsplash License — free for commercial use, no
   *  attribution required), downloaded and SELF-HOSTED so pages have no
   *  external dependency. Doubles as the og:image. */
  hero: HeroImage;
  faq?: Faq[];
  body: string;
}

/* ── Shared shell ──────────────────────────────────────────────────────── */

const STYLES = `<style>
  *,*::before,*::after{box-sizing:border-box}
  :root{--green:hsl(160 84% 30%);--green-d:hsl(160 84% 23%);--ink:hsl(222 47% 11%);--muted:hsl(215 16% 47%);--line:hsl(215 20% 88%);--card-line:hsl(215 20% 92%);--bg:hsl(210 20% 98%);--card:hsl(0 0% 100%);--accent-bg:hsl(160 60% 95%);--accent-fg:hsl(160 55% 22%);--accent-line:hsl(160 40% 85%)}
  html{-webkit-text-size-adjust:100%}
  body{margin:0;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg);line-height:1.7;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
  a{color:var(--green);text-decoration:none}
  a:hover{text-decoration:underline}
  .wrap{max-width:1080px;margin:0 auto;padding:0 20px}
  .btn{display:inline-flex;align-items:center;gap:8px;background:var(--green);color:#fff;font-weight:700;padding:12px 22px;border-radius:12px;border:0;cursor:pointer;font-size:15px}
  .btn:hover{background:var(--green-d);text-decoration:none;color:#fff}
  .btn.ghost{background:transparent;color:var(--green);border:1.5px solid var(--line)}
  .btn.ghost:hover{background:#fff;border-color:var(--green)}
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
  .nav a.active{color:var(--accent-fg);background:var(--accent-bg)}
  footer.site{background:#fff;border-top:1px solid var(--line);padding:34px 0;color:var(--muted);font-size:14px;margin-top:40px}
  footer.site .links{display:flex;gap:18px;flex-wrap:wrap;margin-bottom:10px}
  .muted{color:var(--muted)}

  /* ── Article — serif body for a relaxed, readable "study" feel ── */
  .crumbs{font-size:13px;color:var(--muted);padding:22px 0 0}
  .crumbs a{color:var(--muted)}
  article{max-width:760px;margin:0 auto;padding:10px 20px 30px}
  article h1{font-size:clamp(28px,4.6vw,40px);font-weight:800;letter-spacing:-.02em;line-height:1.15;margin:14px 0 10px}
  .post-meta{font-size:14px;color:var(--muted);margin-bottom:22px}
  article h2{font-size:clamp(21px,3vw,26px);font-weight:800;letter-spacing:-.01em;margin:38px 0 12px;line-height:1.25}
  article h3{font-size:18px;font-weight:700;margin:26px 0 8px}
  article p,article li{font-family:"Source Serif 4",Georgia,"Times New Roman",serif;font-size:17.5px;line-height:1.85}
  article p{margin:0 0 18px}
  article li{margin-bottom:9px}
  article ol,article ul{padding-left:24px;margin:0 0 18px}
  .lead{font-size:19.5px;color:var(--ink)}
  .hero-img{margin:0 0 26px}
  .hero-img img{width:100%;height:auto;border-radius:16px;display:block;box-shadow:0 4px 18px rgba(16,24,40,.10)}
  .sample-cap,.cta-inline p,.post-meta{font-family:Inter,system-ui,sans-serif}
  .answer{background:var(--accent-bg);border:1px solid var(--accent-line);border-radius:14px;padding:16px 18px;margin:0 0 22px}
  .answer p{margin:0;font-size:16.5px}
  .callout{border-radius:14px;padding:14px 18px;margin:0 0 18px;border:1px solid}
  .callout.tip{background:var(--accent-bg);border-color:var(--accent-line)}
  .callout.warn{background:hsl(38 92% 95%);border-color:hsl(38 70% 80%)}
  .callout p{margin:0}
  .callout b:first-child{display:block;margin-bottom:4px}
  table.cmp{width:100%;border-collapse:collapse;font-size:14.5px;margin:0 0 18px}
  table.cmp th{background:var(--accent-bg);color:var(--accent-fg);text-align:left;padding:9px 10px;border:1px solid var(--accent-line);font-size:13px}
  table.cmp td{padding:9px 10px;border:1px solid var(--card-line);vertical-align:top}
  .tbl-scroll{overflow-x:auto;margin:0 0 18px}
  .tbl-scroll table.cmp{margin:0;min-width:560px}

  /* ── Rendered sample document ── */
  .sample-doc{background:#fff;border:1px solid var(--card-line);border-radius:14px;padding:26px 26px 22px;margin:0 0 8px;box-shadow:0 1px 3px rgba(16,24,40,.07);font-size:13.5px}
  .sample-doc .sd-top{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap}
  .sample-doc .sd-kicker{font-size:20px;font-weight:800;letter-spacing:.04em;color:#0E8C5A}
  .sample-doc .sd-biz{font-weight:800;font-size:16px}
  .sample-doc .sd-mut{color:var(--muted);font-size:12.5px}
  .sample-doc .sd-bill{margin:14px 0 10px;padding:10px 12px;background:#F8FAFC;border-radius:10px}
  .sample-doc table{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}
  .sample-doc thead th{background:#0E8C5A;color:#fff;padding:7px 9px;text-align:left}
  .sample-doc thead th.r,.sample-doc td.r{text-align:right}
  .sample-doc tbody td{padding:7px 9px;border-bottom:1px solid #EEF2F6}
  .sample-doc tfoot td{padding:6px 9px;text-align:right}
  .sample-doc .sd-total td{font-weight:800;font-size:14.5px;color:#0E8C5A}
  .sample-doc ol{padding-left:18px;margin:6px 0 0;font-size:12.5px;color:#475569}
  .sample-cap{font-size:13px;color:var(--muted);margin:0 0 22px}

  /* ── CTA panel inside articles ── */
  .cta-inline{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;background:linear-gradient(135deg,var(--green),#0a6e46);border-radius:16px;padding:20px 22px;margin:26px 0}
  .cta-inline b{color:#fff;font-size:17px}
  .cta-inline p{color:#DCFCE7;margin:2px 0 0;font-size:14px}
  .cta-inline .btn{background:#fff;color:var(--green-d);flex:none}
  .cta-inline .btn:hover{background:#F0FDF4}

  /* ── FAQ ── */
  .faq h3{margin-top:20px}
  .faq p{color:var(--muted)}

  /* ── Index cards ── */
  .hero{padding:52px 0 8px;text-align:center}
  .hero h1{font-size:clamp(28px,5vw,42px);font-weight:800;letter-spacing:-.02em;margin:0 0 10px}
  .hero p.sub{font-size:clamp(16px,2.2vw,19px);color:var(--muted);max-width:640px;margin:0 auto}
  .post-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px;padding:34px 0 10px}
  .post-card{display:flex;flex-direction:column;background:var(--card);border:1px solid var(--card-line);border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgba(16,24,40,.04);color:var(--ink)}
  .post-card:hover{text-decoration:none;border-color:var(--green);box-shadow:0 4px 14px rgba(16,24,40,.08)}
  .post-card img{width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;display:block}
  .post-card .pc-body{display:flex;flex-direction:column;flex:1;padding:20px 22px 22px}
  .post-card h2{font-size:19px;font-weight:800;line-height:1.3;margin:0 0 8px;color:var(--ink)}
  .post-card p{color:var(--muted);font-size:14.5px;margin:0 0 14px;flex:1}
  .post-card .pc-meta{font-size:13px;color:var(--muted)}
  .post-card .go{color:var(--green);font-weight:700;font-size:14px;margin-top:8px}

  /* ── Trial CTA band (the funnel) ── */
  .cta-band{background:linear-gradient(135deg,var(--green),#0a6e46);margin-top:40px}
  .cta-band .wrap{padding:44px 20px;text-align:center}
  .cta-band h2{color:#fff;font-size:clamp(22px,3.5vw,30px);font-weight:800;margin:0 0 8px}
  .cta-band p{color:#DCFCE7;max-width:600px;margin:0 auto 20px;font-size:16px}
  .cta-band .btn{background:#fff;color:var(--green-d)}
  .cta-band .btn:hover{background:#F0FDF4}
  .cta-band .sub-note{display:block;color:#A7F3D0;font-size:13px;margin-top:12px}

  /* ── Related posts ── */
  .related{max-width:760px;margin:0 auto;padding:0 20px 10px}
  .related h2{font-size:20px;font-weight:800;margin:0 0 14px}
  .rel-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  @media(max-width:640px){.rel-grid{grid-template-columns:1fr}}
  .rel-card{background:var(--card);border:1px solid var(--card-line);border-radius:14px;padding:16px;color:var(--ink);font-weight:700;font-size:15px;line-height:1.35}
  .rel-card:hover{text-decoration:none;border-color:var(--green)}
  .rel-card span{display:block;color:var(--muted);font-weight:500;font-size:13px;margin-top:5px}
</style>`;

function header(): string {
  return `<header class="site"><div class="wrap">
    <a class="brand" href="/" aria-label="DealInSec home">${LOGO_SVG}<span class="brand-text">Deal<span class="brand-accent">insec</span></span></a>
    <nav class="nav">
      <a href="/blog" class="active">Blog</a>
      <a href="/tools">Free Tools</a>
      <a href="/">Product</a>
      <a href="mailto:support@dealinsec.com">Contact</a>
    </nav>
    <a class="btn" href="${SIGNUP}">Start free →</a>
  </div></header>`;
}

function footer(): string {
  return `<footer class="site"><div class="wrap">
    <div class="links">
      <a href="/blog">Blog</a>
      <a href="/tools">Free Tools</a>
      <a href="/tools/quotation-maker">Quotation Maker</a>
      <a href="/tools/gst-invoice-generator">GST Invoice Generator</a>
      <a href="/">Product</a>
      <a href="/terms">Terms</a>
      <a href="/privacy">Privacy</a>
    </div>
    <div class="muted">© 2026 DealInSec — quotations, e-signed agreements and invoices for India's service businesses. Articles are general information, not legal or tax advice.</div>
  </div></footer>`;
}

/** Bottom-of-page conversion band — every blog page funnels into the app. */
function ctaBand(): string {
  return `<div class="cta-band"><div class="wrap">
    <h2>Stop retyping the same deal three times</h2>
    <p>DealInSec turns one deal into a quotation, an e-signed agreement and an invoice that always agree with each other — and tells you who hasn't paid.</p>
    <a class="btn" href="${SIGNUP}">Start your 7-day free trial →</a>
    <span class="sub-note">No card required · Free plan after the trial · Made for Indian service businesses</span>
  </div></div>`;
}

function shell(o: {
  title: string;
  description: string;
  canonicalPath: string;
  jsonLd: object[];
  bodyHtml: string;
  ogType?: string;
  ogImage?: HeroImage;
}): string {
  const canonical = SITE_ORIGIN + o.canonicalPath;
  const ld = o.jsonLd
    .map((b) => `<script type="application/ld+json">${JSON.stringify(b).replace(/</g, "\\u003c")}</script>`)
    .join("\n");
  const ogImg = o.ogImage
    ? `<meta property="og:image" content="${SITE_ORIGIN}${esc(o.ogImage.src)}" />
<meta property="og:image:width" content="${o.ogImage.w}" />
<meta property="og:image:height" content="${o.ogImage.h}" />
<meta property="og:image:alt" content="${esc(o.ogImage.alt)}" />
<meta name="twitter:image" content="${SITE_ORIGIN}${esc(o.ogImage.src)}" />`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}" />
<link rel="canonical" href="${canonical}" />
<meta name="robots" content="index,follow" />
<meta property="og:type" content="${o.ogType || "website"}" />
<meta property="og:title" content="${esc(o.title)}" />
<meta property="og:description" content="${esc(o.description)}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:site_name" content="DealInSec" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(o.title)}" />
<meta name="twitter:description" content="${esc(o.description)}" />
${ogImg}
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap" rel="stylesheet" />
${STYLES}
${ld}
</head>
<body>
${header()}
${o.bodyHtml}
${ctaBand()}
${footer()}
</body>
</html>`;
}

/* ── Shared fragments ──────────────────────────────────────────────────── */

const fmtDate = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function ctaInline(heading: string, sub: string, href: string, label: string): string {
  return `<div class="cta-inline"><div><b>${esc(heading)}</b><p>${esc(sub)}</p></div><a class="btn" href="${esc(href)}">${esc(label)}</a></div>`;
}

/** The rendered sample quotation used by the format + how-to posts. */
const SAMPLE_QUOTE = `<div class="sample-doc" role="img" aria-label="Sample quotation for an interior design project">
  <div class="sd-top">
    <div>
      <div class="sd-biz">Meraki Design Studio</div>
      <div class="sd-mut">GSTIN: 19AAAPM1234C1ZX</div>
      <div class="sd-mut">Hill Cart Road, Siliguri, West Bengal 734001</div>
    </div>
    <div style="text-align:right">
      <div class="sd-kicker">QUOTATION</div>
      <div># QUO-2026-014</div>
      <div class="sd-mut">Date: 13 Aug 2026</div>
      <div class="sd-mut">Valid until: 12 Sep 2026</div>
    </div>
  </div>
  <div class="sd-bill">
    <div class="sd-mut" style="text-transform:uppercase;letter-spacing:.05em;font-size:11px">Quotation for</div>
    <div style="font-weight:700">Ashiyana Properties Pvt Ltd</div>
    <div class="sd-mut">Sevoke Road, Siliguri, West Bengal 734001</div>
  </div>
  <table>
    <thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
    <tbody>
      <tr><td>Concept design &amp; 3D visualisation — 2BHK show flat</td><td class="r">1</td><td class="r">₹60,000</td><td class="r">₹60,000</td></tr>
      <tr><td>Site supervision &amp; execution management (3 months)</td><td class="r">3</td><td class="r">₹15,000</td><td class="r">₹45,000</td></tr>
      <tr><td>Material selection &amp; vendor coordination</td><td class="r">1</td><td class="r">₹30,000</td><td class="r">₹30,000</td></tr>
    </tbody>
    <tfoot>
      <tr><td colspan="3" class="sd-mut">Subtotal</td><td class="r">₹1,35,000</td></tr>
      <tr><td colspan="3" class="sd-mut">CGST (9%)</td><td class="r">₹12,150</td></tr>
      <tr><td colspan="3" class="sd-mut">SGST (9%)</td><td class="r">₹12,150</td></tr>
      <tr class="sd-total"><td colspan="3">Total</td><td class="r">₹1,59,300</td></tr>
    </tfoot>
  </table>
  <div style="margin-top:8px;font-size:12.5px"><b>Amount in words:</b> One Lakh Fifty-Nine Thousand Three Hundred Rupees Only</div>
  <div style="margin-top:12px">
    <div class="sd-mut" style="text-transform:uppercase;letter-spacing:.05em;font-size:11px;margin-bottom:3px">Terms &amp; conditions</div>
    <ol>
      <li>This quotation is valid for 30 days from the date of issue.</li>
      <li>50% advance payment is required to confirm the project.</li>
      <li>The remaining 50% is due within 7 days of final delivery.</li>
      <li>Prices are exclusive of any work not listed above.</li>
    </ol>
  </div>
</div>
<p class="sample-cap">A sample service quotation. You can recreate this exact layout with the <a href="/tools/quotation-maker">free quotation maker</a> — no sign-up needed.</p>`;

/* ── Posts ─────────────────────────────────────────────────────────────── */

const POSTS: BlogPost[] = [
  /* ── 1. Quotation format ─────────────────────────────────────────────── */
  {
    slug: "quotation-format",
    title: "Quotation Format: What to Include, With a Free Sample (India)",
    metaTitle: "Quotation Format (India) — What to Include + Free Sample",
    description:
      "The quotation format Indian service businesses actually use: the 9 fields every quote needs, a filled-in sample, GST treatment, and free templates you can download as PDF.",
    date: "2026-08-13",
    readMins: 7,
    excerpt:
      "The 9 fields every quotation needs, a filled-in sample you can copy, and how GST fits in — the complete quote format for Indian service businesses.",
    hero: {
      src: "/blog/quotation-format-review.webp",
      alt: "Two people reviewing a printed quotation at a desk with laptops",
      w: 1600,
      h: 1068,
    },
    faq: [
      {
        q: "What is the standard quotation format?",
        a: "A standard quotation shows the seller's business details, a quotation number and date, a validity date, the client's details, an itemised table of work with quantities and rates, taxes such as GST if applicable, the total with the amount in words, terms and conditions, and a signature. The same format works for a quote, an estimate or a proposal cover.",
      },
      {
        q: "Is a quotation format different from an invoice format?",
        a: "Yes. A quotation is an offer sent before the work begins — it proposes a price and terms. An invoice is a bill sent to collect payment for work delivered, and a GST tax invoice has mandatory fields under GST rules. Never send an invoice where a quotation is expected: it looks like a demand for payment.",
      },
      {
        q: "Is a quotation legally binding in India?",
        a: "Generally, a quotation is an offer, not a contract. A binding agreement is normally formed when the client accepts the offer — which is why quotations carry a validity date and clear terms, and why important projects should move from an accepted quotation to a written, signed agreement. This is general information, not legal advice.",
      },
      {
        q: "Should a quotation include GST?",
        a: "If you are GST-registered, show GST as a separate line so the client sees the final payable amount — most services attract 18%. If you are not registered, do not add GST; you may note 'GST not applicable'. A quotation itself creates no tax liability — tax applies on the invoice you raise later.",
      },
      {
        q: "What is the difference between a quote format and a quotation format?",
        a: "Nothing — 'quote' is simply the shorter word for 'quotation'. Both refer to the same document and use the same format.",
      },
    ],
    body: `
<p class="lead">Your quotation is usually the first document a client sees from you. A clean, complete quotation format signals that you run a professional operation — a messy one invites bargaining and doubt. Here is the exact format Indian service businesses use, field by field, with a filled-in sample you can copy.</p>

<div class="answer"><p><b>Quick answer:</b> a quotation format has 9 parts — your business details, a quotation number, the date, a validity date, the client's details, an itemised work table, GST (if you're registered), the total with amount in words, and your terms &amp; conditions. Scroll down for a sample, or <a href="/tools/quotation-maker">build one free in your browser</a>.</p></div>

<h2>A sample quotation format</h2>
<p>Before the theory, here is what a complete service quotation looks like:</p>
${SAMPLE_QUOTE}

<h2>The 9 fields every quotation format needs</h2>
<ol>
  <li><b>Your business details.</b> Business name, address, phone and email — and your GSTIN if you are registered. This is your letterhead; a logo helps but isn't required.</li>
  <li><b>Quotation number.</b> A simple running series like QUO-2026-014. Numbering makes follow-ups unambiguous ("regarding quotation 014") and looks organised. Don't restart from 001 for every client.</li>
  <li><b>Date of issue.</b> The day you send it — the validity clock starts here.</li>
  <li><b>Validity date.</b> "Valid until 12 Sep 2026" or "valid for 30 days". Without it, a client can accept your January price in December after your costs have risen. This is the single most-skipped field and the one that costs real money.</li>
  <li><b>Client details.</b> The client's legal name and address. If the client is a company, quote to the company, not to the individual you spoke with.</li>
  <li><b>Itemised work table.</b> One row per deliverable: description, quantity, rate, amount. Break the work down — a single row saying "Interior design work — ₹1,35,000" invites a discount conversation; three specific rows justify the price.</li>
  <li><b>Taxes.</b> If GST-registered, show GST separately (CGST + SGST within your state, IGST across states — most services are 18%). If not registered, leave tax out entirely.</li>
  <li><b>Total and amount in words.</b> The grand total, prominent, with the amount written in words ("One Lakh Fifty-Nine Thousand Three Hundred Rupees Only") — the traditional guard against altered figures.</li>
  <li><b>Terms &amp; conditions.</b> Validity, advance percentage, balance-payment timeline, what's excluded, and how many revisions are included. These terms carry forward into your agreement and invoice, so make sure they don't contradict each other.</li>
</ol>

${ctaInline("Skip the formatting — use the free maker", "Line items, GST, terms and amount-in-words handled for you. Download as PDF, no sign-up.", "/tools/quotation-maker", "Make a quotation →")}

<h2>Quotation format with GST vs without GST</h2>
<p>The same format handles both cases — only the tax block changes:</p>
<div class="tbl-scroll"><table class="cmp">
  <tr><th></th><th>GST-registered business</th><th>Not registered</th></tr>
  <tr><td><b>GSTIN on the quotation</b></td><td>Yes, in the header</td><td>No</td></tr>
  <tr><td><b>Tax lines</b></td><td>CGST + SGST (same state) or IGST (different state), shown separately below the subtotal</td><td>None — optionally note "GST not applicable"</td></tr>
  <tr><td><b>Rate for most services</b></td><td>18%</td><td>—</td></tr>
  <tr><td><b>Tax liability from the quotation</b></td><td>None — tax applies on the invoice, not the quote</td><td>None</td></tr>
</table></div>
<p>Two honest notes: a quotation is not a tax document, so nothing you put on it creates a GST liability by itself; and GST rates vary by service, so check the rate for your specific work rather than assuming 18% (beauty services, catering and tour operators, for example, differ).</p>

<h2>Word, Excel or an online quotation maker?</h2>
<p>All three produce the same format — they differ in effort and error rate:</p>
<div class="tbl-scroll"><table class="cmp">
  <tr><th>Method</th><th>Good</th><th>Bad</th></tr>
  <tr><td><b>Word / Google Docs</b></td><td>Full layout control</td><td>You compute every total by hand; alignment breaks; amount-in-words is manual</td></tr>
  <tr><td><b>Excel / Sheets</b></td><td>Formulas do the math</td><td>Looks like a spreadsheet unless you invest real formatting time; GST split is easy to get wrong</td></tr>
  <tr><td><b>Online quotation maker</b></td><td>Math, GST split and amount-in-words automatic; clean PDF in minutes</td><td>Less pixel-level control than Word</td></tr>
</table></div>
<p>If you send more than a couple of quotations a month, the maker wins on time alone — and every quotation comes out in the same consistent format, which is half of looking professional. <a href="/blog/how-to-make-a-quotation-online">Here's the full step-by-step</a>.</p>

<h2>Common quotation format mistakes</h2>
<ul>
  <li><b>No validity date</b> — the client accepts months later at last year's price.</li>
  <li><b>Payment terms that contradict each other</b> — "50% advance" in one line, "full payment on delivery" in another. Whatever the client prefers is what they'll claim you meant.</li>
  <li><b>One vague line item</b> — "Website work: ₹80,000" reads as negotiable; six itemised rows read as priced.</li>
  <li><b>Calling it an invoice</b> — a quotation proposes, an invoice demands. Sending an "invoice" before any agreement feels presumptuous and can confuse the client's accounts team.</li>
  <li><b>Different numbers on different documents</b> — the quotation says ₹1,35,000 and the agreement says ₹1,30,000 after a phone-call discount nobody wrote down. Keep every document in the chain consistent.</li>
</ul>

<h2>From quotation to getting paid</h2>
<p>The format above gets you a professional quotation. What happens after acceptance matters more: the quoted scope and amount should flow into a written agreement, and the agreement into the invoice, with no retyping and no drift between documents. That chain — quote → agreement → invoice, all agreeing with each other — is exactly what <a href="/">DealInSec</a> automates for service businesses, with a 7-day free trial and no card required.</p>
`,
  },

  /* ── 2. How to make a quotation online ───────────────────────────────── */
  {
    slug: "how-to-make-a-quotation-online",
    title: "How to Make a Quotation Online — Free, in Under 5 Minutes",
    metaTitle: "How to Make a Quotation Online Free (India, Step-by-Step)",
    description:
      "Make a professional quotation online free: a step-by-step guide for Indian freelancers and service businesses — line items, GST, terms, instant PDF, no sign-up.",
    date: "2026-08-13",
    readMins: 6,
    excerpt:
      "The step-by-step way to make a quotation online — items, GST, terms and a PDF your client takes seriously. Free tool included, no sign-up.",
    hero: {
      src: "/blog/make-quotation-online-desk.webp",
      alt: "Laptop, coffee and a notepad on a desk — making a quotation online",
      w: 1600,
      h: 1067,
    },
    faq: [
      {
        q: "Can I make a quotation online for free?",
        a: "Yes. DealInSec's free quotation maker runs in your browser with no sign-up: add your details, line items, optional GST and terms, and download the finished quotation as a PDF. Everything stays on your device.",
      },
      {
        q: "What details do I need to make a quotation?",
        a: "Your business name and contact details (plus GSTIN if registered), the client's name and address, a description of each piece of work with quantity and rate, your payment terms, and a validity period — 15 to 30 days is typical.",
      },
      {
        q: "What file format should I send a quotation in?",
        a: "PDF. It looks identical on every device, can't be edited casually, and prints cleanly. Avoid sending editable Word or Excel files — and avoid screenshots, which look unprofessional and are hard to read.",
      },
      {
        q: "Should I make a quotation in Word or online?",
        a: "Word gives you layout control but you compute totals, tax and amount-in-words by hand — the classic source of embarrassing math errors. An online maker does the calculations automatically and produces a consistent format every time, which is faster once you send quotations regularly.",
      },
      {
        q: "How should I number my quotations?",
        a: "Use one running series that never restarts, like QUO-2026-001, 002, 003. The year in the prefix keeps the series tidy, and unique numbers make follow-up emails and revisions unambiguous.",
      },
    ],
    body: `
<p class="lead">A client says "send me a quotation" — and suddenly you're fighting Word margins at 11pm. Making a quotation online is faster and comes out cleaner: here is the complete process, using a free tool, from blank page to a PDF in your client's WhatsApp.</p>

<div class="answer"><p><b>Quick answer:</b> open a free online quotation maker, fill in your business and client details, add each piece of work as a line item with a rate, pick GST if you're registered, set the validity and payment terms, and download the PDF. The whole thing takes about five minutes: <a href="/tools/quotation-maker">start here, no sign-up</a>.</p></div>

<h2>Before you start: keep these 5 things handy</h2>
<ul>
  <li>Client's exact name and address (company name if it's a company)</li>
  <li>The work broken into 2–8 items, each with a price</li>
  <li>Your GSTIN, if registered</li>
  <li>Your payment split — e.g. 50% advance, 50% on delivery</li>
  <li>How long the price holds — 15 or 30 days is typical</li>
</ul>

<h2>Step-by-step: making the quotation online</h2>
<ol>
  <li><b>Open the quotation maker.</b> The <a href="/tools/quotation-maker">free DealInSec quotation maker</a> runs entirely in your browser — nothing you type is uploaded, and there's no account wall before the download.</li>
  <li><b>Add your business identity.</b> Name, address, GSTIN if you have one, and a logo if you want the quotation on your letterhead. This is what makes the PDF look like <i>your</i> document.</li>
  <li><b>Number and date it.</b> Use a running series (QUO-2026-014) and today's date, then set the <b>valid-until date</b>. Never skip validity — it's what stops a client accepting your old price after your costs change.</li>
  <li><b>Add the client.</b> Legal name and address. Quoting "Ashiyana Properties Pvt Ltd" reads very differently from quoting "Rahul sir".</li>
  <li><b>Itemise the work.</b> One line per deliverable with quantity and rate — the tool totals each row and the subtotal live. Specific rows ("Concept design &amp; 3D views — ₹60,000") justify your price; one fat row invites haggling.</li>
  <li><b>Handle GST.</b> Registered? Pick your rate — most services are 18% — and the correct split: CGST + SGST for a client in your state, IGST for another state. The tool computes it. Not registered? Choose "No GST" and the quotation stays clean.</li>
  <li><b>Set the terms.</b> Tick the standard terms that apply — validity, advance percentage, balance timeline, revision limits — and add anything project-specific. These same terms should later appear in your agreement, so keep them consistent.</li>
  <li><b>Download the PDF and send it.</b> Check the live preview, then download. Send the PDF by email with a two-line message, or straight on WhatsApp — PDF, not a screenshot.</li>
</ol>
<p>Here's the kind of document you end up with:</p>
${SAMPLE_QUOTE}

${ctaInline("Make yours now — it's free", "Line items, GST split and amount-in-words computed for you. PDF in minutes, no sign-up.", "/tools/quotation-maker", "Open the quotation maker →")}

<h2>After you hit send</h2>
<ul>
  <li><b>Follow up once, politely, before validity expires.</b> "Sharing a reminder that quotation QUO-2026-014 is valid till 12 Sep" is enough.</li>
  <li><b>If they negotiate, revise the document</b> — send QUO-2026-014-R1 with the new figure. Never leave the final price only in a phone call; the document the client accepted is the one that should match your agreement and invoice.</li>
  <li><b>On acceptance, get it in writing</b> — even a one-line email reply ("Approved, please proceed") converts your offer into something you can rely on. For serious projects, move to a signed agreement: our free <a href="/tools/service-agreement-template">service agreement template</a> is the next step, and inside <a href="/">DealInSec</a> the accepted quotation becomes an e-signable agreement and then an invoice with the same figures carried through automatically.</li>
</ul>

<h2>Mistakes that make online quotations look amateur</h2>
<ul>
  <li><b>Screenshot instead of PDF</b> — blurry, unprintable, and it signals improvisation.</li>
  <li><b>Math errors</b> — a subtotal that doesn't match the rows is the fastest way to lose trust. (This is the strongest argument for making the quotation online rather than in Word.)</li>
  <li><b>Missing validity or payment terms</b> — the two fields clients exploit, deliberately or not.</li>
  <li><b>Quoting from a personal email with no business identity</b> — a letterhead PDF from a numbered series reads like a business; a paragraph of prices typed into chat does not.</li>
</ul>

<h2>Related reading</h2>
<p>Not sure what goes <i>into</i> the document? See the full <a href="/blog/quotation-format">quotation format guide</a> — all 9 fields with a sample. And if you've been asked for a "sample" or dummy quotation, read <a href="/blog/fake-quotation">when a sample quotation is fine and when it's fraud</a> first.</p>
`,
  },

  /* ── 3. Fake quotation (honest intent-capture) ───────────────────────── */
  {
    slug: "fake-quotation",
    title: "\u201CFake Quotation\u201D: When a Sample Quote Is Fine — and When It's Fraud",
    metaTitle: "Fake Quotation vs Sample Quotation — What's Legal (India)",
    description:
      "Need a dummy or sample quotation? Here's what's perfectly legal (samples, mock-ups, practice documents), what counts as fraud in India, and how to spot a fake quotation someone sent you.",
    date: "2026-08-13",
    readMins: 5,
    excerpt:
      "Sample quotations for practice or demos are legal. Fabricated quotations passed off as genuine are fraud. The honest guide to the difference — and how to spot a fake quote you received.",
    hero: {
      src: "/blog/fake-quotation-check.webp",
      alt: "A hand with a pen examining a printed business document",
      w: 1600,
      h: 1068,
    },
    faq: [
      {
        q: "Is making a fake quotation illegal in India?",
        a: "Creating a sample or dummy quotation for practice, teaching or demos is legal. Fabricating a quotation and presenting it as genuine — to claim reimbursement, satisfy a three-quote procurement rule, support an insurance or loan claim, or inflate a project cost — can amount to cheating and forgery offences under Indian criminal law, and will usually also violate your employment or vendor agreements. This is general information, not legal advice.",
      },
      {
        q: "Can I use a dummy quotation for a college project or portfolio?",
        a: "Yes — that's a sample, not a fake. Use clearly fictional business and client names, and label it 'SAMPLE' if there's any chance it could be mistaken for a real offer.",
      },
      {
        q: "My company needs three quotations but I only found one vendor. Can I create the other two?",
        a: "No. Writing quotations yourself in other vendors' names defeats the entire purpose of the three-quote rule and is exactly the fabrication that gets employees dismissed and prosecuted. Ask more vendors for real quotes, or tell procurement you could only source one — most policies have a documented single-vendor exception.",
      },
      {
        q: "How do I check if a quotation sent to me is genuine?",
        a: "Verify the GSTIN on the official GST portal (gst.gov.in → Search Taxpayer), call the business on a number you find independently rather than the one printed on the document, and compare the price against two other market quotes. Mismatched contact details, a GSTIN that doesn't resolve to the business name, and prices far outside market range are the classic red flags.",
      },
    ],
    body: `
<p class="lead">A lot of people search for a "fake quotation" — and most of them don't want to commit a crime. They want a sample to learn the format, a dummy document for a demo or college project, or a realistic placeholder for budgeting. All of that is legal and there are free tools for it. But a fabricated quotation passed off as genuine is fraud, and the line between the two is worth understanding precisely.</p>

<div class="answer"><p><b>Quick answer:</b> a <b>sample</b> quotation (fictional details, used for learning, demos or budgeting) is perfectly legal — <a href="/tools/quotation-maker">make one free here</a>. A <b>fake</b> quotation (a fabricated document presented as a real offer to obtain money or approval) can amount to cheating and forgery under Indian criminal law. The document is the same; the deception is the crime.</p></div>

<h2>The legitimate reasons — and what to use instead</h2>
<ul>
  <li><b>You need to learn the format.</b> See our <a href="/blog/quotation-format">quotation format guide</a> — it includes a complete filled-in sample you can copy.</li>
  <li><b>You need a dummy document</b> — for a college assignment, a software demo, a portfolio mock-up or client training. Make one with fictional names in the <a href="/tools/quotation-maker">free quotation maker</a>; if it could be mistaken for a real offer, put "SAMPLE" in the notes.</li>
  <li><b>You need a realistic price for planning.</b> If you're budgeting a project and want a placeholder number, create an estimate and label it what it is — "internal estimate for budgeting". The moment a made-up document is shown to someone as a real vendor's offer, it stops being planning.</li>
  <li><b>You're a freelancer who needs a professional quote fast.</b> That's not a fake at all — that's just a real quotation, and it takes <a href="/blog/how-to-make-a-quotation-online">five minutes online</a>.</li>
</ul>

<h2>The line you cannot cross</h2>
<p>These are the uses that turn a harmless document into an offence:</p>
<ul>
  <li><b>Reimbursement fraud</b> — submitting an invented or inflated quotation to your employer to claim expenses.</li>
  <li><b>"Cover quotes" in procurement</b> — your company requires three competing quotations, so you write two extra ones in other vendors' names. This is the most common version, it's treated as fabrication of records, and it's the kind of thing internal audits are specifically designed to catch.</li>
  <li><b>Insurance, loan or visa support</b> — fabricating a quotation to inflate a claim or manufacture proof of expenses.</li>
  <li><b>Quoting in someone else's name</b> — creating a document on another business's letterhead without their knowledge, for any purpose.</li>
</ul>
<div class="callout warn"><p><b>Why it isn't worth it:</b> presenting a fabricated document as genuine to obtain money or approval can constitute cheating and forgery offences under Indian criminal law — and even where nobody prosecutes, it's summary-dismissal territory at any employer and permanent blacklisting for a vendor. A GSTIN takes ten seconds to verify online, which is how most fake quotations are actually caught.</p></div>

<h2>How to spot a fake quotation someone sent you</h2>
<p>The more useful skill: checking a quotation you <i>received</i>. Five checks, in order of power:</p>
<ol>
  <li><b>Verify the GSTIN</b> at <b>gst.gov.in → Search Taxpayer</b>. The registered legal name and state must match the letterhead. A missing GSTIN isn't proof of fraud (small vendors may be unregistered), but a GSTIN that doesn't resolve — or resolves to a different business — is a hard stop.</li>
  <li><b>Contact the business independently.</b> Find their number or website yourself and confirm they issued the quotation. Don't rely on the phone number printed on the document — a fabricated quote carries the fabricator's number.</li>
  <li><b>Compare against the market.</b> Get one or two more quotes. A figure dramatically above market (padding a claim) or below it (bait) deserves questions.</li>
  <li><b>Look at the document's hygiene.</b> Real vendors quote from a numbered series with consistent dates, math that adds up, and terms. Round-sum single-line quotations with no number, no validity and no terms are what fabrication typically looks like.</li>
  <li><b>Ask for a revision.</b> Request one item changed. A real vendor sends a revised quotation in minutes; a fabricator has to go manufacture a new document.</li>
</ol>

${ctaInline("Need the real thing?", "Make a genuine, professional quotation in five minutes — line items, GST, terms, instant PDF. Free, no sign-up.", "/tools/quotation-maker", "Make a real quotation →")}

<h2>The honest path is also the faster one</h2>
<p>The irony of the "fake quotation" search is that a real quotation is now easier to produce than a convincing fake. A <a href="/tools/quotation-maker">free online maker</a> gives you a numbered, itemised, GST-correct PDF in minutes — and if the work turns into a project, <a href="/">DealInSec</a> carries that quotation into a written agreement and an invoice that all agree with each other. That paper trail is what protects <i>you</i> when a client disputes scope or payment; it's the opposite of a fake, and it's the reason to get the document right from the first quote.</p>
`,
  },
];

/* ── Rendering ─────────────────────────────────────────────────────────── */

function relatedPosts(current: string): string {
  const cards = POSTS.filter((p) => p.slug !== current)
    .map(
      (p) => `<a class="rel-card" href="/blog/${esc(p.slug)}">${esc(p.title)}<span>${p.readMins} min read</span></a>`,
    )
    .join("");
  return `<section class="related"><h2>Keep reading</h2><div class="rel-grid">${cards}</div></section>`;
}

function postPage(p: BlogPost): string {
  const url = `${SITE_ORIGIN}/blog/${p.slug}`;
  const jsonLd: object[] = [
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: p.title,
      description: p.description,
      datePublished: p.date,
      dateModified: p.date,
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
      url,
      image: [SITE_ORIGIN + p.hero.src],
      author: { "@type": "Organization", name: "DealInSec", url: SITE_ORIGIN },
      publisher: { "@type": "Organization", name: "DealInSec", url: SITE_ORIGIN },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE_ORIGIN + "/" },
        { "@type": "ListItem", position: 2, name: "Blog", item: SITE_ORIGIN + "/blog" },
        { "@type": "ListItem", position: 3, name: p.title, item: url },
      ],
    },
  ];
  if (p.faq?.length) {
    jsonLd.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: p.faq.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    });
  }

  const faqHtml = p.faq?.length
    ? `<h2>Frequently asked questions</h2><div class="faq">${p.faq
        .map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`)
        .join("")}</div>`
    : "";

  const body = `
<div class="wrap"><nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/blog">Blog</a> › ${esc(p.title)}</nav></div>
<article>
  <h1>${esc(p.title)}</h1>
  <div class="post-meta">By the DealInSec team · ${fmtDate(p.date)} · ${p.readMins} min read</div>
  <figure class="hero-img"><img src="${esc(p.hero.src)}" alt="${esc(p.hero.alt)}" width="${p.hero.w}" height="${p.hero.h}" fetchpriority="high" /></figure>
  ${p.body}
  ${faqHtml}
</article>
${relatedPosts(p.slug)}`;

  return shell({
    title: `${p.metaTitle} | DealInSec Blog`,
    description: p.description,
    canonicalPath: `/blog/${p.slug}`,
    jsonLd,
    bodyHtml: body,
    ogType: "article",
    ogImage: p.hero,
  });
}

function indexPage(): string {
  const cards = POSTS.map(
    (p) => `<a class="post-card" href="/blog/${esc(p.slug)}">
      <img src="${esc(p.hero.src)}" alt="${esc(p.hero.alt)}" width="${p.hero.w}" height="${p.hero.h}" loading="lazy" />
      <div class="pc-body">
        <h2>${esc(p.title)}</h2>
        <p>${esc(p.excerpt)}</p>
        <div class="pc-meta">${fmtDate(p.date)} · ${p.readMins} min read</div>
        <span class="go">Read article →</span>
      </div>
    </a>`,
  ).join("\n");

  const body = `
<div class="hero"><div class="wrap">
  <h1>The DealInSec <span style="color:var(--green)">Blog</span></h1>
  <p class="sub">Practical guides on quotations, agreements, invoicing and getting paid — written for India's freelancers and service businesses.</p>
</div></div>
<section><div class="wrap"><div class="post-grid">${cards}</div></div></section>
<section><div class="wrap" style="text-align:center;padding-bottom:20px">
  <p class="muted">Prefer doing to reading? Try the <a href="/tools">free tools</a> — quotation maker, GST invoice generator, agreement template and more. No sign-up.</p>
</div></section>`;

  return shell({
    title: "Blog — Quotations, Agreements & Getting Paid | DealInSec",
    description:
      "Practical guides for Indian freelancers and service businesses: quotation formats, making quotations online, spotting fake quotes, agreements and invoicing.",
    canonicalPath: "/blog",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Blog",
        name: "DealInSec Blog",
        url: SITE_ORIGIN + "/blog",
        description: "Guides on quotations, agreements, invoicing and getting paid for Indian service businesses.",
        blogPost: POSTS.map((p) => ({
          "@type": "BlogPosting",
          headline: p.title,
          url: `${SITE_ORIGIN}/blog/${p.slug}`,
          datePublished: p.date,
        })),
      },
    ],
    bodyHtml: body,
  });
}

/* ── Public wiring ─────────────────────────────────────────────────────── */

export function blogSitemapPaths(): string[] {
  return ["/blog", ...POSTS.map((p) => `/blog/${p.slug}`)];
}

export function registerBlogPages(app: Express) {
  app.get("/blog", (_req, res) => res.type("html").send(indexPage()));
  for (const p of POSTS) {
    app.get(`/blog/${p.slug}`, (_req, res) => res.type("html").send(postPage(p)));
  }
}
