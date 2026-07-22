/**
 * Free Purchase Order Generator — a buyer issues a PO to a vendor/supplier.
 * Same document engine as the invoice tools (logo, signature, export), but with
 * buyer→vendor framing, a delivery date and an optional ship-to address.
 */
import { renderToolPage, SITE_ORIGIN } from "./layout";
import { COMMON_JS, ITEMS_JS, MEDIA_JS, EXPORT_JS } from "./client-lib";

const PATH = "/tools/purchase-order-generator";
const TITLE = "Free Purchase Order Generator (India) — Download PDF | DealInSec";
const DESC =
  "Create a professional purchase order (PO) online free. Vendor details, delivery date, GST-ready totals, amount in words, instant PDF — no sign-up. Made for India.";

const FAQ: { q: string; a: string }[] = [
  {
    q: "What is a purchase order?",
    a: "A purchase order (PO) is a document a buyer sends to a supplier to formally request goods or services at agreed prices. It lists the items, quantities, rates, delivery date and terms, and becomes a binding contract once the supplier accepts it.",
  },
  {
    q: "What is the difference between a purchase order and an invoice?",
    a: "A purchase order is issued by the buyer before delivery to order goods or services. An invoice is issued by the supplier after delivery to request payment. The PO number is usually quoted on the matching invoice so both sides can reconcile the order.",
  },
  {
    q: "What should a purchase order include?",
    a: "A clear PO includes the buyer and supplier details (with GSTIN where applicable), a unique PO number and date, an expected delivery date, a line-item list with quantities and rates, the total value, and any terms such as payment or delivery conditions.",
  },
  {
    q: "Is this purchase order generator free?",
    a: "Yes. Create and download unlimited purchase orders as PDFs for free, with no sign-up. Everything runs in your browser and is never sent to our servers.",
  },
  {
    q: "Can I manage POs, quotes and invoices together?",
    a: "This free tool creates one-off purchase orders. Create a free DealInSec account to manage the full deal workflow — quotations, agreements, e-signatures and GST invoices — in one place.",
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
      name: "DealInSec Purchase Order Generator",
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
  <h1>Free Purchase Order Generator</h1>
  <p class="sub">Raise a clean, professional purchase order for your vendor in under a minute. Delivery date, GST-ready totals, amount in words and an instant PDF — no sign-up, no cost.</p>
  <div class="chips">
    <span class="chip">100% free</span>
    <span class="chip">No sign-up</span>
    <span class="chip">Vendor &amp; delivery</span>
    <span class="chip">Instant PDF</span>
    <span class="chip">Made for India</span>
  </div>
</div></div>

<section><div class="wrap">
  <div class="grid2">
    <!-- FORM -->
    <div class="card" id="form-card">
      <h2 style="font-size:18px">Purchase order details</h2>

      <label>Your company (buyer)</label>
      <input class="f" id="bizName" placeholder="e.g. Sunrise Studios" />
      <div class="row2">
        <div><label>Your GSTIN (optional)</label><input class="f" id="bizGstin" placeholder="e.g. 07AABCU9603R1ZM" /></div>
        <div><label>PO number</label><input class="f" id="poNo" placeholder="PO-001" /></div>
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

      <label>Vendor / supplier name</label>
      <input class="f" id="venName" placeholder="e.g. Apex Supplies Pvt Ltd" />
      <div class="row2">
        <div><label>Vendor GSTIN (optional)</label><input class="f" id="venGstin" placeholder="Vendor GSTIN" /></div>
        <div><label>PO date</label><input class="f" id="poDate" type="date" /></div>
      </div>
      <div class="row2">
        <div><label>Vendor address</label><textarea class="f" id="venAddr" rows="2" placeholder="Vendor street, city, state, PIN"></textarea></div>
        <div><label>Expected delivery (optional)</label><input class="f" id="delDate" type="date" /></div>
      </div>
      <label>Ship to (optional — if different from your address)</label>
      <textarea class="f" id="shipAddr" rows="2" placeholder="Delivery address"></textarea>

      <hr style="border:none;border-top:1px solid var(--line);margin:18px 0" />

      <label>Items</label>
      <div id="items"></div>
      <button class="btn ghost" id="addItem" type="button" style="margin-top:10px">+ Add item</button>

      <div class="row2" style="margin-top:16px">
        <div>
          <label>GST rate (optional)</label>
          <select class="f" id="gstRate">
            <option value="0" selected>No GST (0%)</option>
            <option value="5">5%</option>
            <option value="18">18%</option>
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
      <textarea class="f" id="notes" rows="2" placeholder="e.g. Delivery within 10 days. Payment 30 days from delivery. Quote PO number on invoice."></textarea>

      <label>Signature (optional) — draw below or upload an image</label>
      <canvas id="sig-pad" class="sig-pad"></canvas>
      <div class="sig-actions">
        <button type="button" class="file-btn" id="sig-clear">Clear</button>
        <label class="file-btn">Upload image<input type="file" id="sig-upload" accept="image/*" /></label>
      </div>
      <input class="f" id="sigName" placeholder="Authorised by (optional)" style="margin-top:8px" />

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
  <h2>How to create a purchase order</h2>
  <div class="steps">
    <div class="step"><div class="n">1</div><b>Add buyer &amp; vendor</b><p class="muted">Enter your company, your supplier, and a PO number and date.</p></div>
    <div class="step"><div class="n">2</div><b>Add items &amp; delivery</b><p class="muted">List what you're ordering with quantities and rates, and an expected delivery date.</p></div>
    <div class="step"><div class="n">3</div><b>Send it</b><p class="muted">Download the PDF and send it to your vendor to confirm the order.</p></div>
  </div>
</div></section>

<section><div class="wrap">
  <div class="card">
    <h2>What is a purchase order?</h2>
    <p class="muted">A purchase order is a document a buyer sends to a supplier to formally request goods or services at agreed prices. It records exactly what is being ordered, the quantities and rates, the delivery date and any terms — and becomes a binding agreement once the supplier accepts it. Using POs gives both sides a clear paper trail: the buyer controls spend and the supplier knows precisely what to deliver and invoice. Quote the PO number on the matching invoice so everything reconciles.</p>
  </div>
</div></section>

<section><div class="wrap faq">
  <h2>Frequently asked questions</h2>
  ${faqHtml()}
</div></section>
`;

const PAGE_JS = `
  var STORE='dis_purchase_order_v1';
  var IT=initItems(function(){ render(); save(); });
  var LOGO=initLogo('logo-input','logo-preview',function(){ render(); save(); });
  var SIG=initSignature('sig-pad',function(){ render(); save(); });
  var EX=initExport(function(){ return $('invoice-preview'); }, function(){ return $('poNo').value||'Purchase-Order'; });
  initBranding(function(){ render(); });
  var LASTTOTAL=0;
  function saveData(){ return { type:'purchase_order', docNumber:$('poNo').value, partyName:$('venName').value, total:LASTTOTAL, payload:collect() }; }
  initSave(saveData);

  var FIELDS=['bizName','bizGstin','bizAddr','poNo','venName','venGstin','venAddr','poDate','delDate','shipAddr','gstRate','taxType','notes','sigName'];

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
    LASTTOTAL=total;
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
    var bn=$('bizName').value||'Your Company';
    var metaRight=''+
      ($('poNo').value?'<div style="font-size:13px;color:#0F172A"># '+esc($('poNo').value)+'</div>':'')+
      ($('poDate').value?'<div style="font-size:12px;color:#64748B">Dated '+fmtDate($('poDate').value)+'</div>':'')+
      ($('delDate').value?'<div style="font-size:12px;color:#64748B">Deliver by '+fmtDate($('delDate').value)+'</div>':'');
    var shipBox = $('shipAddr').value
      ? '<div style="flex:1;min-width:150px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#94A3B8">Ship to</div>'+
        '<div style="font-size:12px;color:#475569;white-space:pre-line">'+esc($('shipAddr').value)+'</div></div>'
      : '';
    var html=''+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">'+
        '<div>'+(LOGO.get()?'<img src="'+LOGO.get()+'" alt="" style="max-height:50px;max-width:180px;object-fit:contain;margin-bottom:8px;display:block" />':'')+'<div style="font-size:20px;font-weight:800;color:#0F172A">'+esc(bn)+'</div>'+
          ($('bizGstin').value?'<div style="font-size:12px;color:#64748B">GSTIN: '+esc($('bizGstin').value)+'</div>':'')+
          '<div style="font-size:12px;color:#64748B;white-space:pre-line">'+esc($('bizAddr').value)+'</div></div>'+
        '<div style="text-align:right"><div style="font-size:21px;font-weight:800;letter-spacing:.03em;color:#0E8C5A">PURCHASE ORDER</div>'+metaRight+'</div>'+
      '</div>'+
      '<div style="display:flex;gap:12px;margin:16px 0 10px">'+
        '<div style="flex:1;min-width:150px;padding:10px 12px;background:#F8FAFC;border-radius:10px">'+
          '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#94A3B8">Vendor</div>'+
          '<div style="font-weight:700;color:#0F172A">'+esc($('venName').value||'Vendor name')+'</div>'+
          ($('venGstin').value?'<div style="font-size:12px;color:#64748B">GSTIN: '+esc($('venGstin').value)+'</div>':'')+
          '<div style="font-size:12px;color:#64748B;white-space:pre-line">'+esc($('venAddr').value)+'</div>'+
        '</div>'+
        (shipBox?'<div style="flex:1;min-width:150px;padding:10px 12px;background:#F8FAFC;border-radius:10px">'+
          '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#94A3B8">Ship to</div>'+
          '<div style="font-size:12px;color:#475569;white-space:pre-line;margin-top:2px">'+esc($('shipAddr').value)+'</div></div>':'')+
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
      ($('notes').value?'<div style="margin-top:12px;padding-top:10px;border-top:1px dashed #E2E8F0;font-size:12px;color:#475569;white-space:pre-line"><b>Terms:</b> '+esc($('notes').value)+'</div>':'')+
      (SIG.get()?'<div style="margin-top:24px;display:flex;justify-content:flex-end"><div style="text-align:center;min-width:180px"><img src="'+SIG.get()+'" alt="signature" style="max-height:58px;max-width:190px;object-fit:contain" /><div style="border-top:1px solid #94A3B8;margin-top:2px;padding-top:4px;font-size:12px;font-weight:600;color:#0F172A">'+esc($('sigName').value||bn)+'</div><div style="font-size:10px;color:#94A3B8">Authorised Signatory</div></div></div>':'')+
      brandFooter();
    $('invoice-preview').innerHTML=html;
  }

  FIELDS.forEach(function(id){ $(id).addEventListener('input',function(){ render(); save(); }); });
  $('sig-upload').addEventListener('change',function(e){ SIG.upload(e.target.files && e.target.files[0]); e.target.value=''; });
  $('sig-clear').addEventListener('click',function(){ SIG.clear(); });
  $('reset').addEventListener('click',function(){
    try{localStorage.removeItem(STORE);}catch(e){}
    ['bizName','bizGstin','bizAddr','poNo','venName','venGstin','venAddr','poDate','delDate','shipAddr','notes','sigName'].forEach(function(id){$(id).value='';});
    $('gstRate').value='0'; $('taxType').value='cgst_sgst';
    LOGO.clear(); SIG.clear();
    IT.set([]); IT.render(); render(); save();
  });
  $('download').addEventListener('click',function(){ document.title=($('poNo').value||'Purchase-Order'); EX.open(); });

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

export function purchaseOrderPage(): string {
  return renderToolPage({
    title: TITLE,
    description: DESC,
    canonicalPath: PATH,
    jsonLd: jsonLd(),
    bodyHtml: BODY,
    bodyEndScripts: CLIENT_JS,
  });
}

export const purchaseOrderMeta = {
  slug: "purchase-order-generator",
  path: PATH,
  title: "Free Purchase Order Generator",
  blurb: "Raise a professional purchase order for your vendor with delivery date and GST-ready totals — instant PDF, no sign-up.",
};
