/**
 * Free Quotation Templates — the "download a template" intent page.
 *
 * Keyword rationale (competitor top-pages data, Aug 2026): template/format
 * pages rank with almost no backlinks — Refrens' free-quotation-templates
 * page draws ~8.5K visits/mo on 23 links. Ours serves the download intent
 * with REAL files (.docx/.xlsx generated in-house, brand-neutral, verified
 * renders) and funnels the edit intent into the online maker.
 *
 * The files live in client/public/templates/ (copied verbatim into
 * dist/public). /templates/ is in the PWA navigateFallbackDenylist so a
 * direct open can never be shadowed by the SPA shell.
 */
import { renderToolPage, esc, SITE_ORIGIN } from "./layout";

const PATH = "/tools/quotation-templates";
const TITLE = "Free Quotation Templates — Word & Excel Download | DealInSec";
const DESC =
  "Download free quotation templates for India: simple service quotation, GST quotation and freelancer quotation in Word, plus an Excel format with auto-totals. No sign-up — or edit online and export a PDF.";

interface Tpl {
  key: string;
  name: string;
  file: string;
  kind: "Word (.docx)" | "Excel (.xlsx)";
  bestFor: string;
  includes: string[];
  /** Seed for the online maker (subset of the quotation-maker draft shape). */
  seed?: Record<string, unknown>;
}

const TEMPLATES: Tpl[] = [
  {
    key: "simple",
    name: "Simple Service Quotation",
    file: "/templates/quotation-format-simple.docx",
    kind: "Word (.docx)",
    bestFor: "Any service business — the clean, universal format",
    includes: ["Itemised work table", "Validity & advance terms", "Amount in words", "Signature block"],
    seed: {
      quoteNo: "QT-2026-001", gstRate: "0", taxType: "cgst_sgst",
      items: [
        { desc: "Concept design & 3D views", qty: 1, rate: 60000 },
        { desc: "Site supervision — 3 months", qty: 3, rate: 15000 },
      ],
    },
  },
  {
    key: "gst",
    name: "GST Quotation",
    file: "/templates/quotation-format-gst.docx",
    kind: "Word (.docx)",
    bestFor: "GST-registered businesses quoting with tax shown",
    includes: ["GSTIN fields for both parties", "HSN/SAC column", "CGST/SGST rows (IGST note)", "Tax-estimate disclaimer"],
    seed: {
      quoteNo: "QT-2026-001", gstRate: "18", taxType: "cgst_sgst",
      items: [{ desc: "Service description", qty: 1, rate: 50000 }],
    },
  },
  {
    key: "freelancer",
    name: "Freelancer Quotation",
    file: "/templates/quotation-format-freelancer.docx",
    kind: "Word (.docx)",
    bestFor: "Designers, developers, writers — compact one-pager",
    includes: ["Hourly or per-project rows", "50% advance terms", "Revision-limit clause", "Files-on-payment clause"],
    seed: {
      quoteNo: "QT-2026-001", gstRate: "0", taxType: "cgst_sgst",
      items: [
        { desc: "Logo & brand identity", qty: 1, rate: 25000 },
        { desc: "5-page website design", qty: 1, rate: 40000 },
      ],
    },
  },
  {
    key: "excel",
    name: "Excel Quotation (auto-totals)",
    file: "/templates/quotation-format-excel.xlsx",
    kind: "Excel (.xlsx)",
    bestFor: "Spreadsheet workflows — formulas do the math",
    includes: ["Amount = Qty × Rate formulas", "Subtotal & GST computed", "₹ number formatting", "Terms included"],
  },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "Are these quotation templates really free?",
    a: "Yes — download and use them for unlimited commercial quotations, no sign-up and no attribution required. They are brand-neutral: your business name goes on top, nobody else's.",
  },
  {
    q: "Should I use the Word, Excel or online format?",
    a: "Word gives you full control over wording and layout. Excel computes the totals and GST for you. The free online quotation maker does both — live math, GST split, amount in words — and exports a clean PDF, which is the format clients should receive.",
  },
  {
    q: "How do I edit a template?",
    a: "Open the .docx in Word, Google Docs or LibreOffice (the .xlsx in Excel or Google Sheets), replace every [bracketed] placeholder with your details, delete rows you don't need, and export as PDF before sending. Avoid sending editable files to clients.",
  },
  {
    q: "Is the GST template a tax document?",
    a: "No — a quotation never is. GST on a quotation is an estimate so the client sees the final payable amount; the tax event is the invoice you raise after the work. For a GST tax invoice with CGST/SGST/IGST computed, use the free GST invoice generator.",
  },
  {
    q: "What must a quotation format include?",
    a: "Your business details, a quotation number and date, a validity date, the client's details, an itemised work table, taxes if applicable, the total with amount in words, terms and conditions, and a signature. Every template here includes all nine — see the full quotation format guide for the reasoning.",
  },
];

function faqHtml(): string {
  return FAQ.map((f) => `<h3>${f.q}</h3><p>${f.a}</p>`).join("\n");
}

const STYLE = `<style>
  .tpl-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
  @media(max-width:860px){.tpl-grid{grid-template-columns:1fr}}
  .tpl-card{background:var(--card);border:1px solid var(--card-line);border-radius:16px;padding:20px;box-shadow:0 1px 2px rgba(16,24,40,.04);display:flex;gap:16px}
  @media(max-width:520px){.tpl-card{flex-direction:column}}
  .tpl-thumb{flex:none;width:120px;height:158px;background:#fff;border:1px solid var(--line);border-radius:8px;padding:10px 9px;box-shadow:0 2px 8px rgba(16,24,40,.08);position:relative;overflow:hidden}
  .tpl-thumb .tq{font-size:8px;font-weight:800;color:#0E8C5A;text-align:right;letter-spacing:.04em}
  .tpl-thumb .tb{height:5px;background:#16232E;border-radius:2px;width:60%;margin-bottom:3px}
  .tpl-thumb .tl{height:3px;background:#E2E8F0;border-radius:2px;margin-bottom:2px}
  .tpl-thumb .tt{margin-top:6px;border-radius:3px;overflow:hidden}
  .tpl-thumb .th-r{height:8px;background:#E8F5EE}
  .tpl-thumb .td-r{height:6px;background:#F8FAFC;border-top:1px solid #EEF2F6}
  .tpl-thumb .tot{height:8px;background:#E8F5EE;margin-top:2px;border-radius:2px;width:55%;margin-left:45%}
  .tpl-thumb .xls{position:absolute;top:6px;left:6px;background:#166534;color:#fff;font-size:7px;font-weight:800;padding:2px 5px;border-radius:4px}
  .tpl-body{flex:1;min-width:0}
  .tpl-body h3{margin:0 0 2px;font-size:17px}
  .tpl-kind{font-size:12px;font-weight:700;color:var(--accent-fg);background:var(--accent-bg);border-radius:999px;padding:2px 9px;display:inline-block;margin-bottom:6px}
  .tpl-best{font-size:13.5px;color:var(--muted);margin:0 0 8px}
  .tpl-inc{margin:0 0 12px;padding-left:16px;font-size:13px;color:var(--muted)}
  .tpl-inc li{margin-bottom:2px}
  .tpl-actions{display:flex;gap:8px;flex-wrap:wrap}
  .tpl-actions .btn{padding:9px 14px;font-size:13.5px}
</style>`;

function cards(): string {
  return TEMPLATES.map((tp) => {
    const inc = tp.includes.map((i) => `<li>${esc(i)}</li>`).join("");
    const online = tp.seed
      ? `<button class="btn ghost" type="button" data-seed='${esc(JSON.stringify(tp.seed))}'>Edit online →</button>`
      : `<a class="btn ghost" href="/tools/quotation-maker">Edit online →</a>`;
    const isXls = tp.kind.startsWith("Excel");
    return `<div class="tpl-card">
      <div class="tpl-thumb" aria-hidden="true">
        ${isXls ? '<span class="xls">XLSX</span>' : ""}
        <div class="tq">QUOTATION</div>
        <div class="tb"></div>
        <div class="tl" style="width:80%"></div>
        <div class="tl" style="width:65%"></div>
        <div class="tt"><div class="th-r"></div><div class="td-r"></div><div class="td-r"></div><div class="td-r"></div><div class="td-r"></div></div>
        <div class="tot"></div>
        <div class="tl" style="width:90%;margin-top:7px"></div>
        <div class="tl" style="width:84%"></div>
        <div class="tl" style="width:88%"></div>
      </div>
      <div class="tpl-body">
        <h3>${esc(tp.name)}</h3>
        <span class="tpl-kind">${esc(tp.kind)}</span>
        <p class="tpl-best">${esc(tp.bestFor)}</p>
        <ul class="tpl-inc">${inc}</ul>
        <div class="tpl-actions">
          <a class="btn" href="${esc(tp.file)}" download>⬇ Download free</a>
          ${online}
        </div>
      </div>
    </div>`;
  }).join("\n");
}

const BODY = `
<div class="hero"><div class="wrap">
  <h1>Free Quotation Templates</h1>
  <p class="sub">Download a professional quotation format in Word or Excel — or edit it online and export a PDF. Brand-neutral, made for India, no sign-up.</p>
  <div class="chips">
    <span class="chip">100% free</span>
    <span class="chip">Word &amp; Excel</span>
    <span class="chip">No sign-up</span>
    <span class="chip">GST-ready option</span>
    <span class="chip">Made for India</span>
  </div>
</div></div>

<section><div class="wrap">
  <div class="tpl-grid">${cards()}</div>
</div></section>

<section><div class="wrap">
  <h2>Template or online maker?</h2>
  <p class="muted" style="max-width:720px">A template is perfect when you want full control in Word or Excel. The <a href="/tools/quotation-maker">free online quotation maker</a> is faster when you want the math, GST split and amount-in-words done for you — it produces the same professional format as these files and exports straight to PDF. Either way, send your client a PDF, never an editable file.</p>
</div></section>

<section><div class="wrap">
  <h2>What every quotation format must include</h2>
  <p class="muted" style="max-width:720px">All the templates above carry the nine fields a professional quotation needs: your business details, a quotation number, the date, a <b>validity date</b> (the most-skipped field and the one that costs real money), client details, an itemised work table, taxes where applicable, the total with amount in words, and terms &amp; conditions with a signature. The reasoning behind each field is in the <a href="/blog/quotation-format">quotation format guide</a>.</p>
</div></section>

<section><div class="wrap faq">
  <h2>Frequently asked questions</h2>
  ${faqHtml()}
</div></section>
`;

const PAGE_JS = `
  document.querySelectorAll('[data-seed]').forEach(function(btn){
    btn.addEventListener('click', function(){
      try{
        var seed=JSON.parse(btn.getAttribute('data-seed'));
        localStorage.setItem('dis_quote_v1', JSON.stringify(seed));
      }catch(e){}
      window.location.href='/tools/quotation-maker';
    });
  });
`;

function jsonLd(): object[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Free Quotation Templates (Word, Excel & Online)",
      url: SITE_ORIGIN + PATH,
      description: DESC,
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
  ];
}

export function quotationTemplatesPage(): string {
  return renderToolPage({
    title: TITLE,
    description: DESC,
    canonicalPath: PATH,
    jsonLd: jsonLd(),
    bodyHtml: BODY,
    headExtra: STYLE,
    bodyEndScripts: "<script>(function(){" + PAGE_JS + "})();</script>",
    hideCtaBand: false,
  });
}

export const quotationTemplatesMeta = {
  slug: "quotation-templates",
  path: PATH,
  title: "Quotation Templates",
  blurb: "Download free quotation formats in Word & Excel — or edit them online and export a PDF. Brand-neutral, GST-ready.",
};
