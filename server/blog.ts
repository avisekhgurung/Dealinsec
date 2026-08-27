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

  /* ── 4. Pillar: what is deal management software ─────────────────────── */
  {
    slug: "what-is-deal-management-software",
    title: "What Is Deal Management Software? A Plain-English Guide",
    metaTitle: "What Is Deal Management Software? (Plain-English Guide)",
    description:
      "Deal management software runs a client deal after the 'yes' — quotation, agreement, invoice and payment on one thread. What it is, how it differs from a CRM, and who actually needs it.",
    date: "2026-08-17",
    readMins: 7,
    excerpt:
      "It's not a CRM. Deal management software runs the deal after the client says yes — the documents and the money. Here's what it does and who needs it.",
    hero: {
      src: "/blog/deal-management-handshake.webp",
      alt: "Two people shaking hands on a business deal",
      w: 1600,
      h: 1068,
    },
    faq: [
      {
        q: "What is deal management software?",
        a: "Software that manages a client deal from agreed scope to collected payment: generating the quotation, converting acceptance into a signed agreement, raising invoices against that agreement, and tracking payment. Its defining feature is that all the documents in one deal stay consistent with each other.",
      },
      {
        q: "How is deal management software different from a CRM?",
        a: "A CRM manages relationships before the yes — leads, contacts, follow-ups, pipeline forecasting. Deal management software runs the deal after the yes — the documents (quotation, agreement, invoice) and the money. Many small service businesses need the second before they need the first: losing a lead hurts, but delivering work without a signed scope and then chasing payment hurts more.",
      },
      {
        q: "Do freelancers need deal management software, or only companies?",
        a: "The problem is per-deal, not per-headcount. A freelancer running four client projects has four quotations, four scopes and four payments to keep straight — the same failure modes as an agency, just smaller. Free plans (DealInSec's covers 4 deals a month) exist for exactly this stage.",
      },
      {
        q: "Is Excel enough for managing deals?",
        a: "Excel can list your deals; it can't keep a quotation, an agreement and an invoice consistent with each other, record acceptance, or chase payment dates on its own. Up to a couple of deals a month the manual overhead is tolerable — past that, the coordination errors start costing real money. See our honest comparison of quotation software vs Excel.",
      },
    ],
    body: `
<p class="lead">"Deal management software" sounds like enterprise jargon, so here's the plain version: it's the software that runs a client deal <i>after</i> the client says yes — the quotation, the agreement, the invoices and the payment — on one thread, so the documents never contradict each other and nothing falls through the gaps between them.</p>

<div class="answer"><p><b>Quick answer:</b> deal management software takes one deal — client, scope, value — and generates the quotation from it, turns acceptance into a signed agreement, raises invoices bounded by that agreement, and tracks payment. It's not a CRM (that's <i>before</i> the yes); it's the paperwork-and-money layer that CRMs stop at.</p></div>

<h2>The four stages every deal goes through</h2>
<ol>
  <li><b>Quotation.</b> The priced, itemised offer with terms — the document that sets every number that follows. (<a href="/blog/quotation-format">What goes into it.</a>)</li>
  <li><b>Agreement.</b> The accepted offer, in writing, with acceptance recorded — who, when, and on what terms.</li>
  <li><b>Invoicing.</b> Bills raised against the agreement — an advance and a balance, or milestones — that never exceed what was agreed.</li>
  <li><b>Payment.</b> Knowing what's overdue, what's due this week, and what's been delivered but never invoiced at all.</li>
</ol>
<p>Every service business already does all four. The question is only whether the four stages agree with each other — and that's precisely what breaks when the quotation is in WhatsApp, the agreement is a Word file in email, and the invoice is made fresh in some generator that never saw either.</p>

<h2>Deal management vs CRM — the line that matters</h2>
<div class="tbl-scroll"><table class="cmp">
  <tr><th></th><th>CRM (HubSpot, Zoho CRM, Pipedrive…)</th><th>Deal management (DealInSec)</th></tr>
  <tr><td><b>Phase</b></td><td>Before the yes — leads, contacts, follow-ups</td><td>After the yes — documents and money</td></tr>
  <tr><td><b>Core object</b></td><td>The relationship</td><td>The deal and its paper trail</td></tr>
  <tr><td><b>Output</b></td><td>A forecast</td><td>A quotation, a signed agreement, invoices, a payment record</td></tr>
  <tr><td><b>Fails when</b></td><td>Leads go cold unworked</td><td>Documents contradict each other; work starts unsigned; payment goes unchased</td></tr>
</table></div>
<p>Big companies run both. A small service business that must choose starts where its money actually leaks — and for most, that's not lost leads, it's <a href="/blog/how-to-manage-a-deal-from-quotation-to-invoice">deals that were won and then managed badly</a>.</p>

<h2>What to look for in deal management software</h2>
<ul>
  <li><b>One record, many documents</b> — the quotation, agreement and invoice generated from the same deal, not retyped three times.</li>
  <li><b>Documents that cross-reference</b> — the agreement cites the quotation it came from; the invoice cites the agreement it bills.</li>
  <li><b>Acceptance you can point to</b> — <a href="/e-signature">electronic acceptance with an audit record</a>, not a thumbs-up emoji.</li>
  <li><b>Invoice discipline</b> — consecutive numbering per financial year, and totals bounded by the agreement.</li>
  <li><b>A collectible view</b> — overdue / due this week / signed-but-not-invoiced, without opening a spreadsheet.</li>
  <li><b>India-ready documents</b> — ₹1,35,000-style formatting, GST awareness, PAN/GSTIN on your papers.</li>
  <li><b>Team roles</b> — an accounts person limited to invoices; a colleague who quotes but doesn't see the whole pipeline.</li>
</ul>

${ctaInline("See it on one real deal", "Create a deal, generate the quotation, convert it to an agreement, raise the invoice — 7-day free trial, no card.", SIGNUP, "Try DealInSec free →")}

<h2>Who actually needs it</h2>
<p>Deal-led service businesses: interior designers, architects, real estate consultants, marketing and digital agencies, construction contractors, consultants and freelancers — anyone whose work follows the quote → agree → deliver → bill arc. If you sell products off a shelf, you need billing/inventory software instead; if your problem is finding clients rather than papering them, you need a CRM first. DealInSec's stack covers the deal side: <a href="/quotation-software">quotation software</a>, <a href="/contract-management">contract management</a>, <a href="/invoice-management">invoice management</a> and <a href="/e-signature">e-signature</a> on one thread.</p>
`,
  },

  /* ── 5. Quotation software vs Excel ──────────────────────────────────── */
  {
    slug: "quotation-software-vs-excel",
    title: "Quotation Software vs Excel: An Honest Comparison",
    metaTitle: "Quotation Software vs Excel — An Honest Comparison",
    description:
      "Excel can make a quotation; the question is what it costs you after: math errors, lost versions, no follow-up, retyping into contracts and invoices. An honest look at when Excel is fine and when software wins.",
    date: "2026-08-17",
    readMins: 6,
    excerpt:
      "Excel can absolutely make a quotation. The honest question is what it costs after you hit send — math errors, lost versions, no follow-up, and retyping everything twice.",
    hero: {
      src: "/blog/quotation-software-vs-excel-laptop.webp",
      alt: "Laptop showing an analytics dashboard instead of a spreadsheet",
      w: 1600,
      h: 1140,
    },
    faq: [
      {
        q: "Is Excel good enough for making quotations?",
        a: "For one or two quotations a month, honestly, yes — a well-made template works. The costs appear at volume and after sending: manual totals and GST invite errors, versions multiply, nothing reminds you to follow up, and every accepted quote gets retyped into a contract and invoice. That follow-through is where Excel has no answer.",
      },
      {
        q: "What are the risks of quoting from Excel?",
        a: "The classic four: a subtotal that doesn't match the rows (broken formula, instant credibility loss), sending the wrong version after a negotiation, forgetting follow-up before validity expires, and figures drifting when the quote is retyped into the agreement and invoice. Each is rare per-quote but near-certain across a year of quoting.",
      },
      {
        q: "Is there a free alternative before buying software?",
        a: "Yes — DealInSec's free quotation maker runs in the browser with no sign-up: itemised rows, GST split, amount-in-words and a clean PDF. It replaces the Excel template with zero commitment; the paid app is for when you also want the agreement, invoice and payment tracking on the same thread.",
      },
      {
        q: "Can I import my existing Excel deal list?",
        a: "DealInSec supports CSV import for deals, so an existing Excel pipeline can be brought across rather than retyped.",
      },
    ],
    body: `
<p class="lead">Every service business starts by quoting from Excel or Word — and for a while it's genuinely fine. This is an honest comparison, not a scare piece: where Excel holds up, where it quietly costs you money, and what changing actually gets you.</p>

<div class="answer"><p><b>Quick answer:</b> Excel is fine at low volume if you're disciplined. It breaks on the follow-through: totals and GST are computed by hand, versions multiply during negotiation, nothing tracks follow-up or acceptance, and the accepted quote must be retyped into the agreement and invoice — which is where the numbers start disagreeing. Quotation software exists for everything after "send".</p></div>

<h2>Where Excel genuinely holds up</h2>
<ul>
  <li><b>Very low volume</b> — a quote or two a month, one person, no handoffs.</li>
  <li><b>Total layout control</b> — if your quotation is a bespoke design artifact, a document tool gives you pixel control software templates won't.</li>
  <li><b>Zero cost, zero learning</b> — you already know it.</li>
</ul>

<h2>The four ways Excel quoting costs real money</h2>
<ol>
  <li><b>The broken-formula quote.</b> A row gets inserted, the SUM range doesn't stretch, and the client receives a quotation whose total doesn't match its rows. Nothing kills trust faster than wrong arithmetic on a price document — and GST split by hand doubles the chances.</li>
  <li><b>The version shuffle.</b> Negotiation produces Quote_final, Quote_final2, Quote_FINAL_revised. Months later, the client claims the number from one file and you remember another. There is no authoritative record of which version was accepted.</li>
  <li><b>The silent expiry.</b> Excel doesn't know your quotation had a validity date, so nobody follows up before it lapses — or worse, a client "accepts" a stale price and you honour it out of awkwardness.</li>
  <li><b>The retype tax.</b> Every accepted quote is retyped into a contract, then into an invoice. Each retype is a chance for drift — and a quotation that says ₹1,35,000 while the agreement says ₹1,30,000 is a dispute waiting for a trigger. This is the deepest problem: it isn't fixable with a better template, only with <a href="/blog/what-is-deal-management-software">documents generated from one record</a>.</li>
</ol>

<h2>Side by side</h2>
<div class="tbl-scroll"><table class="cmp">
  <tr><th></th><th>Excel / Word template</th><th>Quotation software</th></tr>
  <tr><td><b>Totals &amp; GST</b></td><td>Manual formulas — yours to break</td><td>Computed, Indian formatting</td></tr>
  <tr><td><b>Numbering</b></td><td>Typed by hand, restarts when you forget</td><td>Automatic series</td></tr>
  <tr><td><b>Versions</b></td><td>Files multiplying in a folder</td><td>Revisions with history; the accepted one is authoritative</td></tr>
  <tr><td><b>Follow-up</b></td><td>Memory</td><td>Outstanding &amp; expiring quotes on a dashboard</td></tr>
  <tr><td><b>After acceptance</b></td><td>Retype into contract, retype into invoice</td><td>Agreement and invoice generated from the quote</td></tr>
  <tr><td><b>Cost</b></td><td>₹0</td><td>₹0 to start (free tool / free plan); ₹999/mo for Pro</td></tr>
</table></div>

${ctaInline("Replace the template first — it's free", "The free quotation maker does rows, GST and amount-in-words with no sign-up. Upgrade to the full thread only if you need it.", "/tools/quotation-maker", "Open the free maker →")}

<h2>The honest migration path</h2>
<p>Don't buy software on day one. Step 1: swap the Excel template for the <a href="/tools/quotation-maker">free quotation maker</a> — same five minutes, no math errors, no account. Step 2: when a quote turns into a real project, take the <a href="/">DealInSec trial</a> and run that one deal through quotation → agreement → invoice. If the thread saves you one retype and one awkward "which version?" conversation, you'll know whether it's worth ₹999 a month. If it doesn't — keep the free tool and lose nothing.</p>
`,
  },

  /* ── 6. Best quotation software India (buyer's guide) ────────────────── */
  {
    slug: "best-quotation-software-india",
    title: "Best Quotation Software for Small Businesses in India: A Buyer's Guide",
    metaTitle: "Best Quotation Software for Small Businesses in India (2026)",
    description:
      "How to choose quotation software in India: the 7-point checklist (GST, numbering, PDF quality, what happens after acceptance), the honest landscape — Zoho, Refrens, Vyapar, DealInSec — and how to test for free.",
    date: "2026-08-17",
    readMins: 8,
    excerpt:
      "Not a fake top-10 list — a 7-point checklist for choosing quotation software in India, an honest look at the landscape, and a way to test your shortlist for free.",
    hero: {
      src: "/blog/best-quotation-software-team.webp",
      alt: "Two colleagues celebrating over paperwork and a laptop",
      w: 1600,
      h: 1067,
    },
    faq: [
      {
        q: "Which is the best quotation software for a small business in India?",
        a: "The one that fits how you work — there's no universal winner. Product-and-inventory businesses lean toward billing suites like Vyapar; freelancers wanting free invoicing often use Refrens; Zoho Invoice suits businesses already inside Zoho's ecosystem; and service businesses that need the quotation to become an agreement and then invoices on one thread are what DealInSec is built for. Test against the checklist in this guide.",
      },
      {
        q: "Is there completely free quotation software?",
        a: "Yes. DealInSec's free quotation maker needs no account at all, and the app's free plan covers 4 deals a month after a 7-day Pro trial with no card. Several competitors also offer free tiers — check what each caps (documents, users, or features).",
      },
      {
        q: "Should quotation software handle GST?",
        a: "It should let you show GST on the quotation so the client sees the final payable amount — but remember a quotation is not a tax document; the tax event is the invoice. For GST tax invoices with CGST/SGST/IGST computed, DealInSec's free GST invoice generator handles it without a sign-up.",
      },
      {
        q: "What matters more — the quotation itself or what happens after?",
        a: "After. Most tools produce a similar-looking PDF. The differences that cost or save money are downstream: whether acceptance is recorded, whether the agreement and invoice inherit the quote's figures automatically, and whether anything reminds you to follow up and collect. Choose on the follow-through, not the template gallery.",
      },
    ],
    body: `
<p class="lead">Most "best quotation software" articles are a top-10 list of screenshots. This is a buyer's guide instead: the seven things that actually separate quotation tools for an Indian small business, an honest sketch of the landscape — including where our own product is <i>not</i> the right pick — and a way to test your shortlist in an afternoon for free.</p>

<div class="answer"><p><b>Quick answer:</b> judge quotation software on the follow-through, not the PDF. Any tool makes a decent-looking quote; the money is in what happens after — recorded acceptance, an agreement and invoice that inherit the figures, and follow-up you don't have to remember. For deal-led service businesses in India, that thread is exactly what <a href="/quotation-software">DealInSec</a> is; for inventory billing or pure accounting, other tools fit better.</p></div>

<h2>The 7-point checklist</h2>
<ol>
  <li><b>Indian documents by default.</b> ₹1,35,000-style formatting, amount in words, GST shown correctly (CGST/SGST vs IGST), PAN and GSTIN on the letterhead. If the tool was built for US invoicing, you'll fight it forever.</li>
  <li><b>Real numbering.</b> Automatic series that don't restart or duplicate — the thing clients, accountants and courts use to refer to your documents.</li>
  <li><b>A PDF you'd be proud to send.</b> Itemised table, terms, totals, clean typography — on your identity, not the vendor's branding.</li>
  <li><b>What happens after acceptance.</b> The big one. Does the accepted quote become an agreement? Does the agreement produce the invoices? Or do you retype everything into a different tool and hope the numbers stay aligned?</li>
  <li><b>Follow-up built in.</b> Outstanding quotes, expiring validity, unpaid invoices — visible without opening each document.</li>
  <li><b>Rupee-priced, small-business-sized.</b> Per-user dollar pricing gets absurd for a 3-person Indian firm. Look for flat plans in ₹.</li>
  <li><b>A free way to test.</b> A free tier or a no-card trial — you should never pay to find out a tool doesn't fit.</li>
</ol>

<h2>The landscape, honestly</h2>
<p>Four names come up constantly for Indian small businesses, and they're genuinely different tools:</p>
<div class="tbl-scroll"><table class="cmp">
  <tr><th>Tool</th><th>What it is</th><th>Natural fit</th></tr>
  <tr><td><b>Vyapar</b></td><td>GST billing &amp; accounting app with estimates/quotations alongside inventory and ledgers</td><td>Product businesses and shops that live in billing + stock</td></tr>
  <tr><td><b>Zoho Invoice</b></td><td>Invoicing product with estimates, part of the wider Zoho suite</td><td>Businesses already inside the Zoho ecosystem</td></tr>
  <tr><td><b>Refrens</b></td><td>Invoicing and quotation platform with a strong free tier, popular with freelancers</td><td>Freelancers who mainly need documents sent fast</td></tr>
  <tr><td><b>DealInSec</b></td><td>Deal management for service businesses — quotation → e-signed agreement → invoice → payment tracking on one thread</td><td>Deal-led service businesses: designers, architects, agencies, consultants, contractors</td></tr>
</table></div>
<p class="muted" style="font-size:14px">Descriptions kept to what each product plainly is — evaluate current features and pricing on their own sites; they all evolve.</p>

<h2>Where DealInSec is the right pick — and where it isn't</h2>
<ul>
  <li><b>Right pick:</b> your work follows quote → agree → deliver → bill, and your pain is documents drifting apart, unsigned work starting anyway, and payments going unchased. That thread is the product. (<a href="/blog/what-is-deal-management-software">More on deal management.</a>)</li>
  <li><b>Wrong pick:</b> you sell inventory (you need stock-aware billing — the Vyapar shape), you need full double-entry accounting (that's an accounting package), or you only ever need one quote a year (use our <a href="/tools/quotation-maker">free maker</a> and pay nobody).</li>
</ul>

${ctaInline("Test the whole thread in an afternoon", "Free 7-day trial, no card: run one real deal from quotation to invoice and judge it on your own client.", SIGNUP, "Start the trial →")}

<h2>How to run the test</h2>
<ol>
  <li>Pick one real, current deal — not a dummy.</li>
  <li>Make its quotation in each shortlisted tool. Time it, and look at the PDF a client would receive.</li>
  <li>Simulate acceptance: how does the quote become an agreement? Where does acceptance get recorded?</li>
  <li>Raise the advance invoice. Did the figures carry, or did you retype?</li>
  <li>Check the dashboard: does the tool know this deal's next action, or do you?</li>
</ol>
<p>Whichever tool needs the least retyping and remembers the most on your behalf — that's your answer, whoever makes it.</p>
`,
  },

  /* ── 7. Quotation vs proposal ────────────────────────────────────────── */
  {
    slug: "quotation-vs-proposal",
    title: "Quotation vs Proposal: What's the Difference, and When to Send Which",
    metaTitle: "Quotation vs Proposal — The Difference, With Examples",
    description:
      "Quotation vs proposal explained for Indian service businesses: what each contains, when clients expect which, how estimates fit in, and how one well-built document can serve as both.",
    date: "2026-08-17",
    readMins: 5,
    excerpt:
      "A quotation states the price; a proposal argues the approach. In scoped service work they converge into one document — here's when to send which, and why the difference stops mattering after acceptance.",
    hero: {
      src: "/blog/quotation-vs-proposal-discussion.webp",
      alt: "Two people discussing work across laptops at a table",
      w: 1600,
      h: 1067,
    },
    faq: [
      {
        q: "What is the difference between a quotation and a proposal?",
        a: "A quotation is a priced offer: itemised work, rates, taxes, terms and validity. A proposal wraps a recommended approach around the price — context, methodology, timeline — and argues why you're the right choice. For scoped service work the two converge: a quotation with well-written deliverables and notes reads as a proposal.",
      },
      {
        q: "Which should I send — a quotation or a proposal?",
        a: "Match the client's language and the deal's uncertainty. If they asked 'send me a quote', they want the number and terms — don't bury them in a deck. If the scope itself is undecided or you're competing on approach, send a proposal whose final section IS the quotation, so acceptance is unambiguous.",
      },
      {
        q: "Where does an estimate fit in?",
        a: "An estimate is a non-final ballpark given before the scope is firm — useful for budgeting, not for acceptance. The clean sequence is estimate (rough) → quotation/proposal (firm offer with validity) → agreement (accepted terms). Label estimates clearly so nobody treats a ballpark as a commitment.",
      },
      {
        q: "Is a proposal legally binding once the client accepts?",
        a: "Acceptance of a clear offer is generally how a contract forms, whichever word is on the document — which is why the priced section needs precise scope, terms and validity. For meaningful projects, move acceptance into a written, signed agreement rather than relying on an email 'looks good'. This is general information, not legal advice.",
      },
    ],
    body: `
<p class="lead">Clients use the words interchangeably; tools and templates treat them as different species. The truth for a service business is simpler: a <b>quotation states the price</b>, a <b>proposal argues the approach</b> — and for scoped service work, the winning document is usually both at once.</p>

<div class="answer"><p><b>Quick answer:</b> quotation = itemised price + terms + validity (the offer). Proposal = the same offer wrapped in context — the problem, your approach, timeline, why you. If the client said "send a quote", lead with the number. If you're competing on approach, send the proposal — but end it with a real quotation section so there's something precise to accept.</p></div>

<h2>Side by side</h2>
<div class="tbl-scroll"><table class="cmp">
  <tr><th></th><th>Quotation</th><th>Proposal</th></tr>
  <tr><td><b>Core job</b></td><td>State the price precisely</td><td>Sell the approach, then state the price</td></tr>
  <tr><td><b>Length</b></td><td>1–2 pages</td><td>2–10 pages</td></tr>
  <tr><td><b>Contains</b></td><td>Line items, rates, GST, total, terms, validity</td><td>Context, methodology, timeline, team — plus everything a quotation contains</td></tr>
  <tr><td><b>Client asked…</b></td><td>"What will it cost?"</td><td>"How would you do this — and what will it cost?"</td></tr>
  <tr><td><b>Common in</b></td><td>Trades, design, construction, most Indian SME work</td><td>Agencies, consulting, competitive pitches</td></tr>
</table></div>
<p>India note: "quotation" is by far the dominant word in Indian SME work — builders, designers and consultants are asked for quotations daily, proposals mostly in agency and consulting pitches. When in doubt, say quotation and nobody blinks.</p>

<h2>One document, both jobs</h2>
<p>The practical move is to stop choosing. Build your <a href="/blog/quotation-format">quotation properly</a> — itemised deliverables, notes that explain approach where it matters, terms and validity — and it functions as a compact proposal. In <a href="/proposal-management">DealInSec</a>, deliverable rows carry notes precisely so the "why this scope" narrative lives inside the priced document rather than in a separate deck the client skims once and loses.</p>

<h2>The difference stops mattering after acceptance</h2>
<p>Whichever word was on the document, acceptance is the moment it must become precise: agreed scope, agreed amount, agreed terms, in writing. That's the real chain — offer (quotation or proposal) → <a href="/contract-management">agreement</a> → <a href="/invoice-management">invoices</a> — and it's why the document you send should be built for conversion, not just persuasion. A beautiful proposal that ends in vague pricing produces a vague agreement and a disputed invoice.</p>

${ctaInline("Send one document that does both", "Itemised scope with notes, terms, validity — then acceptance becomes an agreement and invoices on the same thread.", "/tools/quotation-maker", "Build it free →")}
`,
  },

  /* ── 8. How to manage a deal from quotation to invoice ───────────────── */
  {
    slug: "how-to-manage-a-deal-from-quotation-to-invoice",
    title: "How to Manage a Deal From Quotation to Invoice (Without Dropping It)",
    metaTitle: "Manage a Deal From Quotation to Invoice — Step by Step",
    description:
      "The full lifecycle of a service deal in India — quotation, follow-up, agreement, invoicing, payment — the three points where deals get dropped, and how to run the thread manually or with software.",
    date: "2026-08-17",
    readMins: 7,
    excerpt:
      "Deals aren't lost at the quote — they're dropped in the gaps between documents. The six steps from quotation to collected payment, and the three drop points to guard.",
    hero: {
      src: "/blog/deal-thread-meeting.webp",
      alt: "A team discussing a project around a laptop in a meeting",
      w: 1600,
      h: 1067,
    },
    faq: [
      {
        q: "What are the stages of a client deal?",
        a: "Six, in practice: record the deal (client, scope, value); send the quotation with validity; follow up before it expires; convert acceptance into a written agreement; invoice against the agreement (advance and balance, or milestones); and track payment until closed. Most losses happen between stages, not within them.",
      },
      {
        q: "When should I send the invoice?",
        a: "The advance invoice immediately on signing — before work starts, per your agreed split (50% advance is the common Indian default). The balance invoice on delivery, with its due date printed. Invoicing late signals that paying late is fine.",
      },
      {
        q: "How do I stop work starting before the agreement is signed?",
        a: "Make the advance the trigger: the agreement states work begins on advance receipt, and the advance invoice goes out with the signed agreement. It converts an awkward conversation into a standard process the client expects.",
      },
      {
        q: "Can I manage all this without software?",
        a: "Yes, with discipline: one folder per deal, a numbering convention, calendar reminders for validity and due dates, and a weekly review of every open deal. That system genuinely works — its weakness is that it depends on you never skipping the ritual. Software's job is making the thread automatic instead of virtuous.",
      },
    ],
    body: `
<p class="lead">Service deals are rarely lost at the quotation — they're dropped in the gaps between documents: the quote nobody followed up, the project that started on a WhatsApp "ok", the delivery that took three weeks to get invoiced. Here's the whole thread, step by step, with the drop points marked.</p>

<div class="answer"><p><b>Quick answer:</b> record the deal → quotation with validity → follow up before expiry → convert acceptance into a signed agreement → invoice the advance on signing and the balance on delivery → track payment to closed. Guard the three gaps: after sending the quote, between "yes" and signature, and after delivery.</p></div>

<h2>The six steps</h2>
<ol>
  <li><b>Record the deal first.</b> Client, scope as deliverable line items, value, dates — one record that every document will be generated from. This is the step that makes consistency possible; skip it and you'll be retyping forever.</li>
  <li><b>Send the quotation — with a validity date.</b> Itemised, numbered, terms included (<a href="/blog/quotation-format">the full format</a>). Validity is your follow-up deadline, not decoration.</li>
  <li><b>Follow up once before expiry.</b> One polite reminder citing the quotation number, a few days before validity ends. Revisions get a new version — never a phone-call discount that lives nowhere.</li>
  <li><b>⚠ Convert the yes into a signed agreement.</b> The most dropped step in Indian service work: verbal approval feels like momentum, so work starts unsigned. The agreement should inherit the quotation's figures and be <a href="/e-signature">accepted electronically with a record</a> — and the advance invoice rides along with it.</li>
  <li><b>Invoice on the agreed split.</b> Advance on signing — work starts on receipt. Balance on delivery, due date printed, never exceeding the agreement's value. Consecutive numbering (INV-2627-0001…) so the series survives an audit.</li>
  <li><b>Track to closed.</b> A weekly look at three lists: overdue, due this week, and delivered-but-not-invoiced. The third list is where honest businesses quietly bleed.</li>
</ol>

<h2>The three drop points</h2>
<ul>
  <li><b>After the quote goes out.</b> No reminder exists, validity lapses, deal evaporates. Fix: follow-up is scheduled the moment the quote is sent.</li>
  <li><b>Between "yes" and signature.</b> Work starts on goodwill; scope disputes arrive later with no signed reference. Fix: advance-on-signing makes the signature the natural gate.</li>
  <li><b>After delivery.</b> The work is done, everyone relaxes, the invoice goes out late — or never. Fix: the balance invoice is prepared with the agreement, so delivery only needs a send.</li>
</ul>

${ctaInline("Run the thread automatically", "DealInSec generates each document from the deal record and shows you what needs action — quotation to collected payment.", SIGNUP, "Start free — no card →")}

<h2>Manual vs software, honestly</h2>
<p>The manual version of this system works: a folder per deal, a numbering convention, calendar reminders, a weekly review. Its cost isn't money — it's that every step depends on your discipline on a busy week, and the documents still can't check each other for drift. <a href="/blog/what-is-deal-management-software">Deal management software</a> exists to make the thread structural instead of virtuous: documents generated from one record can't disagree, and the dashboard remembers the follow-ups you'd otherwise carry in your head. Start manual; switch when a dropped deal costs more than ₹999.</p>
`,
  },

  {
    slug: "ra-bill-format",
    title: "RA Bill Format: What a Clean Running Account Bill Contains (and Why Yours Gets Stuck)",
    metaTitle: "RA Bill Format: Running Account Bills for Contractors",
    description: "Learn the RA bill format Indian contractors use: work order reference, cumulative vs current quantities, retention and deductions, and why bills get stuck.",
    date: "2026-08-27",
    readMins: 6,
    excerpt: "An RA bill is progressive billing for measured work. The clean format — cumulative quantities, retention, deductions — that gets certified faster.",
    hero: {"src":"/blog/ra-bill-construction-site.webp","alt":"Contractors reviewing progress on a construction site slab","w":1600,"h":1067},
    faq: [
      {
            "q": "What is an RA bill in construction?",
            "a": "An RA (Running Account) bill is an interim bill a contractor raises for work completed and measured up to a certain date, against the work order and BOQ. RA bills are raised in sequence — RA-1, RA-2, RA-3 — until the final bill closes the account. Payment is typically made after the client or their engineer certifies the measured quantities."
      },
      {
            "q": "What is the difference between an RA bill and a final bill?",
            "a": "An RA bill is an on-account, interim payment for work done so far — quantities can still be corrected in later bills. The final bill closes the running account: it reconciles all quantities against the work order and settles everything outstanding. Retention money is commonly released separately, after the defect liability period your contract specifies."
      },
      {
            "q": "How much retention money is held on RA bills?",
            "a": "There is no single standard rate — your contract governs. Retention is commonly a small percentage deducted from each RA bill and held until the defect liability period ends. Make sure the percentage, the total cap, and the release timeline are written into your work order before you start, and check anything unclear with your CA or lawyer."
      },
      {
            "q": "Why do RA bills get delayed?",
            "a": "The usual culprits are measurement disputes, bills that don't reference a signed work order, certification bottlenecks on the client's side, and confusion over retention and advance recovery. A clean paper trail — signed work order, joint measurement records, sequentially numbered bills — removes most excuses. If you're a Udyam-registered MSME, the MSMED Act 2006 generally caps the agreed payment period at 45 days; ask a CA about your specific situation."
      }
],
    body: "<p class=\"lead\">You finished the work weeks ago. The site engineer saw it, the measurements happened, and your RA bill is still \"under certification\". Meanwhile your labour wants their weekly payment and your material supplier is calling. Most stuck RA bills are stuck for one reason: the bill itself gave the client an excuse to sit on it.</p>\n\n<div class=\"answer\"><p><b>Quick answer:</b> An RA (Running Account) bill is a progressive bill a contractor raises for measured work completed up to a date, against a work order and BOQ. A clean RA bill format contains: the work order reference, bill number and period, item-wise measured quantities against the BOQ, cumulative value of work up to this bill minus the cumulative value billed in the previous RA bill, deductions (retention, advance recovery), net payable, and the amount in words.</p></div>\n\n<h2>What is an RA bill?</h2>\n<p>A running account bill is how construction and works contractors bill for a project in stages instead of waiting for the end. You do a portion of the work, the quantities are measured, and you raise a bill for the value of work done so far.</p>\n<p>The bills run in a sequence — RA-1, RA-2, RA-3 — and each one is an <b>on-account</b> payment, not a final settlement. The final bill at the end of the project closes the account and reconciles everything.</p>\n<p>Two things make RA bills different from a normal invoice:</p>\n<ul>\n<li><b>They're cumulative.</b> Each bill states the total value of work measured up to date, then subtracts what was already billed in previous RA bills. Only the difference is payable now.</li>\n<li><b>They're typically certified.</b> The client or their engineer checks your quantities against actual measurements before approving payment. No certification, no payment.</li>\n</ul>\n\n<h2>What a clean RA bill format contains</h2>\n<p>Every field below exists to remove a question the client could otherwise ask. Miss one, and your bill waits while someone \"checks with the engineer\".</p>\n<ul>\n<li><b>Project and work order reference</b> — the work order number, date, and project name. This ties your bill to an agreed scope and agreed rates.</li>\n<li><b>Bill number and period</b> — \"RA Bill No. 3, for work done from 1 July to 15 August\". Sequential numbering, no gaps.</li>\n<li><b>Item-wise measured quantities</b> — each BOQ item, the unit, the rate from the work order, quantity executed up to date, and the amount. Your numbers should trace back to measurement records.</li>\n<li><b>Cumulative vs this-bill amounts</b> — gross value of work up to this bill, minus gross value billed up to the previous RA bill, equals this bill's gross amount.</li>\n<li><b>Deductions</b> — retention money as per contract, recovery of any mobilisation advance, and other agreed recoveries, each shown on its own line.</li>\n<li><b>Net payable and amount in words</b> — the figure the client actually has to pay, written in both numbers and words.</li>\n</ul>\n<p>Here's how the money section of an RA-3 might look on a ₹48,00,000 work order:</p>\n<table>\n<tr><td>Gross value of work measured up to this bill</td><td>₹21,50,000</td></tr>\n<tr><td>Less: gross value billed up to RA-2</td><td>₹14,75,000</td></tr>\n<tr><td><b>Gross amount of this bill</b></td><td><b>₹6,75,000</b></td></tr>\n<tr><td>Less: retention (as per contract)</td><td>₹33,750</td></tr>\n<tr><td>Less: mobilisation advance recovery</td><td>₹1,00,000</td></tr>\n<tr><td><b>Net payable this bill</b></td><td><b>₹5,41,250</b></td></tr>\n</table>\n<p>If you need a professional-looking bill in minutes, the <a href=\"/tools/bill-generator\">free bill generator</a> gives you a clean format without signing up. And if you charge GST on your work, the <a href=\"/tools/gst-invoice-generator\">free GST invoice generator</a> computes CGST/SGST/IGST for you.</p>\n\n<h2>Why RA bills get stuck</h2>\n<p>Four problems cause most of the delay:</p>\n<ol>\n<li><b>Measurement disputes.</b> Your quantity says 1,240 sq. ft., their engineer says 1,180. If measurements weren't recorded jointly as the work happened, this becomes your word against theirs — and the bill waits.</li>\n<li><b>Missing work order reference.</b> A bill that doesn't point to a signed work order with agreed rates invites the client to renegotiate the rate after the work is done.</li>\n<li><b>Certification delays.</b> The engineer is busy, on leave, or waiting for someone else. A bill with clean, traceable quantities gets certified fast; a messy one goes to the bottom of the pile.</li>\n<li><b>Retention confusion.</b> If the retention percentage or release timing was never written down, every bill becomes a fresh negotiation about how much to hold back.</li>\n</ol>\n<p>This is where keeping the whole deal on one thread helps. DealInSec keeps your quotation, e-signed agreement, invoices, and payment status in one place, so every RA bill traces back to signed, agreed terms — and its Protection Check flags risky gaps like a missing retention release timeline before you sign. The free plan covers 4 deals a month.</p>\n\n__CTA__\n\n<h2>Retention money: get the release timeline in writing</h2>\n<p>Retention is an amount — commonly a small percentage of each bill — that the client holds back as security until the defect liability period ends. The idea is fair: if defects show up after handover, the client has something in hand.</p>\n<p>The problem is almost never the deduction. It's the release. Contractors routinely chase retention money long after the project ends because nothing was written about <b>when</b> it comes back.</p>\n<p>Before you start work, get three things in writing:</p>\n<ul>\n<li>The retention percentage per bill, and any total cap.</li>\n<li>The length of the defect liability period, and when it starts (usually handover or completion — but say so explicitly).</li>\n<li>The release timeline: within how many days after the defect liability period ends the retention will be paid.</li>\n</ul>\n<p>There's no universal retention rate — your contract governs. If a clause looks unusual or one-sided, have a CA or lawyer look at it before you sign.</p>\n\n<h2>The paper trail that gets RA bills certified faster</h2>\n<p>A clean RA bill format only works if the documents behind it exist. Three habits do most of the work:</p>\n<ul>\n<li><b>A signed work order before you mobilise.</b> Scope, BOQ rates, billing cycle, retention terms, payment period. A <a href=\"/tools/service-agreement-template\">written agreement</a> — even a simple one — beats a WhatsApp \"ok done\" every time. Electronic contracts are generally recognised in India under Section 10A of the IT Act 2000.</li>\n<li><b>Joint measurement records.</b> Measure with the client's representative present, get both signatures, and date every entry. Certification becomes a formality instead of a fight.</li>\n<li><b>Sequentially numbered bills.</b> RA-1, RA-2, RA-3 with no gaps, each referencing the work order and the previous bill's cumulative value. Anyone auditing the account can follow the money in minutes.</li>\n</ul>\n<p>This paper trail also matters if payment stops entirely. If you're a Udyam-registered MSME, the MSMED Act 2006 generally requires buyers to pay within the agreed period, capped at 45 days, and delayed payments commonly accrue compound interest at three times the RBI-notified bank rate under that Act. The MSME Samadhaan portal lets registered businesses file delayed-payment claims — but it needs documentation: your Udyam registration, invoices, and proof of work done. Contractors with signed work orders, measurement records, and numbered RA bills have that file ready. Those without, don't.</p>\n<p>These provisions have conditions and exceptions, so talk to a CA or lawyer before relying on them for your specific case.</p>".replace("__CTA__", ctaInline("Make a clean, numbered bill in minutes", "The free bill generator handles items, totals and amount-in-words — no sign-up.", "/tools/bill-generator", "Open the bill generator →")),
  },

  {
    slug: "msme-payment-rule-45-days-samadhaan",
    title: "The MSME 45-Day Payment Rule and Samadhaan: How to Recover Delayed Payments",
    metaTitle: "MSME 45-Day Payment Rule & Samadhaan: A Practical Guide",
    description: "How the MSME 45-day payment rule works, the compound interest on delayed payments, and how to file on MSME Samadhaan — with the documents your claim needs.",
    date: "2026-08-27",
    readMins: 7,
    excerpt: "Clients sitting on your invoices? Here's how the 45-day rule, compound interest, and MSME Samadhaan work — and the paperwork that decides whether you get paid.",
    hero: {"src":"/blog/quotation-format-review.webp","alt":"Reviewing business documents and invoices at a desk","w":1600,"h":1068},
    faq: [
      {
            "q": "What is the MSME 45-day payment rule?",
            "a": "Under the MSMED Act 2006, buyers are generally required to pay registered MSMEs within the agreed credit period, capped at 45 days. The cap generally applies even where the agreed terms are longer. How it applies to your specific contracts is a question for your CA or lawyer."
      },
      {
            "q": "What interest applies on delayed payments to MSMEs?",
            "a": "Under the MSMED Act 2006, delayed payments to registered MSMEs generally accrue compound interest at three times the bank rate notified by the RBI. The point of the provision is to make delay expensive for the buyer. Ask a CA to compute what a specific delay adds up to in your case."
      },
      {
            "q": "What documents do I need to file on MSME Samadhaan?",
            "a": "The portal is for Udyam-registered businesses, so your Udyam registration comes first. Beyond that, a claim needs documentation: your invoices and proof of delivery or completed work. A written work order or signed agreement makes the file much stronger."
      },
      {
            "q": "Do WhatsApp deals count as contracts for a delayed-payment claim?",
            "a": "Electronic contracts are generally recognised under Section 10A of the IT Act 2000, but proving agreed scope and price from scattered chat messages is much harder than pointing to one signed document. Get even a simple e-signed scope agreement before starting work. When in doubt, ask a lawyer what evidence your situation needs."
      }
],
    body: "<p class=\"lead\">The work shipped weeks ago. The invoice went out on time. And the client has gone quiet — again. If you run a service business in India, you know this script by heart: the polite follow-ups, the \"payment is in process\" replies, and the quiet stress of paying salaries while your own money sits in someone else's account.</p>\n\n<div class=\"answer\"><p><b>Quick answer:</b> Under the MSMED Act 2006, buyers are generally required to pay registered MSMEs within the agreed credit period, capped at 45 days. Delayed payments generally accrue compound interest at three times the RBI-notified bank rate. If you are Udyam-registered, you can file a delayed-payment claim on the MSME Samadhaan portal — but the claim stands on documentation: your Udyam registration, proper invoices, and proof that the work was delivered.</p></div>\n\n<h2>What the MSME 45-day payment rule actually says</h2>\n<p>The MSMED Act 2006 generally requires buyers to pay registered MSMEs within the period agreed between you and the client — and that agreed period is capped at 45 days. The cap generally applies even if your client's standard terms say 60 or 90 days.</p>\n<p>Two things matter here. First, the word <i>registered</i>: these protections are generally tied to being a registered MSME, so Udyam registration is the entry ticket. If you haven't registered, that's the first fix, and it costs you nothing but an afternoon.</p>\n<p>Second, delay has a price. Under the same Act, delayed payments to registered MSMEs generally accrue compound interest at three times the bank rate notified by the RBI. On a pending ₹1,35,000, that meter is not a rounding error — compound interest at that rate adds up in a way that gets a buyer's accounts team's attention.</p>\n<p>How these provisions apply to your particular contracts and clients depends on facts only you have — run your situation past a CA or lawyer before you rely on them.</p>\n\n<h2>MSME Samadhaan: where delayed-payment claims go</h2>\n<p>MSME Samadhaan is the government portal where Udyam-registered businesses can file claims for delayed payments. You don't need a lawyer to open the portal, and filing itself is not the hard part.</p>\n<p>The hard part is the file. A claim needs documentation: your Udyam registration, the invoices you're claiming against, and proof of delivery or completed work. The portal can't chase money you can't document — the strength of your paperwork is, in practice, the strength of your claim.</p>\n<p>Resolution takes time and effort, so treat Samadhaan as the serious step it is — and get a CA or lawyer to look at your file before you submit it.</p>\n\n<h2>The playbook before you file — this alone often gets you paid</h2>\n<p>Don't jump straight to the portal. Work through this sequence first, in writing:</p>\n<ol>\n<li><b>Send a written reminder, on email.</b> Cite the invoice number, invoice date, amount, and the agreed due date. WhatsApp follow-ups get forwarded and forgotten; a dated email becomes part of your record.</li>\n<li><b>Attach a statement of account.</b> Every invoice raised, every payment received, the balance outstanding. This kills the \"we'll check and revert\" loop, because there is nothing left to check.</li>\n<li><b>Mention the Act and the portal — once, calmly.</b> One line is enough: you're a Udyam-registered MSME, dues to registered MSMEs generally attract compound interest under the MSMED Act 2006, and you'd prefer to settle this directly before considering a claim on MSME Samadhaan.</li>\n</ol>\n<p>That third step often unsticks payment. A plain follow-up reads as noise; a written notice naming the Act tends to reach the client's accounts or compliance people, who understand what an interest liability means for their books.</p>\n<p>Keep copies of everything you send. If you do end up filing, this trail goes straight into your claim.</p>\n\n<h2>Why claims fall apart on paperwork</h2>\n<p>A claim has to show three simple things: the deal existed, you billed for it, and you delivered. This is exactly where service businesses commonly struggle:</p>\n<ul>\n<li><b>No written scope or work order.</b> The deal was closed on a call, the terms live across forty WhatsApp messages, and nothing was signed. Electronic contracts are generally recognised under Section 10A of the IT Act 2000 — so even a simple e-signed document counts — but you have to actually have one. A one-page signed scope, built from a <a href=\"/tools/service-agreement-template\">service agreement template</a>, beats a hundred chat screenshots.</li>\n<li><b>Unnumbered or inconsistent invoices.</b> Invoices without serial numbers or dates, or with amounts that don't match the quote, are easy to dispute. A clean, sequential trail in a <a href=\"/tools/gst-invoice-generator\">proper GST invoice format</a> makes your claim boring to verify — which is exactly what you want.</li>\n<li><b>No proof of delivery or completion.</b> For services this is the killer. No handover email, no client sign-off, no \"approved, please raise invoice\" message. Get written acceptance for every milestone, even if it's a one-line email.</li>\n</ul>\n<p>Trying to recreate these documents after the relationship has soured is close to impossible. The client who isn't paying you is not going to sign your backdated work order.</p>\n\n<h2>Keep every deal filing-ready from day one</h2>\n<p>You don't build a Samadhaan file when payment is 60 days late. You build it without thinking, on day one, by running every deal through the same four steps:</p>\n<ol>\n<li>A <a href=\"/blog/quotation-format\">quotation that states scope, price, and payment terms</a> — not a number typed into chat.</li>\n<li>Written acceptance: an e-signed agreement, or at minimum an email approval of that quotation.</li>\n<li>A numbered invoice that traces back to the same quote.</li>\n<li>A dated record of every reminder sent and every part-payment received.</li>\n</ol>\n<p>This is the thread DealInSec is built around — quotation, e-signed agreement, invoice, and payment tracking on one deal thread, with a Protection Check that flags risky or missing terms before you send. But the habit matters more than any tool: whatever you use, keep those four documents connected, so that on the day a client goes quiet, your file already exists.</p>\n\n__CTA__\n\n<p>One last note: everything above is general information, not legal advice. Whether the MSMED Act's provisions apply to a specific buyer, contract, or invoice depends on your facts — before you cite the Act in a notice or file on MSME Samadhaan, spend an hour with your CA or a lawyer. It's the cheapest step in the entire process.</p>".replace("__CTA__", ctaInline("Keep every deal filing-ready", "Quotation, agreement and numbered invoices on one thread — the paper trail a claim needs.", SIGNUP, "Start free — no card →")),
  },

  {
    slug: "client-not-paying",
    title: "Client Not Paying? The Playbook for Indian Freelancers and Service Businesses",
    metaTitle: "Client Not Paying in India? A Practical Recovery Playbook",
    description: "A client isn't paying? A staged playbook for Indian freelancers: written demand, proof of agreement, MSME Samadhaan and legal options, plus prevention.",
    date: "2026-08-27",
    readMins: 6,
    excerpt: "The staged playbook when a client refuses to pay: one written demand, proof of agreement, escalation options, and prevention for the next project.",
    hero: {"src":"/blog/deal-thread-meeting.webp","alt":"A tense discussion about a project around a laptop","w":1600,"h":1067},
    faq: [
      {
            "q": "What should I do first when a client is not paying?",
            "a": "Send one clear written demand by email: the invoice number, the exact amount, the date the work was delivered, the original due date, and a fresh deadline (7 days is common). Keep the tone firm and boring, not angry. This single email creates the written record that every later step — from a legal notice to an MSME Samadhaan claim — is built on."
      },
      {
            "q": "Can a WhatsApp message count as proof of an agreement?",
            "a": "Generally, yes, it can help. Electronic contracts are recognised in India under Section 10A of the IT Act 2000, so a clear \"yes, go ahead\" on WhatsApp against a written quotation is commonly treated as evidence that a deal existed. A signed quotation or agreement is stronger, though. For how much weight your particular trail carries, check with a lawyer."
      },
      {
            "q": "What is MSME Samadhaan and can I use it?",
            "a": "MSME Samadhaan is a government portal where Udyam-registered businesses can file delayed-payment claims against buyers. The MSMED Act 2006 generally requires buyers to pay registered MSMEs within the agreed period, capped at 45 days, and delayed payments accrue compound interest at three times the RBI notified bank rate under that Act. You'll need documentation — your Udyam registration, invoices, and proof of delivery or work done. Talk to a CA or lawyer before filing to confirm it fits your case."
      },
      {
            "q": "How do I prevent clients from not paying in future?",
            "a": "Take a 50% advance before starting — it filters out non-payers before they cost you anything. Put the scope and revision limits in writing on a proper quotation, get an explicit written \"yes\", and send numbered invoices with clear due dates. Clients pay faster when everything about the deal looks organised and deliberate."
      }
],
    body: "<p class=\"lead\">The work is delivered. The invoice went out weeks ago. And the client who used to reply in minutes has gone quiet. Whether it's ₹15,000 or ₹1,35,000, an unpaid invoice is the most stressful moment in service work — because it's not just money, it's your month.</p>\n\n<div class=\"answer\"><p><b>Quick answer:</b> Send one clear written demand — email the invoice number, exact amount, original due date, and a fresh payment deadline. Line up your proof of the agreement: a signed quotation is strongest, but even a WhatsApp \"yes, go ahead\" helps. If payment still doesn't come, escalate — MSME Samadhaan if you're Udyam-registered, a legal notice through a lawyer, or the ordinary courts for smaller disputes. Then fix prevention: 50% advance, scope in writing, numbered invoices.</p></div>\n\n<h2>Step 1: Send one clear written demand — not ten angry follow-ups</h2>\n<p>When a client goes silent, the instinct is to keep pinging them on WhatsApp. Resist it. Ten scattered \"any update?\" messages are easy to ignore and create a messy record. One firm, complete email is hard to ignore and creates a clean one.</p>\n<p>Your demand email should contain:</p>\n<ul>\n<li>The invoice number and the exact amount (for example: \"Invoice [INV-001] for ₹[amount]\")</li>\n<li>The date the work was delivered</li>\n<li>The original due date, and how many days it is now overdue</li>\n<li>A new, specific deadline — 7 days is common</li>\n<li>Your payment details, so there is zero friction if they decide to pay</li>\n</ul>\n<p>Keep the tone professional and almost boring. You're not venting; you're building a record. Every escalation option later depends on being able to show that you asked clearly, in writing, and gave them a fair chance to pay. If finding that calm tone is hard when you're this angry, DealInSec drafts payment reminders in English or Hinglish — you review the wording and send it yourself.</p>\n\n<h2>Step 2: Line up your proof of the original agreement</h2>\n<p>Before you escalate anywhere, gather what shows a deal actually existed. Put it all in one folder now, while it's easy to find:</p>\n<ul>\n<li><b>Strongest:</b> a signed quotation or service agreement stating the scope and price</li>\n<li><b>Good:</b> an email where the client approved your quotation</li>\n<li><b>Still useful:</b> a WhatsApp \"yes, go ahead\" or \"approved\" replying to your quotation or price message</li>\n<li><b>Delivery proof:</b> the emails or messages where you sent files, links, or the finished work</li>\n<li>The invoice itself, and any part-payments already received</li>\n</ul>\n<p>Electronic contracts are generally recognised in India under Section 10A of the IT Act 2000, which is why even chat approvals commonly carry weight as evidence that both sides agreed. A signed document is still much stronger than a chat thread. For how solid your specific trail is, ask a lawyer — don't guess.</p>\n\n<h2>Step 3: If they still don't pay — your escalation options</h2>\n<p>The deadline in your demand email passes. Now you escalate, and the right route depends on your situation.</p>\n<ol>\n<li><b>MSME Samadhaan (if you're Udyam-registered).</b> The MSMED Act 2006 generally requires buyers to pay registered MSMEs within the agreed period, capped at 45 days. Delayed payments to registered MSMEs accrue compound interest at three times the RBI notified bank rate under that Act — which changes the maths for a buyer sitting on your invoice. The MSME Samadhaan portal lets Udyam-registered businesses file delayed-payment claims, and you'll need documentation: your Udyam registration, invoices, and proof of delivery or work done. If you're not registered yet, registering is generally worth doing for every future project.</li>\n<li><b>A legal notice through a lawyer.</b> A formal notice on a lawyer's letterhead often moves a client who has been ignoring you for months. It signals that not paying now has a cost.</li>\n<li><b>The courts, for smaller disputes.</b> For smaller amounts, the ordinary courts are generally the route. Procedures, costs, and timelines vary a lot by case and by state.</li>\n</ol>\n<p>None of this is legal advice. Before you file anything anywhere, talk to a CA or lawyer about your specific facts — the right move depends on the amount, your registration status, and what proof you hold.</p>\n\n<h2>Do the maths before you fight</h2>\n<p>This part is uncomfortable but important. Your goal is money, not victory. Before escalating, weigh the unpaid amount against the time, fees, and energy a fight will take — and against the client work you could do instead.</p>\n<p>Sometimes accepting a partial settlement now is the better business decision than chasing the full amount for a year. Sometimes the amount is large enough, and your paper trail strong enough, that escalating is clearly right. Decide your walk-away number deliberately instead of letting exhaustion decide it for you. And whatever you choose: stop doing new work for a client who hasn't paid for the old work. More effort will not fix a payment problem.</p>\n\n<h2>Prevention: make the next invoice boringly easy to pay</h2>\n<p>Almost every payment fight starts long before the invoice — in a vague scope, a verbal \"yes\", or work that began with zero money down. The fixes are simple:</p>\n<ul>\n<li><b>Take a 50% advance before starting.</b> A client who won't pay half upfront was probably never going to pay in full. This one habit filters them out before they cost you anything.</li>\n<li><b>Put the scope in writing.</b> Send a proper written quotation — a <a href=\"/tools/quotation-maker\">free quotation maker</a> takes minutes, and a clear <a href=\"/blog/quotation-format\">quotation format</a> leaves no room for \"but I thought that was included\".</li>\n<li><b>Cap revisions.</b> State it plainly: \"2 rounds of revisions included.\" Unlimited revisions are how projects — and payments — drag forever.</li>\n<li><b>Use a signed agreement for bigger projects.</b> For larger amounts, get a signature on a <a href=\"/tools/service-agreement-template\">service agreement</a>, not just a chat approval.</li>\n<li><b>Number your invoices and put a due date on every one.</b> \"Please pay soon\" is not a due date. \"Due by 15 September\" is.</li>\n</ul>\n<p>If you want a second pair of eyes, DealInSec's Protection Check flags risky or missing terms — like no advance or no revision limit — before you send a deal.</p>\n<p>You can't control every client. But you can make sure the next non-payer meets a paper trail instead of a shrug.</p>\n\n__CTA__".replace("__CTA__", ctaInline("Never chase without a paper trail again", "DealInSec puts scope, agreement and invoices in writing from day one — and drafts the follow-ups.", SIGNUP, "Start free — no card →")),
  },

  {
    slug: "payment-reminder-message-to-client",
    title: "Payment Reminder Messages to Clients: 10 Templates That Work in India",
    metaTitle: "Payment Reminder Message to Client: 10 India Templates",
    description: "Copy-paste payment reminder messages for Indian service businesses — gentle day-1 nudges to firm final notices, with Hinglish and WhatsApp variants.",
    date: "2026-08-27",
    readMins: 7,
    excerpt: "10 copy-paste payment reminder templates in escalating tone — gentle, firm, final notice — plus Hinglish and WhatsApp versions, and the rules of good chasing.",
    hero: {"src":"/blog/fake-quotation-check.webp","alt":"Writing a payment reminder by hand over documents","w":1600,"h":1068},
    faq: [
      {
            "q": "How do I politely remind a client about payment?",
            "a": "Name the invoice number, the amount, and the due date, then ask for a specific payment date. Keep it warm but direct — one clear line like \"Could you confirm when invoice [INV-001] for ₹[amount] will be processed?\" works better than a paragraph of hedging. And don't apologise for asking; it's your money, not a favour."
      },
      {
            "q": "How many payment reminders should I send before escalating?",
            "a": "A common rhythm is four: a gentle note on day 1 overdue, a follow-up around day 3–4, a firm message at day 7 asking for a specific date, and a final notice around day 14–21 that names your next steps. After that, more reminders lose power — switch to a call, pause ongoing work, or take formal steps. Keep every message in writing so you have a record."
      },
      {
            "q": "Is WhatsApp or email better for payment reminders?",
            "a": "Use whichever channel your client actually responds on — for many Indian businesses that means WhatsApp for the quick nudge and email for the formal record. The key rule is one channel at a time: send, wait a working day or two, then follow up. For a final notice, email is generally the safer choice because it timestamps your paper trail."
      },
      {
            "q": "What can I do if a client ignores every payment reminder?",
            "a": "If you are a Udyam-registered MSME, the MSMED Act 2006 generally requires buyers to pay within the agreed period, capped at 45 days, and delayed payments can accrue compound interest at three times the RBI-notified bank rate. Udyam-registered businesses can commonly file a delayed-payment claim on the MSME Samadhaan portal with documentation such as the Udyam registration, invoices, and proof of delivery or work. Before escalating formally, talk to a CA or lawyer about your specific case."
      }
],
    body: "<p class=\"lead\">You did the work, you raised the invoice, and now you're typing and deleting the same message for the fourth time — how do you ask for your own money without sounding rude or desperate? A ₹1,35,000 invoice doesn't stop being yours just because the client went quiet. Here are 10 copy-paste payment reminder messages, from gentle nudge to final notice, so chasing takes 30 seconds instead of 20 minutes of agonising.</p>\n\n<div class=\"answer\"><p><b>Quick answer:</b> A payment reminder message to a client should name the invoice number, the amount, and the due date, then ask for a specific payment date — politely, but without apologising. Start gentle on day 1 overdue, follow up around day 3, get firm at day 7, and send a final notice that states your next steps. Copy-paste templates for each stage, including Hinglish and WhatsApp versions, are below.</p></div>\n\n<h2>The rules of good chasing</h2>\n<p>Templates only work if the chasing behind them is disciplined. Six rules cover most of it:</p>\n<ul>\n<li><b>Always cite invoice number, amount, and due date.</b> \"Please clear the pending payment\" gives the client room to act confused. \"[INV-001], ₹[amount], due [due date]\" gives them nothing to hide behind.</li>\n<li><b>One channel at a time.</b> Send the reminder, wait a working day or two, then follow up. Emailing, WhatsApping, and calling within the same hour looks panicked and splits the conversation across threads.</li>\n<li><b>Never apologise for asking.</b> \"Sorry to bother you\" turns money you're owed into a favour you're requesting. Drop it from every message.</li>\n<li><b>Ask for a date, not a vibe.</b> \"Please pay as soon as possible\" gets you \"sure, soon\". \"Can you confirm payment by [date]?\" gets you a commitment you can follow up on.</li>\n<li><b>Keep the relationship door open.</b> Be firm about the money and warm towards the person. Most late payers are disorganised, not dishonest — and many will hire you again.</li>\n<li><b>Keep it in writing.</b> Calls are fine for pressure, but confirm whatever was agreed in a message afterwards. If things ever escalate, your paper trail is your case.</li>\n</ul>\n<p>One upstream fix before any template: a lot of delays start with a sloppy or incomplete invoice. If yours go out with missing GST details or unclear line items, fix that first — a free <a href=\"/tools/gst-invoice-generator\">GST invoice generator</a> gets the format and tax maths right, no signup needed.</p>\n\n<h2>Gentle reminders: due date to day 4</h2>\n<p>At this stage, assume good faith. The invoice slipped through, the accounts person was on leave, the approval is stuck. Your only job is to surface it politely and get a date.</p>\n\n<p><b>Template 1 — The courtesy heads-up</b><br><em>When to use: 1–2 days before the due date, especially with new clients or larger invoices.</em></p>\n<p>\"Hi [Name], a quick heads-up that invoice [INV-001] for ₹[amount] is due on [due date]. Payment details are on the invoice — let me know if you need anything from my side. Thanks, [Your Name]\"</p>\n\n<p><b>Template 2 — Day 1 overdue: the gentle nudge</b><br><em>When to use: the first working day after the due date, when this is the first miss.</em></p>\n<p>\"Hi [Name], hope you're doing well. Invoice [INV-001] for ₹[amount] was due on [due date] and hasn't come through yet. Could you check and confirm when it will be processed? Happy to resend the invoice if that helps. Thanks, [Your Name]\"</p>\n\n<p><b>Template 3 — Day 3–4: the follow-up</b><br><em>When to use: when the first reminder got silence or a vague \"will check\".</em></p>\n<p>\"Hi [Name], following up on invoice [INV-001] for ₹[amount], due on [due date] — it's now [X] days overdue. Could you share a payment date by end of day? If there's any issue with the invoice itself, tell me and I'll sort it out right away. Regards, [Your Name]\"</p>\n\n<h2>Firm reminders: a week overdue and beyond</h2>\n<p>From day 7, the tone changes. Still professional, still no anger — but you stop asking whether they'll pay and start asking exactly when. Note that \"as per our agreed terms\" only carries weight if you actually have written terms; more on fixing that at the end.</p>\n\n<p><b>Template 4 — Day 7: firm and specific</b><br><em>When to use: a week overdue with no committed date. This is the workhorse of payment follow-up messages.</em></p>\n<p>\"Hi [Name], invoice [INV-001] for ₹[amount] is now [X] days past its due date of [due date]. As per our agreed terms, I need this cleared by [date]. Please confirm the transfer today, or share a specific date I can count on. Regards, [Your Name]\"</p>\n\n<p><b>Template 5 — The pause-work notice</b><br><em>When to use: ongoing projects where you have leverage — and only if you're genuinely prepared to pause.</em></p>\n<p>\"Hi [Name], I want to keep [project] moving, but invoice [INV-001] for ₹[amount] has been pending since [due date]. I'll have to pause work from [date] until it's cleared. Please let me know today how you'd like to proceed. Regards, [Your Name]\"</p>\n\n<p><b>Template 6 — The part-payment offer</b><br><em>When to use: when the client admits a cash crunch and you'd rather recover in parts than fight for the whole.</em></p>\n<p>\"Hi [Name], I understand cash flow can get tight. On invoice [INV-001] for ₹[amount], due [due date], could we agree on ₹[part amount] by [date] and the balance by [date]? Please confirm in writing and I'll note it against the invoice. Regards, [Your Name]\"</p>\n\n<h2>Final notice, Hinglish, and WhatsApp versions</h2>\n<p><b>Template 7 — The final notice</b><br><em>When to use: after three or more ignored reminders — and only if you're ready to follow through on what it says.</em></p>\n<p>\"Dear [Name], despite reminders on [date] and [date], invoice [INV-001] for ₹[amount], due on [due date], remains unpaid. Please treat this as a final notice. If payment is not received by [date], I will have to stop all work, apply the late-payment terms in our agreement, and look at formal recovery options. I'd much rather settle this simply — please call me today. Regards, [Your Name]\"</p>\n\n<p><b>Template 8 — Hinglish, gentle</b><br><em>When to use: relationship clients where formal English reads as cold or distant.</em></p>\n<p>\"Hi [Name] ji, ek chhota sa reminder — invoice [INV-001], amount ₹[amount], due date [due date] thi. Payment abhi tak receive nahi hua. Please check karke bata dijiye kab tak ho jayega. Thank you!\"</p>\n\n<p><b>Template 9 — Hinglish, firm</b><br><em>When to use: when your politeness in Hinglish is being read as flexibility.</em></p>\n<p>\"[Name] ji, invoice [INV-001] ka payment — ₹[amount] — ab [X] din se pending hai. Kaam time par deliver ho gaya tha, ab payment ka pakka date chahiye. Please aaj hi confirm kar dijiye, uske baad hi agla kaam start ho payega.\"</p>\n\n<p><b>Template 10 — WhatsApp-style short</b><br><em>When to use: a quick outstanding-payment reminder on WhatsApp, where long messages get skimmed. If it's ignored, follow with a call.</em></p>\n<p>\"Hi [Name], quick reminder: invoice [INV-001] for ₹[amount] was due on [due date]. Can you confirm the payment date? Thanks!\"</p>\n\n<p>If you'd rather not draft these yourself at 11 pm: DealInSec can draft payment reminders in English or Hinglish, tied to the invoice on your deal thread — you review the message and send it yourself. And if you're a one-person business doing all the chasing solo, see <a href=\"/freelancer-invoice-software\">invoice software for freelancers</a>.</p>\n\n__CTA__\n\n<h2>When reminders stop working</h2>\n<p>If even the final notice sinks without a reply, your wording is no longer the problem. A few options generally available to Indian service businesses:</p>\n<ul>\n<li><b>Stop the bleeding.</b> Pause ongoing work and hold future deliverables. Don't extend fresh credit to someone who hasn't paid for the last lot.</li>\n<li><b>Use MSME protections if you're registered.</b> The MSMED Act 2006 generally requires buyers to pay registered MSMEs within the agreed period, capped at 45 days, and delayed payments can accrue compound interest at three times the RBI-notified bank rate. Udyam-registered businesses can commonly file a delayed-payment claim on the MSME Samadhaan portal — you'll need documentation such as your Udyam registration, the invoices, and proof of delivery or work. This is exactly where the paper trail from rule six earns its keep.</li>\n<li><b>Send a formal demand.</b> A demand letter from a lawyer often moves clients who ignored ten polite messages.</li>\n</ul>\n<p>Every situation is different — before you escalate formally, talk to a CA or lawyer about your specific case.</p>\n<p>And for the next client: most payment fights are lost at the start, not the end. Agree payment terms in writing before the work begins — a <a href=\"/tools/service-agreement-template\">service agreement template</a> with clear due dates and late-payment terms makes every reminder above easier to send, because you're no longer asking for a favour. You're quoting a document you both signed.</p>".replace("__CTA__", ctaInline("Let the Copilot draft the reminder", "English or Hinglish, with the real invoice number — you review and press send.", SIGNUP, "Try it free →")),
  },

  {
    slug: "advance-payment-terms",
    title: "Advance Payment Terms: How to Ask for Advance Without Losing the Deal",
    metaTitle: "Advance Payment Terms: How to Ask for 50% Advance",
    description: "How to set advance payment terms for Indian service businesses: the 50/50 split, exact quotation wording, and scripts for clients who resist paying advance.",
    date: "2026-08-27",
    readMins: 6,
    excerpt: "The 50/50 split, exact wording for your quotation, and what to say when a client says \"we've never paid advance\" — without losing the deal.",
    hero: {"src":"/blog/deal-management-handshake.webp","alt":"Two people agreeing on deal terms with a handshake","w":1600,"h":1068},
    faq: [
      {
            "q": "Is 50% advance payment normal in India?",
            "a": "Yes. For service work — design, development, events, consulting, fit-outs — 50% advance and 50% on delivery is the most common structure. Larger or longer projects often split further, like 40/40/20 tied to milestones. If a client acts like advance is unusual, they are negotiating, not stating a market fact."
      },
      {
            "q": "How do I ask for advance payment without sounding desperate?",
            "a": "Don't ask in conversation — state it in writing on the quotation as a standard term, like GST or delivery time. A line such as 'Work begins on receipt of 50% advance' frames it as how you operate, not a favour you are requesting. Terms printed on paper get argued with far less than terms spoken on a call."
      },
      {
            "q": "What should I do if a client refuses to pay any advance?",
            "a": "Negotiate the structure, not the existence of advance. Offer a smaller advance (25–30%) or a milestone split like 40/40/20 instead of dropping to zero. A client who will not commit any money before you commit your time is telling you how the final payment will go — treat that as a risk signal, not a challenge to overcome."
      },
      {
            "q": "Can I start work on a verbal yes from the client?",
            "a": "It's risky. Get written acceptance first — even a short WhatsApp confirmation of the amount and terms is better than nothing, and an e-signed agreement is better still. Electronic contracts are generally recognised in India under Section 10A of the IT Act 2000, but for anything high-value or already in dispute, talk to a lawyer about your specific situation."
      }
],
    body: "<p class=\"lead\">The client said \"looks good, start karo\" on a call. You started. Three weeks later the work is delivered, the invoice is sent — and now you're the one following up, again, for money you already earned. Almost every payment chase starts the same way: no advance, no written terms, work done on trust.</p>\n\n<div class=\"answer\"><p><b>Quick answer:</b> Ask for 50% advance before you start, in writing, on the quotation itself. One line does the job: \"Work begins on receipt of 50% advance; balance payable within 7 days of delivery.\" Serious clients pay it without drama. Clients who refuse any advance were always going to be a collection problem — better to find out before you've done the work.</p></div>\n\n<h2>Why advance matters more than your rate</h2>\n\n<p>An advance does two things at once, and neither is really about the money.</p>\n\n<p><b>It transfers risk.</b> Without an advance, you carry 100% of the project risk: your time, your team's salaries, your materials — all spent before the client has committed a rupee. A 50% advance splits that risk roughly down the middle. On a ₹1,20,000 project, ₹60,000 upfront means that even in the worst case, you're not working the first half for free.</p>\n\n<p><b>It filters seriousness.</b> A client who pays ₹60,000 before work starts has decided. A client who says \"start now, payment ho jayega\" has decided nothing — you're just the cheapest way for them to keep their options open. The advance is the difference between a confirmed order and a conversation.</p>\n\n<p>There's a third, quieter benefit: a client who has paid an advance responds to your messages. The dynamic of the whole project changes when their money is already in.</p>\n\n<h2>The standard 50/50 — and the common variants</h2>\n\n<p>For most service work in India, <b>50% advance, 50% on delivery</b> is the default, and you should treat it as yours too. It's simple, clients recognise it, and it needs no explanation.</p>\n\n<p>Two variants are worth knowing:</p>\n\n<ul>\n<li><b>40/40/20 for longer projects.</b> 40% advance, 40% at a named milestone (design approval, first draft, structure complete), 20% on final delivery. This works well when the project runs 2–3 months and a 50% advance feels heavy for the client — you still never work more than one stage ahead of the money.</li>\n<li><b>Monthly advance for retainers.</b> Ongoing work — social media, maintenance, bookkeeping — should be billed in advance for the month, not after it. Otherwise every month you're financing your client's business with your own working capital.</li>\n</ul>\n\n<p>What all three structures share: <b>you are never owed more than one instalment at any point.</b> That's the real rule. Pick whichever split gets you there for your kind of work.</p>\n\n<h2>Exact lines to put on your quotation</h2>\n\n<p>Advance terms belong on the quotation — not in a follow-up message after the client says yes. (If your quotation doesn't have a terms section yet, see <a href=\"/blog/quotation-format\">what a proper quotation format includes</a>.) Copy and adapt these:</p>\n\n<ol>\n<li><b>The basic 50/50:</b> \"Work begins on receipt of <b>[50]% advance (₹[60,000])</b> against this quotation. The balance <b>[50]%</b> is payable within <b>[7] days</b> of delivery, against the final invoice.\"</li>\n<li><b>Milestone split:</b> \"Payment schedule: <b>[40]%</b> advance to confirm the order, <b>[40]%</b> on <b>[design approval]</b>, <b>[20]%</b> on final delivery. Each stage begins on receipt of the corresponding payment.\"</li>\n<li><b>Retainer:</b> \"Monthly fees of <b>₹[35,000]</b> are payable in advance, by the <b>[5th]</b> of each month. Work for the month is paused if payment is not received by the <b>[10th]</b>.\"</li>\n<li><b>Validity + confirmation:</b> \"This quotation is valid for <b>[15] days</b>. The order is confirmed only on receipt of the advance; dates and delivery timelines are counted from the advance date, not the date of verbal confirmation.\"</li>\n</ol>\n\n<p>That last line quietly fixes the most common fight — clients who say yes verbally in March, pay in May, and still expect the March deadline.</p>\n\n<p>You can put these terms on a clean, professional quotation in a few minutes with the free <a href=\"/tools/quotation-maker\">quotation maker</a> — no signup needed.</p>\n\n__CTA__\n\n<h2>When the client says \"we've never paid advance\"</h2>\n\n<p>You'll hear this. Sometimes it's true, usually it's an opening move. Either way, don't respond by dropping the advance — respond by restructuring it.</p>\n\n<ul>\n<li><b>Reframe what the advance is:</b> \"The advance is what confirms your slot in our schedule. Without it, I can't block the team's time for you.\" This makes it about commitment, not distrust.</li>\n<li><b>Reduce, don't remove:</b> \"I understand — for a first project together, we can do 30% to start instead of 50, with the balance on delivery.\" A smaller advance still transfers risk and still filters seriousness. Zero does neither.</li>\n<li><b>Offer milestones instead:</b> \"If 50% upfront is difficult, we can do 40/40/20 — you're never paying for work you haven't seen.\" Larger companies with approval processes often accept this readily.</li>\n<li><b>Never trade advance for a discount in the same breath.</b> \"No advance and 10% off\" is two losses stacked. Negotiate one thing at a time.</li>\n</ul>\n\n<p>And if the client won't commit <em>any</em> money before you commit your time? That's not a negotiation problem, it's information. The way a client behaves before the deal is the best preview of how they'll behave at invoice time.</p>\n\n<h2>The verbal-yes trap</h2>\n\n<p>The most expensive words in Indian service business are \"haan haan, start kar do.\" Work started on a verbal yes has no agreed scope, no agreed price on record, and no agreed payment terms — so when the dispute comes, it's your memory against theirs.</p>\n\n<p>Before any work starts, get three things in writing: the amount, the payment split, and what exactly is included. A WhatsApp message confirming these is far better than nothing. A signed quotation or a simple <a href=\"/tools/service-agreement-template\">service agreement</a> is better still — electronic contracts are generally recognised in India under Section 10A of the IT Act 2000, so an e-signed document isn't a lesser document. For high-value projects or anything already heading towards a dispute, have a lawyer look at your specific case.</p>\n\n<p>This is also where a second pair of eyes helps: DealInSec's Protection Check reads your deal before you send it and flags missing or risky terms — no advance clause, no payment deadline, no scope line — the exact gaps that turn into payment chases later.</p>\n\n<p>The advance is not an awkward ask. It's the line between running a business and giving interest-free loans to strangers. Put it on the quotation, hold it politely, and let it do the filtering for you.</p>".replace("__CTA__", ctaInline("Put the advance in writing today", "The free quotation maker bakes advance terms into a professional quote — no sign-up.", "/tools/quotation-maker", "Make a quotation →")),
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
