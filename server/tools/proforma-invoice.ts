/**
 * Free Proforma Invoice Generator — reuses the invoice rendering with proforma
 * framing (a preliminary bill / advance estimate, NOT a GST tax invoice). Strong
 * funnel: once the deal is confirmed, "convert" to a real GST tax invoice.
 */
import { renderToolPage, SITE_ORIGIN } from "./layout";
import { COMMON_JS, ITEMS_JS, MEDIA_JS, EXPORT_JS } from "./client-lib";

const PATH = "/tools/proforma-invoice-generator";
const TITLE = "Free Proforma Invoice Generator (India) — Download PDF | DealInSec";
const DESC =
  "Create a professional proforma invoice online free. GST-ready format, amount in words, validity date, instant PDF — no sign-up. For Indian freelancers, agencies & exporters.";

const FAQ: { q: string; a: string }[] = [
  {
    q: "What is a proforma invoice?",
    a: "A proforma invoice is a preliminary bill of sale sent to a buyer before the goods or services are supplied. It states the items, quantities, prices and estimated taxes so the buyer can arrange payment or approval. It is not a demand for payment and is not a valid GST tax invoice.",
  },
  {
    q: "How is a proforma invoice different from a tax invoice?",
    a: "A proforma invoice is an estimate issued before a sale to confirm price and terms; it does not create a tax liability. A GST tax invoice is issued after the sale is agreed and is the legal document used to claim input tax credit. Once your deal is confirmed, convert the proforma into a proper GST invoice.",
  },
  {
    q: "When should I use a proforma invoice?",
    a: "Use it to quote a firm price, request an advance, help a client raise a purchase order, or for export/customs pre-clearance. It signals intent to supply on stated terms without triggering GST until the actual invoice is raised.",
  },
  {
    q: "Is this proforma invoice generator free?",
    a: "Yes. Create and download unlimited proforma invoices as PDFs for free, with no sign-up. Everything is built in your browser and never sent to our servers.",
  },
  {
    q: "Can I turn a proforma into a real GST invoice?",
    a: "Yes — once the client confirms, use our free GST Invoice Generator, or create a DealInSec account to convert quotes and proformas into invoices, track payments and e-sign agreements.",
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
      name: "DealInSec Proforma Invoice Generator",
      applicationCategory: "BusinessApplication",
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
  <h1>Free Proforma Invoice Generator</h1>
  <p class="sub">Send a professional proforma invoice to confirm price and terms before the sale. GST-ready format, validity date, amount in words and an instant PDF — no sign-up, no cost.</p>
  <div class="chips">
    <span class="chip">100% free</span>
    <span class="chip">No sign-up</span>
    <span class="chip">GST-ready format</span>
    <span class="chip">Instant PDF</span>
    <span class="chip">Made for India</span>
  </div>
</div></div>

<section><div class="wrap">
  <div class="grid2">
    <!-- FORM -->
    <div class="card" id="form-card">
      <h2 style="font-size:18px">Proforma details</h2>

      <label>Your business name</label>
      <input class="f" id="bizName" placeholder="e.g. Sunrise Studios" />
      <div class="row2">
        <div><label>Your GSTIN (optional)</label><input class="f" id="bizGstin" placeholder="e.g. 07AABCU9603R1ZM" /></div>
        <div><label>Proforma number</label><input class="f" id="invNo" placeholder="PI-001" /></div>
      </div>
      <label>Your address</label>
      <textarea class="f" id="bizAddr" rows="2" placeholder="Street, City, State, PIN"></textarea>

      <label>Business logo (optional)</label>
      <div class="logo-preview" id="logo-preview" style="display:none"></div>
      <div class="sig-actions">
        <label class="file-btn">Upload logo<input type="file" id="logo-input" accept="image/*" /></label>
        <button type="button" class="file-btn" id="logo-input-clear">Remove</button>
      </div>

      <hr style="border:none;border-top:1px solid var(--line);margin:18px 0" />

      <label>For (client name)</label>
      <input class="f" id="cliName" placeholder="e.g. Nova Coaching Pvt Ltd" />
      <div class="row2">
        <div><label>Client GSTIN (optional)</label><input class="f" id="cliGstin" placeholder="Client GSTIN" /></div>
        <div><label>Proforma date</label><input class="f" id="invDate" type="date" /></div>
      </div>
      <div class="row2">
        <div><label>Client address</label><textarea class="f" id="cliAddr" rows="2" placeholder="Client street, city, state, PIN"></textarea></div>
        <div><label>Valid until (optional)</label><input class="f" id="validUntil" type="date" /></div>
      </div>

      <hr style="border:none;border-top:1px solid var(--line);margin:18px 0" />

      <label>Items</label>
      <div id="items"></div>
      <button class="btn ghost" id="addItem" type="button" style="margin-top:10px">+ Add item</button>

      <div class="row2" style="margin-top:16px">
        <div>
          <label>GST rate (estimated)</label>
          <select class="f" id="gstRate">
            <option value="0">No GST (0%)</option>
            <option value="5">5%</option>
            <option value="18" selected>18%</option>
            <option value="40">40%</option>
          </select>
        </div>
        <div>
          <label>Tax type</label>
          <select class="f" id="taxType">
            <option value="cgst_sgst" selected>CGST + SGST (same state)</option>
            <option value="igst">IGST (different state)</option>
          </select>
        </div>
      </div>

      <label>Notes / terms (optional)</label>
      <textarea class="f" id="notes" rows="2" placeholder="e.g. 50% advance to confirm order. Prices valid for 15 days."></textarea>

      <label>Signature (optional) — draw below or upload an image</label>
      <canvas id="sig-pad" class="sig-pad"></canvas>
      <div class="sig-actions">
        <button type="button" class="file-btn" id="sig-clear">Clear</button>
        <label class="file-btn">Upload image<input type="file" id="sig-upload" accept="image/*" /></label>
      </div>
      <input class="f" id="sigName" placeholder="Signatory name (optional)" style="margin-top:8px" />

      <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap">
        <button class="btn" id="download" type="button">⬇ Download / Share</button>
        <button class="btn ghost" id="reset" type="button">Reset</button>
      </div>
      <p class="muted" style="font-size:13px;margin-top:10px">Tip: in the print dialog choose <b>Save as PDF</b>.</p>
    </div>

    <!-- PREVIEW -->
    <div>
      <div id="invoice-preview" class="card print-doc"></div>
    </div>
  </div>
</div></section>

<section><div class="wrap">
  <h2>How to create a proforma invoice</h2>
  <div class="steps">
    <div class="step"><div class="n">1</div><b>Add details</b><p class="muted">Enter your business, your client, and a proforma number and date.</p></div>
    <div class="step"><div class="n">2</div><b>Add items &amp; estimated GST</b><p class="muted">List what you'll supply, then pick the estimated GST rate and tax type.</p></div>
    <div class="step"><div class="n">3</div><b>Send it</b><p class="muted">Download the PDF and share it. When the client confirms, raise a tax invoice.</p></div>
  </div>
</div></section>

<section><div class="wrap">
  <div class="card">
    <h2>Proforma invoice vs tax invoice</h2>
    <p class="muted">A proforma invoice is a good-faith estimate you send <b>before</b> a sale is finalised — it confirms the items, prices and terms so a buyer can approve the order, arrange an advance or raise a purchase order. It does not create a GST liability and cannot be used to claim input tax credit. A <b>GST tax invoice</b> is issued <b>after</b> the sale is agreed and is the legal document for the transaction. This generator produces a clean, professional proforma; once your client confirms, convert it into a proper GST invoice.</p>
  </div>
</div></section>

<section><div class="wrap faq">
  <h2>Frequently asked questions</h2>
  ${faqHtml()}
</div></section>
`;

const PAGE_JS = `
  var STORE='dis_proforma_v1';
  var IT=initItems(function(){ render(); save(); });
  var LOGO=initLogo('logo-input','logo-preview',function(){ render(); save(); });
  var SIG=initSignature('sig-pad',function(){ render(); save(); });
  var EX=initExport(function(){ return $('invoice-preview'); }, function(){ return $('invNo').value||'Proforma'; });
  initBranding(function(){ render(); });

  var FIELDS=['bizName','bizGstin','bizAddr','invNo','cliName','cliGstin','cliAddr','invDate','validUntil','gstRate','taxType','notes','sigName'];

  function collect(){
    var o={ items:IT.get(), logo:LOGO.get(), sig:SIG.get() };
    FIELDS.forEach(function(id){ o[id]=$(id).value; });
    return o;
  }
  function save(){ try{ localStorage.setItem(STORE, JSON.stringify(collect())); }catch(e){} }

  function render(){
    var subtotal=0;
    var rows=IT.get().map(function(it){
      var amt=round2(num(it.qty)*num(it.rate)); subtotal+=amt;
      return '<tr><td style="padding:7px 8px;border-bottom:1px solid #EEF2F6">'+esc(it.desc||'-')+'</td>'+
        '<td style="padding:7px 8px;border-bottom:1px solid #EEF2F6;text-align:right">'+esc(it.qty)+'</td>'+
        '<td style="padding:7px 8px;border-bottom:1px solid #EEF2F6;text-align:right">'+money(it.rate)+'</td>'+
        '<td style="padding:7px 8px;border-bottom:1px solid #EEF2F6;text-align:right">'+money(amt)+'</td></tr>';
    }).join('');
    subtotal=round2(subtotal);
    var rate=num($('gstRate').value), taxType=$('taxType').value;
    var taxTotal=round2(subtotal*rate/100);
    var total=round2(subtotal+taxTotal);
    var taxRows='';
    if(rate>0){
      if(taxType==='igst'){
        taxRows='<tr><td colspan="3" style="padding:5px 8px;text-align:right;color:#64748B">IGST ('+rate+'%)</td><td style="padding:5px 8px;text-align:right">'+money(taxTotal)+'</td></tr>';
      }else{
        var cgst=round2(taxTotal/2), sgst=round2(taxTotal-cgst);
        taxRows='<tr><td colspan="3" style="padding:5px 8px;text-align:right;color:#64748B">CGST ('+(rate/2)+'%)</td><td style="padding:5px 8px;text-align:right">'+money(cgst)+'</td></tr>'+
          '<tr><td colspan="3" style="padding:5px 8px;text-align:right;color:#64748B">SGST ('+(rate/2)+'%)</td><td style="padding:5px 8px;text-align:right">'+money(sgst)+'</td></tr>';
      }
    }
    var bn=$('bizName').value||'Your Business';
    var validRow = $('validUntil').value ? '<div style="font-size:12px;color:#64748B">Valid until '+fmtDate($('validUntil').value)+'</div>' : '';
    var html=''+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">'+
        '<div>'+(LOGO.get()?'<img src="'+LOGO.get()+'" alt="" style="max-height:50px;max-width:180px;object-fit:contain;margin-bottom:8px;display:block" />':'')+'<div style="font-size:20px;font-weight:800;color:#0F172A">'+esc(bn)+'</div>'+
          ($('bizGstin').value?'<div style="font-size:12px;color:#64748B">GSTIN: '+esc($('bizGstin').value)+'</div>':'')+
          '<div style="font-size:12px;color:#64748B;white-space:pre-line">'+esc($('bizAddr').value)+'</div></div>'+
        '<div style="text-align:right"><div style="font-size:20px;font-weight:800;letter-spacing:.03em;color:#0E8C5A">PROFORMA INVOICE</div>'+
          ($('invNo').value?'<div style="font-size:13px;color:#0F172A"># '+esc($('invNo').value)+'</div>':'')+
          ($('invDate').value?'<div style="font-size:12px;color:#64748B">'+fmtDate($('invDate').value)+'</div>':'')+
          validRow+'</div>'+
      '</div>'+
      '<div style="margin:16px 0 10px;padding:10px 12px;background:#F8FAFC;border-radius:10px">'+
        '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#94A3B8">For</div>'+
        '<div style="font-weight:700;color:#0F172A">'+esc($('cliName').value||'Client name')+'</div>'+
        ($('cliGstin').value?'<div style="font-size:12px;color:#64748B">GSTIN: '+esc($('cliGstin').value)+'</div>':'')+
        '<div style="font-size:12px;color:#64748B;white-space:pre-line">'+esc($('cliAddr').value)+'</div>'+
      '</div>'+
      '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:6px">'+
        '<thead><tr style="background:#0E8C5A;color:#fff">'+
          '<th style="padding:8px;text-align:left;border-radius:8px 0 0 0">Description</th>'+
          '<th style="padding:8px;text-align:right">Qty</th>'+
          '<th style="padding:8px;text-align:right">Rate</th>'+
          '<th style="padding:8px;text-align:right;border-radius:0 8px 0 0">Amount</th>'+
        '</tr></thead><tbody>'+(rows||'<tr><td colspan="4" style="padding:14px;text-align:center;color:#94A3B8">Add an item to begin</td></tr>')+'</tbody>'+
        '<tfoot>'+
          '<tr><td colspan="3" style="padding:8px;text-align:right;color:#64748B">Subtotal</td><td style="padding:8px;text-align:right">'+money(subtotal)+'</td></tr>'+
          taxRows+
          '<tr><td colspan="3" style="padding:10px 8px;text-align:right;font-weight:800;font-size:15px">Estimated total</td><td style="padding:10px 8px;text-align:right;font-weight:800;font-size:15px;color:#0E8C5A">'+money(total)+'</td></tr>'+
        '</tfoot>'+
      '</table>'+
      '<div style="margin-top:10px;font-size:12px;color:#475569"><b>Amount in words:</b> '+esc(words(total))+'</div>'+
      ($('notes').value?'<div style="margin-top:12px;padding-top:10px;border-top:1px dashed #E2E8F0;font-size:12px;color:#475569;white-space:pre-line"><b>Notes:</b> '+esc($('notes').value)+'</div>':'')+
      '<div style="margin-top:10px;font-size:11px;color:#94A3B8;font-style:italic">This is a proforma invoice — an estimate of the goods/services and price. It is not a GST tax invoice and not a demand for payment.</div>'+
      (SIG.get()?'<div style="margin-top:22px;display:flex;justify-content:flex-end"><div style="text-align:center;min-width:180px"><img src="'+SIG.get()+'" alt="signature" style="max-height:58px;max-width:190px;object-fit:contain" /><div style="border-top:1px solid #94A3B8;margin-top:2px;padding-top:4px;font-size:12px;font-weight:600;color:#0F172A">'+esc($('sigName').value||bn)+'</div><div style="font-size:10px;color:#94A3B8">Authorised Signatory</div></div></div>':'')+
      brandFooter();
    $('invoice-preview').innerHTML=html;
  }

  FIELDS.forEach(function(id){ $(id).addEventListener('input',function(){ render(); save(); }); });
  $('sig-upload').addEventListener('change',function(e){ SIG.upload(e.target.files && e.target.files[0]); e.target.value=''; });
  $('sig-clear').addEventListener('click',function(){ SIG.clear(); });
  $('reset').addEventListener('click',function(){
    try{localStorage.removeItem(STORE);}catch(e){}
    ['bizName','bizGstin','bizAddr','invNo','cliName','cliGstin','cliAddr','invDate','validUntil','notes','sigName'].forEach(function(id){$(id).value='';});
    $('gstRate').value='18'; $('taxType').value='cgst_sgst';
    LOGO.clear(); SIG.clear();
    IT.set([]); IT.render(); render(); save();
  });
  $('download').addEventListener('click',function(){ document.title=($('invNo').value||'Proforma'); EX.open(); });

  var saved=null; try{ saved=JSON.parse(localStorage.getItem(STORE)||'null'); }catch(e){}
  if(saved){
    FIELDS.forEach(function(id){ if(saved[id]!=null)$(id).value=saved[id]; });
    if(saved.logo)LOGO.set(saved.logo);
    if(saved.sig)SIG.set(saved.sig);
    IT.set(saved.items);
  }else{
    IT.set([{desc:'',qty:1,rate:0}]);
  }
  IT.render(); render();
`;

const CLIENT_JS = "<script>(function(){" + COMMON_JS + MEDIA_JS + EXPORT_JS + ITEMS_JS + PAGE_JS + "})();</script>";

export function proformaInvoicePage(): string {
  return renderToolPage({
    title: TITLE,
    description: DESC,
    canonicalPath: PATH,
    jsonLd: jsonLd(),
    bodyHtml: BODY,
    bodyEndScripts: CLIENT_JS,
  });
}

export const proformaInvoiceMeta = {
  slug: "proforma-invoice-generator",
  path: PATH,
  title: "Free Proforma Invoice Generator",
  blurb: "Send a professional proforma invoice to confirm price and terms before the sale — GST-ready format, instant PDF, no sign-up.",
};
