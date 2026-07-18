/**
 * Shared HTML shell for the public, server-rendered free-tool / SEO pages.
 *
 * These pages live OUTSIDE the React SPA: Express returns a complete HTML
 * document (real content in the source) so Google can index them, and the
 * interactive bits run as inline vanilla JS. See server/tools/index.ts for the
 * route wiring (registered before the SPA catch-all).
 */

export interface ToolPageOptions {
  /** <title> text (also OG/Twitter title). */
  title: string;
  /** Meta description. */
  description: string;
  /** Canonical path, e.g. "/tools/gst-invoice-generator". */
  canonicalPath: string;
  /** Structured-data blocks (rendered as application/ld+json). */
  jsonLd?: object[];
  /** Main content HTML (between header and the signup CTA band). */
  bodyHtml: string;
  /** Extra tags injected into <head>. */
  headExtra?: string;
  /** Scripts injected right before </body>. */
  bodyEndScripts?: string;
  /** Hide the default signup CTA band (a page may render its own). */
  hideCtaBand?: boolean;
}

export const SITE_ORIGIN = "https://www.dealinsec.com";
const APP_LINK = "/?utm_source=tools&utm_medium=seo_page";

/** HTML-escape untrusted/dynamic text before it goes into markup. */
export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const STYLES = `<style>
  *,*::before,*::after{box-sizing:border-box}
  :root{--green:#0E8C5A;--green-d:#0a6e46;--ink:#0F172A;--muted:#64748B;--line:#E2E8F0;--bg:#F8FAFC;--card:#fff}
  html{-webkit-text-size-adjust:100%}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg);line-height:1.6}
  a{color:var(--green);text-decoration:none}
  a:hover{text-decoration:underline}
  h1,h2,h3{line-height:1.2;margin:0 0 .5em}
  .wrap{max-width:1080px;margin:0 auto;padding:0 20px}
  .btn{display:inline-flex;align-items:center;gap:8px;background:var(--green);color:#fff;font-weight:700;padding:12px 22px;border-radius:12px;border:0;cursor:pointer;font-size:15px}
  .btn:hover{background:var(--green-d);text-decoration:none;color:#fff}
  .btn.ghost{background:transparent;color:var(--green);border:1.5px solid var(--line)}
  .btn.ghost:hover{background:#fff;border-color:var(--green)}
  header.site{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.9);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
  header.site .wrap{display:flex;align-items:center;justify-content:space-between;height:64px}
  .brand{display:flex;align-items:center;gap:9px;font-weight:800;font-size:19px;color:var(--ink);letter-spacing:-.01em}
  .brand:hover{text-decoration:none}
  .logo{flex-shrink:0;filter:drop-shadow(0 1px 2px rgba(0,0,0,.08))}
  .brand-text{line-height:1}
  .brand-accent{background:linear-gradient(135deg,#059669 0%,#0D9488 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:#0D9488}
  .hero{padding:56px 0 20px;text-align:center}
  .hero h1{font-size:clamp(28px,5vw,44px);font-weight:800;letter-spacing:-.02em}
  .hero p.sub{font-size:clamp(16px,2.2vw,20px);color:var(--muted);max-width:660px;margin:0 auto}
  .chips{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin:20px 0 0}
  .chip{font-size:13px;font-weight:600;color:var(--green-d);background:#E7F6EF;border:1px solid #BFE6D4;border-radius:999px;padding:6px 12px}
  section{padding:28px 0}
  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:22px;align-items:start}
  @media(max-width:860px){.grid2{grid-template-columns:1fr}}
  label{display:block;font-size:13px;font-weight:600;color:var(--muted);margin:12px 0 5px}
  input.f,textarea.f,select.f{width:100%;font:inherit;font-size:15px;color:var(--ink);background:#fff;border:1.5px solid var(--line);border-radius:10px;padding:10px 12px}
  input.f:focus,textarea.f:focus,select.f:focus{outline:none;border-color:var(--green)}
  .row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .steps{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
  @media(max-width:760px){.steps{grid-template-columns:1fr}}
  .step .n{width:34px;height:34px;border-radius:50%;background:#E7F6EF;color:var(--green-d);font-weight:800;display:grid;place-items:center;margin-bottom:8px}
  .faq h3{font-size:17px;margin-top:18px}
  .faq p{color:var(--muted);margin:.3em 0 0}
  .cta-band{background:linear-gradient(135deg,var(--green),#0a6e46);color:#fff;margin-top:24px}
  .cta-band .wrap{padding:44px 20px;text-align:center}
  .cta-band h2{color:#fff;font-size:clamp(22px,3.5vw,32px);font-weight:800}
  .cta-band p{color:#DCFCE7;max-width:620px;margin:0 auto 22px}
  .cta-band .btn{background:#fff;color:var(--green-d)}
  .cta-band .btn:hover{background:#F0FDF4}
  footer.site{background:#fff;border-top:1px solid var(--line);padding:34px 0;color:var(--muted);font-size:14px}
  footer.site .links{display:flex;gap:18px;flex-wrap:wrap;margin-bottom:10px}
  .muted{color:var(--muted)}
</style>`;

// Same mark as the React app's <DealinsecLogo> (client/src/components/
// dealinsec-logo.tsx) — inlined as SVG so the server-rendered pages match the
// landing page exactly: emerald gradient tile, geometric "D", gold accent seal.
const LOGO_SVG = `<svg width="32" height="32" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" class="logo" aria-hidden="true">
  <defs>
    <linearGradient id="dls-bg" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse"><stop stop-color="#10B981"/><stop offset="0.55" stop-color="#059669"/><stop offset="1" stop-color="#0D9488"/></linearGradient>
    <linearGradient id="dls-sheen" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse"><stop stop-color="white" stop-opacity="0.28"/><stop offset="0.5" stop-color="white" stop-opacity="0"/></linearGradient>
    <linearGradient id="dls-accent" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#FBBF24"/><stop offset="1" stop-color="#F59E0B"/></linearGradient>
  </defs>
  <rect width="48" height="48" rx="13" fill="url(#dls-bg)"/>
  <rect width="48" height="48" rx="13" fill="url(#dls-sheen)"/>
  <path d="M13.5 12 H22.5 C29.9558 12 34 16.9249 34 24 C34 31.0751 29.9558 36 22.5 36 H13.5 V12 Z M18.5 17 V31 H22.3 C26.6 31 29 28.4 29 24 C29 19.6 26.6 17 22.3 17 H18.5 Z" fill="white" fill-rule="evenodd"/>
  <circle cx="35.5" cy="33.5" r="3.2" fill="url(#dls-accent)" stroke="url(#dls-bg)" stroke-width="1.8"/>
</svg>`;

function header(): string {
  return `<header class="site"><div class="wrap">
    <a class="brand" href="/" aria-label="DealInSec home">${LOGO_SVG}<span class="brand-text">Deal<span class="brand-accent">insec</span></span></a>
    <a class="btn" href="${APP_LINK}">Open App</a>
  </div></header>`;
}

function ctaBand(): string {
  return `<div class="cta-band"><div class="wrap">
    <h2>Get every deal in writing — and get paid on time</h2>
    <p>DealInSec takes you from quotation to signed agreement to GST invoice in one place. Save your clients, send invoices, track payments, and e-sign contracts. Free to start.</p>
    <a class="btn" href="${APP_LINK}">Start free →</a>
  </div></div>`;
}

function footer(): string {
  const y = 2026;
  return `<footer class="site"><div class="wrap">
    <div class="links">
      <a href="/tools">Free Tools</a>
      <a href="/tools/gst-invoice-generator">GST Invoice Generator</a>
      <a href="/">Product</a>
      <a href="/terms">Terms</a>
      <a href="/privacy">Privacy</a>
      <a href="/refund">Refund</a>
    </div>
    <div class="muted">© ${y} DealInSec — the deal-management OS for India's service businesses. This free tool creates invoices in your browser; nothing is stored on our servers.</div>
  </div></footer>`;
}

export function renderToolPage(o: ToolPageOptions): string {
  const canonical = SITE_ORIGIN + o.canonicalPath;
  const ld = (o.jsonLd || [])
    // Escape "<" so a "</script>" inside any string value can't break out of
    // the JSON-LD script block (defense in depth; content is currently static).
    .map((b) => `<script type="application/ld+json">${JSON.stringify(b).replace(/</g, "\\u003c")}</script>`)
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}" />
<link rel="canonical" href="${canonical}" />
<meta name="robots" content="index,follow" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${esc(o.title)}" />
<meta property="og:description" content="${esc(o.description)}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:site_name" content="DealInSec" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(o.title)}" />
<meta name="twitter:description" content="${esc(o.description)}" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="icon" href="/favicon.ico" sizes="any" />
${STYLES}
${o.headExtra || ""}
${ld}
</head>
<body>
${header()}
<main>${o.bodyHtml}</main>
${o.hideCtaBand ? "" : ctaBand()}
${footer()}
${o.bodyEndScripts || ""}
</body>
</html>`;
}
