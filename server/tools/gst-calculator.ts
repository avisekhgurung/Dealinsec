/**
 * Free GST Calculator — highest-demand lead-magnet (every Indian fintech ships
 * one). Add or remove GST with the CGST/SGST (intra-state) vs IGST (inter-state)
 * split. Uses the GST 2.0 slabs (0/5/18/40%, effective 22 Sep 2025) — a
 * credibility edge, since many competitor calculators still show the old rates.
 * Funnels into the GST Invoice Generator.
 */
import { renderToolPage, SITE_ORIGIN } from "./layout";
import { COMMON_JS } from "./client-lib";

const PATH = "/tools/gst-calculator";
const TITLE = "Free GST Calculator (India) — Add or Remove GST | DealInSec";
const DESC =
  "Free online GST calculator for India. Add or remove GST at 5%, 18% or 40% (GST 2.0 rates) with an instant CGST/SGST or IGST breakdown. No sign-up.";

const FAQ: { q: string; a: string }[] = [
  {
    q: "How do I calculate GST on an amount?",
    a: "To add GST, multiply the amount by the GST rate and add it back — e.g. ₹1,000 at 18% GST is ₹1,000 + ₹180 = ₹1,180. To remove GST from a GST-inclusive price, divide by (1 + rate). This calculator does both instantly.",
  },
  {
    q: "What are the current GST rates in India?",
    a: "Under GST 2.0 (effective 22 September 2025), the main slabs are 0%, 5% and 18%, with a special 40% rate on select luxury and sin goods. Most services fall under 18%. Use the rate that applies to your goods or service.",
  },
  {
    q: "What is the difference between CGST, SGST and IGST?",
    a: "For a sale within the same state, GST is split into CGST (Central) and SGST (State), each half of the rate. For a sale to a different state, the full rate is charged as IGST (Integrated). This calculator shows the correct split for you.",
  },
  {
    q: "Can I create a GST invoice from this?",
    a: "Yes — once you know the GST, use our free GST Invoice Generator to produce a professional, GST-ready invoice PDF in under a minute.",
  },
];

function faqHtml(): string {
  return FAQ.map((f) => `<h3>${f.q}</h3><p>${f.a}</p>`).join("\n");
}

function jsonLd(): object[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "DealInSec GST Calculator",
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: "0", priceCurrency: "INR" },
      url: SITE_ORIGIN + PATH,
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

const BODY = `
<div class="hero"><div class="wrap">
  <h1>Free GST Calculator</h1>
  <p class="sub">Add or remove GST in a tap, with the correct CGST / SGST or IGST split. Updated for GST 2.0 rates. No sign-up, no cost.</p>
  <div class="chips">
    <span class="chip">100% free</span>
    <span class="chip">Add &amp; remove GST</span>
    <span class="chip">CGST / SGST / IGST</span>
    <span class="chip">GST 2.0 rates</span>
  </div>
</div></div>

<section><div class="wrap">
  <div class="grid2">
    <!-- CONTROLS -->
    <div class="card">
      <h2 style="font-size:18px">Enter the amount</h2>

      <div class="seg" id="mode">
        <button type="button" class="seg-btn active" data-mode="add">Add GST</button>
        <button type="button" class="seg-btn" data-mode="remove">Remove GST</button>
      </div>
      <p class="muted" style="font-size:12.5px;margin:6px 0 0" id="mode-hint">Amount is <b>before</b> GST — we'll add it on top.</p>

      <label>Amount (₹)</label>
      <input class="f" id="amount" type="number" min="0" inputmode="decimal" placeholder="10000" />

      <label>GST rate</label>
      <div class="rate-pills" id="rates">
        <button type="button" class="rate-pill" data-rate="5">5%</button>
        <button type="button" class="rate-pill active" data-rate="18">18%</button>
        <button type="button" class="rate-pill" data-rate="40">40%</button>
        <button type="button" class="rate-pill" data-rate="0">0%</button>
      </div>
      <label style="margin-top:12px">Or a custom rate (%)</label>
      <input class="f" id="customRate" type="number" min="0" max="100" step="0.5" placeholder="e.g. 12" />

      <label>Tax type</label>
      <select class="f" id="taxType">
        <option value="cgst_sgst" selected>CGST + SGST (same state)</option>
        <option value="igst">IGST (different state)</option>
      </select>
      <p class="muted" style="font-size:12px;margin-top:12px">GST 2.0 rates apply from 22 Sep 2025. Pick the rate for your goods or service (most services = 18%).</p>
    </div>

    <!-- RESULT -->
    <div>
      <div class="card result-card" id="result"></div>
      <a class="btn" href="/tools/gst-invoice-generator" style="width:100%;justify-content:center;margin-top:14px">Create a GST invoice with this →</a>
    </div>
  </div>
</div></section>

<section id="how"><div class="wrap">
  <h2>How GST is calculated</h2>
  <div class="steps">
    <div class="step"><div class="n">1</div><b>Add GST</b><p class="muted">GST = amount × rate. Total = amount + GST. e.g. ₹1,000 @ 18% → ₹1,180.</p></div>
    <div class="step"><div class="n">2</div><b>Remove GST</b><p class="muted">From a GST-inclusive price: base = price ÷ (1 + rate). e.g. ₹1,180 → ₹1,000 + ₹180.</p></div>
    <div class="step"><div class="n">3</div><b>Split the tax</b><p class="muted">Same state → CGST + SGST (half each). Other state → full IGST.</p></div>
  </div>
</div></section>

<section id="faq"><div class="wrap faq">
  <h2>Frequently asked questions</h2>
  ${faqHtml()}
</div></section>
`;

const PAGE_JS = `
  var mode='add', rate=18;
  function money(x){return '\\u20B9'+(num(x)).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});}
  function setActive(container, el){ container.querySelectorAll('.active').forEach(function(b){b.classList.remove('active');}); if(el) el.classList.add('active'); }

  document.querySelectorAll('#mode .seg-btn').forEach(function(b){
    b.addEventListener('click', function(){ mode=b.getAttribute('data-mode'); setActive($('mode'), b);
      $('mode-hint').innerHTML = mode==='add' ? "Amount is <b>before</b> GST — we'll add it on top." : "Amount <b>includes</b> GST — we'll pull it out.";
      render(); });
  });
  document.querySelectorAll('#rates .rate-pill').forEach(function(b){
    b.addEventListener('click', function(){ rate=num(b.getAttribute('data-rate')); setActive($('rates'), b); $('customRate').value=''; render(); });
  });
  $('customRate').addEventListener('input', function(){ if(this.value!==''){ rate=num(this.value); setActive($('rates'), null); } render(); });
  $('amount').addEventListener('input', render);
  $('taxType').addEventListener('change', render);

  function render(){
    var amt=round2(num($('amount').value));
    var r=rate;
    var base, gst, gross;
    if(mode==='remove'){ gross=amt; base=round2(amt/(1+r/100)); gst=round2(gross-base); }
    else { base=amt; gst=round2(amt*r/100); gross=round2(amt+gst); }
    var taxType=$('taxType').value;
    var splitRows;
    if(taxType==='igst'){
      splitRows='<div class="res-row"><span>IGST ('+r+'%)</span><span>'+money(gst)+'</span></div>';
    } else {
      var cgst=round2(gst/2), sgst=round2(gst-cgst);
      splitRows='<div class="res-row"><span>CGST ('+(r/2)+'%)</span><span>'+money(cgst)+'</span></div>'+
        '<div class="res-row"><span>SGST ('+(r/2)+'%)</span><span>'+money(sgst)+'</span></div>';
    }
    $('result').innerHTML =
      '<div class="res-head">'+(mode==='remove'?'Total (incl. GST)':'Amount before GST')+'</div>'+
      '<div class="res-big">'+money(mode==='remove'?gross:base)+'</div>'+
      '<div class="res-rows">'+
        '<div class="res-row"><span>'+(mode==='remove'?'Base amount':'Base amount')+'</span><span>'+money(base)+'</span></div>'+
        splitRows+
        '<div class="res-row total"><span>'+(mode==='remove'?'GST included':'Total payable')+'</span><span>'+money(mode==='remove'?gst:gross)+'</span></div>'+
      '</div>'+
      '<div class="res-foot">'+(mode==='remove'
        ? 'A '+money(gross)+' GST-inclusive price contains '+money(gst)+' of GST at '+r+'%.'
        : money(base)+' + '+money(gst)+' GST ('+r+'%) = '+money(gross)+'.')+'</div>';
  }
  render();
`;

const STYLE = `<style>
  .seg{display:flex;gap:4px;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:4px;margin-top:6px}
  .seg-btn{flex:1;padding:9px;border:0;background:transparent;border-radius:9px;font:inherit;font-size:14px;font-weight:700;color:var(--muted);cursor:pointer}
  .seg-btn.active{background:var(--card);color:var(--green-d);box-shadow:0 1px 3px rgba(16,24,40,.08)}
  .rate-pills{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
  .rate-pill{padding:9px 16px;border:1.5px solid var(--line);border-radius:11px;background:var(--card);font:inherit;font-size:14px;font-weight:700;color:var(--ink);cursor:pointer}
  .rate-pill.active{background:var(--green);border-color:var(--green);color:#fff}
  .result-card{background:linear-gradient(135deg,var(--accent-bg),var(--card));border-color:var(--accent-line)}
  .res-head{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700}
  .res-big{font-size:34px;font-weight:800;color:var(--ink);letter-spacing:-.02em;margin:2px 0 14px}
  .res-rows{border-top:1px solid var(--accent-line);padding-top:12px}
  .res-row{display:flex;justify-content:space-between;font-size:14px;color:var(--muted);padding:5px 0}
  .res-row span:last-child{font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums}
  .res-row.total{border-top:1px dashed var(--accent-line);margin-top:6px;padding-top:12px;font-size:16px}
  .res-row.total span{color:var(--green-d);font-weight:800}
  .res-foot{margin-top:14px;font-size:12.5px;color:var(--muted);background:var(--card);border-radius:10px;padding:10px 12px}
</style>`;

export function gstCalculatorPage(): string {
  return renderToolPage({
    title: TITLE,
    description: DESC,
    canonicalPath: PATH,
    jsonLd: jsonLd(),
    headExtra: STYLE,
    bodyHtml: BODY,
    bodyEndScripts: "<script>(function(){" + COMMON_JS + PAGE_JS + "})();</script>",
  });
}

export const gstCalculatorMeta = {
  slug: "gst-calculator",
  path: PATH,
  title: "Free GST Calculator",
  blurb: "Add or remove GST at 5%, 18% or 40% with an instant CGST/SGST or IGST breakdown — GST 2.0 rates, no sign-up.",
};
