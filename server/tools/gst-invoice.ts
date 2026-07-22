/**
 * Free GST Invoice Generator — the flagship SEO/lead-magnet page.
 *
 * Fully server-rendered HTML (crawlable content + FAQ + structured data); the
 * invoice builder runs entirely in the browser via inline vanilla JS (no data
 * leaves the device). Funnels into signup for save / send / e-sign.
 */
import { renderToolPage, SITE_ORIGIN } from "./layout";
import { COMMON_JS, ITEMS_JS, MEDIA_JS, EXPORT_JS } from "./client-lib";

const PATH = "/tools/gst-invoice-generator";
const TITLE = "Free GST Invoice Generator (India) — Download PDF | DealInSec";
const DESC =
  "Create a professional GST invoice online free. Auto CGST/SGST/IGST split, amount in words, instant PDF — no sign-up. For Indian freelancers, agencies & service businesses.";

const FAQ: { q: string; a: string }[] = [
  {
    q: "Is this GST invoice generator really free?",
    a: "Yes. You can create and download unlimited GST invoices as PDFs for free, with no sign-up required. The invoice is built right in your browser.",
  },
  {
    q: "Do I need a GST number to make an invoice?",
    a: "No. If you are not GST-registered you can leave the GSTIN fields blank and set the tax type to 'No GST', or simply omit the tax. If you are registered, add your GSTIN and choose CGST+SGST (same state) or IGST (different state).",
  },
  {
    q: "What is the difference between CGST/SGST and IGST?",
    a: "For a sale within the same state, GST splits into CGST and SGST (half each). For a sale to a different state, the full rate is charged as IGST. This tool applies the split automatically based on the tax type you pick.",
  },
  {
    q: "Is my data safe?",
    a: "Everything is calculated in your browser. Your business and client details are never sent to or stored on our servers. Your inputs are saved only in your own browser (local storage) so you don't lose them on refresh.",
  },
  {
    q: "Can I save clients and send invoices directly?",
    a: "This free tool creates one-off invoices. To save clients, send invoices, set payment reminders, generate quotations and e-sign agreements, create a free DealInSec account.",
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
      name: "DealInSec GST Invoice Generator",
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
    {
      "@context": "https://schema.org",
      "@type": "HowTo",
      name: "How to create a GST invoice",
      step: [
        { "@type": "HowToStep", name: "Add details", text: "Enter your business, client, invoice number and date." },
        { "@type": "HowToStep", name: "Add items", text: "List each item or service with its quantity and rate." },
        { "@type": "HowToStep", name: "Set GST", text: "Pick the GST rate and choose CGST+SGST or IGST." },
        { "@type": "HowToStep", name: "Download PDF", text: "Click download and save the invoice as a PDF." },
      ],
    },
  ];
}

const BODY = `
<div class="hero"><div class="wrap">
  <h1>Free GST Invoice Generator</h1>
  <p class="sub">Create a professional, GST-ready invoice in under a minute. Auto CGST / SGST / IGST calculation, amount in words, and an instant PDF download — no sign-up, no cost.</p>
  <div class="chips">
    <span class="chip">100% free</span>
    <span class="chip">No sign-up</span>
    <span class="chip">Auto GST split</span>
    <span class="chip">Instant PDF</span>
    <span class="chip">Made for India</span>
  </div>
</div></div>

<section><div class="wrap">
  <div class="grid2">
    <!-- FORM -->
    <div class="card" id="form-card">
      <h2 style="font-size:18px">Invoice details</h2>

      <label>Your business name</label>
      <input class="f" id="bizName" placeholder="e.g. Sunrise Studios" />
      <div class="row2">
        <div><label>Your GSTIN (optional)</label><input class="f" id="bizGstin" placeholder="e.g. 07AABCU9603R1ZM" /></div>
        <div><label>Invoice number</label><input class="f" id="invNo" placeholder="INV-001" /></div>
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

      <label>Bill to (client name)</label>
      <input class="f" id="cliName" placeholder="e.g. Nova Coaching Pvt Ltd" />
      <div class="row2">
        <div><label>Client GSTIN (optional)</label><input class="f" id="cliGstin" placeholder="Client GSTIN" /></div>
        <div><label>Invoice date</label><input class="f" id="invDate" type="date" /></div>
      </div>
      <label>Client address</label>
      <textarea class="f" id="cliAddr" rows="2" placeholder="Client street, city, state, PIN"></textarea>

      <hr style="border:none;border-top:1px solid var(--line);margin:18px 0" />

      <label>Items</label>
      <div id="items"></div>
      <button class="btn ghost" id="addItem" type="button" style="margin-top:10px">+ Add item</button>

      <div class="row2" style="margin-top:16px">
        <div>
          <label>GST rate</label>
          <select class="f" id="gstRate">
            <option value="0">No GST (0%)</option>
            <option value="5">5%</option>
            <option value="12">12%</option>
            <option value="18" selected>18%</option>
            <option value="28">28%</option>
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

      <label>Notes / payment terms (optional)</label>
      <textarea class="f" id="notes" rows="2" placeholder="e.g. Payment due within 7 days. UPI: yourname@upi"></textarea>

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
  <h2>How to create a GST invoice</h2>
  <div class="steps">
    <div class="step"><div class="n">1</div><b>Add details</b><p class="muted">Enter your business, your client, and the invoice number and date.</p></div>
    <div class="step"><div class="n">2</div><b>Add items &amp; GST</b><p class="muted">List what you're billing for, then pick the GST rate and tax type.</p></div>
    <div class="step"><div class="n">3</div><b>Download PDF</b><p class="muted">Your invoice updates live. Click download and save it as a PDF.</p></div>
  </div>
</div></section>

<section><div class="wrap">
  <div class="card">
    <h2>What is a GST invoice?</h2>
    <p class="muted">A GST invoice is a bill a registered business issues for goods or services, showing the GST charged. In India it typically includes the seller's and buyer's details and GSTIN, an invoice number and date, a description of the goods or services, the taxable value, the GST rate, and the tax split as CGST + SGST (for sales within the same state) or IGST (for inter-state sales). This generator formats all of that for you and totals it automatically.</p>
  </div>
</div></section>

<section><div class="wrap faq">
  <h2>Frequently asked questions</h2>
  ${faqHtml()}
</div></section>
`;

const PAGE_JS = `
  var STORE='dis_gst_invoice_v1';
  var IT=initItems(function(){ render(); save(); });
  var LOGO=initLogo('logo-input','logo-preview',function(){ render(); save(); });
  var SIG=initSignature('sig-pad',function(){ render(); save(); });
  var EX=initExport(function(){ return $('invoice-preview'); }, function(){ return $('invNo').value||'Invoice'; });
  initBranding(function(){ render(); });
  var LASTTOTAL=0;
  function saveData(){ return { type:'invoice', docNumber:$('invNo').value, partyName:$('cliName').value, total:LASTTOTAL, payload:collect() }; }
  initSave(saveData);

  function collect(){
    return {
      bizName:$('bizName').value, bizGstin:$('bizGstin').value, bizAddr:$('bizAddr').value, invNo:$('invNo').value,
      cliName:$('cliName').value, cliGstin:$('cliGstin').value, cliAddr:$('cliAddr').value, invDate:$('invDate').value,
      gstRate:$('gstRate').value, taxType:$('taxType').value, notes:$('notes').value, items:IT.get(),
      logo:LOGO.get(), sig:SIG.get(), sigName:$('sigName').value
    };
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
    LASTTOTAL=total;
    var taxRows='';
    if(rate>0){
      if(taxType==='igst'){
        taxRows='<tr><td colspan="3" style="padding:5px 8px;text-align:right;color:#64748B">IGST ('+rate+'%)</td><td style="padding:5px 8px;text-align:right">'+money(taxTotal)+'</td></tr>';
      }else{
        // Split so the two halves sum EXACTLY to the rounded tax (columns foot to total).
        var cgst=round2(taxTotal/2), sgst=round2(taxTotal-cgst);
        taxRows='<tr><td colspan="3" style="padding:5px 8px;text-align:right;color:#64748B">CGST ('+(rate/2)+'%)</td><td style="padding:5px 8px;text-align:right">'+money(cgst)+'</td></tr>'+
          '<tr><td colspan="3" style="padding:5px 8px;text-align:right;color:#64748B">SGST ('+(rate/2)+'%)</td><td style="padding:5px 8px;text-align:right">'+money(sgst)+'</td></tr>';
      }
    }
    var bn=$('bizName').value||'Your Business';
    var html=''+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">'+
        '<div>'+(LOGO.get()?'<img src="'+LOGO.get()+'" alt="" style="max-height:50px;max-width:180px;object-fit:contain;margin-bottom:8px;display:block" />':'')+'<div style="font-size:20px;font-weight:800;color:#0F172A">'+esc(bn)+'</div>'+
          ($('bizGstin').value?'<div style="font-size:12px;color:#64748B">GSTIN: '+esc($('bizGstin').value)+'</div>':'')+
          '<div style="font-size:12px;color:#64748B;white-space:pre-line">'+esc($('bizAddr').value)+'</div></div>'+
        '<div style="text-align:right"><div style="font-size:22px;font-weight:800;letter-spacing:.04em;color:#0E8C5A">INVOICE</div>'+
          ($('invNo').value?'<div style="font-size:13px;color:#0F172A"># '+esc($('invNo').value)+'</div>':'')+
          ($('invDate').value?'<div style="font-size:12px;color:#64748B">'+fmtDate($('invDate').value)+'</div>':'')+'</div>'+
      '</div>'+
      '<div style="margin:16px 0 10px;padding:10px 12px;background:#F8FAFC;border-radius:10px">'+
        '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#94A3B8">Bill to</div>'+
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
          '<tr><td colspan="3" style="padding:10px 8px;text-align:right;font-weight:800;font-size:15px">Total</td><td style="padding:10px 8px;text-align:right;font-weight:800;font-size:15px;color:#0E8C5A">'+money(total)+'</td></tr>'+
        '</tfoot>'+
      '</table>'+
      '<div style="margin-top:10px;font-size:12px;color:#475569"><b>Amount in words:</b> '+esc(words(total))+'</div>'+
      ($('notes').value?'<div style="margin-top:12px;padding-top:10px;border-top:1px dashed #E2E8F0;font-size:12px;color:#475569;white-space:pre-line"><b>Notes:</b> '+esc($('notes').value)+'</div>':'')+
      (SIG.get()?'<div style="margin-top:26px;display:flex;justify-content:flex-end"><div style="text-align:center;min-width:180px"><img src="'+SIG.get()+'" alt="signature" style="max-height:58px;max-width:190px;object-fit:contain" /><div style="border-top:1px solid #94A3B8;margin-top:2px;padding-top:4px;font-size:12px;font-weight:600;color:#0F172A">'+esc($('sigName').value||bn)+'</div><div style="font-size:10px;color:#94A3B8">Authorised Signatory</div></div></div>':'')+
      brandFooter();
    $('invoice-preview').innerHTML=html;
  }

  // Re-render on any top-level field change
  ['bizName','bizGstin','bizAddr','invNo','cliName','cliGstin','cliAddr','invDate','gstRate','taxType','notes','sigName'].forEach(function(id){
    $(id).addEventListener('input',function(){ render(); save(); });
  });
  $('sig-upload').addEventListener('change',function(e){ SIG.upload(e.target.files && e.target.files[0]); e.target.value=''; });
  $('sig-clear').addEventListener('click',function(){ SIG.clear(); });
  $('reset').addEventListener('click',function(){
    try{localStorage.removeItem(STORE);}catch(e){}
    ['bizName','bizGstin','bizAddr','invNo','cliName','cliGstin','cliAddr','invDate','notes','sigName'].forEach(function(id){$(id).value='';});
    $('gstRate').value='18'; $('taxType').value='cgst_sgst';
    LOGO.clear(); SIG.clear();
    IT.set([]); IT.render(); render(); save();
  });
  $('download').addEventListener('click',function(){ document.title=($('invNo').value||'Invoice'); EX.open(); });

  // Restore saved draft (or seed a default row)
  var saved=null; try{ saved=JSON.parse(localStorage.getItem(STORE)||'null'); }catch(e){}
  if(saved){
    ['bizName','bizGstin','bizAddr','invNo','cliName','cliGstin','cliAddr','invDate','gstRate','taxType','notes','sigName'].forEach(function(id){ if(saved[id]!=null)$(id).value=saved[id]; });
    if(saved.logo)LOGO.set(saved.logo);
    if(saved.sig)SIG.set(saved.sig);
    IT.set(saved.items);
  }else{
    IT.set([{desc:'',qty:1,rate:0}]);
  }
  IT.render(); render();
`;

// Print styling is shared (layout.ts) — the preview carries the .print-doc class.
const CLIENT_JS = "<script>(function(){" + COMMON_JS + MEDIA_JS + EXPORT_JS + ITEMS_JS + PAGE_JS + "})();</script>";

export function gstInvoicePage(): string {
  return renderToolPage({
    title: TITLE,
    description: DESC,
    canonicalPath: PATH,
    jsonLd: jsonLd(),
    bodyHtml: BODY,
    bodyEndScripts: CLIENT_JS,
  });
}

export const gstInvoiceMeta = {
  slug: "gst-invoice-generator",
  path: PATH,
  title: "Free GST Invoice Generator",
  blurb: "Create a professional GST invoice with auto CGST/SGST/IGST and download it as a PDF — free, no sign-up.",
};
