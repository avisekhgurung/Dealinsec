/**
 * Free Quotation / Estimate Maker — a lead-magnet SEO page.
 *
 * Server-rendered content + in-browser quotation builder (line items, optional
 * GST, standard T&Cs, amount in words, PDF via print). Funnels into signup:
 * turn a quotation into a signed deal + GST invoice inside DealInSec.
 */
import { renderToolPage, SITE_ORIGIN } from "./layout";
import { COMMON_JS, ITEMS_JS, MEDIA_JS, EXPORT_JS } from "./client-lib";
import { STANDARD_TERMS } from "@shared/schema";

const PATH = "/tools/quotation-maker";
const TITLE = "Free Quotation Maker (India) — Create & Download PDF | DealInSec";
const DESC =
  "Make a professional quotation or estimate online free. Line items, optional GST, standard terms, amount in words, instant PDF — no sign-up. For Indian freelancers & service businesses.";

const FAQ: { q: string; a: string }[] = [
  {
    q: "Is this quotation maker free?",
    a: "Yes. Create and download unlimited quotations as PDFs for free, with no sign-up. Everything runs in your browser.",
  },
  {
    q: "What should a quotation include?",
    a: "A good quotation shows your business and client details, a quotation number and date, a validity date, an itemised list of the work with quantities and rates, any applicable GST, the total, and clear terms such as advance payment and revisions.",
  },
  {
    q: "What is the difference between a quotation and an invoice?",
    a: "A quotation is an offer sent before work begins, showing the estimated price and terms. An invoice is a bill sent to collect payment for work delivered. This tool makes quotations; you can generate the matching GST invoice with our free invoice generator.",
  },
  {
    q: "Can I turn a quotation into a signed deal?",
    a: "Yes. Create a free DealInSec account to send the quotation, convert it into an e-signable agreement, and raise the GST invoice — all tracked in one place.",
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
      name: "DealInSec Quotation Maker",
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
  <h1>Free Quotation Maker</h1>
  <p class="sub">Create a clean, professional quotation in under a minute — line items, optional GST, standard terms and an instant PDF. No sign-up, no cost.</p>
  <div class="chips">
    <span class="chip">100% free</span>
    <span class="chip">No sign-up</span>
    <span class="chip">Standard T&amp;Cs built in</span>
    <span class="chip">Instant PDF</span>
    <span class="chip">Made for India</span>
  </div>
</div></div>

<section><div class="wrap">
  <div class="grid2">
    <div class="card" id="form-card">
      <h2 style="font-size:18px">Quotation details</h2>

      <label>Your business name</label>
      <input class="f" id="bizName" placeholder="e.g. Sunrise Studios" />
      <div class="row2">
        <div><label>Your GSTIN (optional)</label><input class="f" id="bizGstin" placeholder="e.g. 07AABCU9603R1ZM" /></div>
        <div><label>Quotation number</label><input class="f" id="quoteNo" placeholder="QUO-001" /></div>
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

      <label>Quotation for (client name)</label>
      <input class="f" id="cliName" placeholder="e.g. Nova Coaching Pvt Ltd" />
      <div class="row2">
        <div><label>Quotation date</label><input class="f" id="quoteDate" type="date" /></div>
        <div><label>Valid until</label><input class="f" id="validUntil" type="date" /></div>
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
            <option value="0" selected>No GST (0%)</option>
            <option value="5">5%</option>
            <option value="12">12%</option>
            <option value="18">18%</option>
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

      <label>Terms &amp; conditions</label>
      <div id="terms" style="display:flex;flex-direction:column;gap:8px">
        ${STANDARD_TERMS.map(
          (t) =>
            `<label style="display:flex;gap:8px;align-items:flex-start;font-weight:400;color:var(--ink);font-size:13px;margin:0"><input type="checkbox" class="tcbox" checked style="margin-top:3px" /> <span>${t.label}</span></label>`,
        ).join("")}
      </div>

      <label style="margin-top:12px">Notes (optional)</label>
      <textarea class="f" id="notes" rows="2" placeholder="e.g. Timelines confirmed on advance receipt."></textarea>

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

    <div><div id="invoice-preview" class="card print-doc"></div></div>
  </div>
</div></section>

<section><div class="wrap">
  <h2>How to make a quotation</h2>
  <div class="steps">
    <div class="step"><div class="n">1</div><b>Add details</b><p class="muted">Your business, your client, the quotation number, date and validity.</p></div>
    <div class="step"><div class="n">2</div><b>Add items &amp; terms</b><p class="muted">List the work with rates, add GST if needed, and pick your terms.</p></div>
    <div class="step"><div class="n">3</div><b>Download PDF</b><p class="muted">The quotation updates live. Download and send it to your client.</p></div>
  </div>
</div></section>

<section><div class="wrap faq">
  <h2>Frequently asked questions</h2>
  ${faqHtml()}
</div></section>
`;

const PAGE_JS = `
  var STORE='dis_quote_v1';
  var IT=initItems(function(){ render(); save(); });
  var LOGO=initLogo('logo-input','logo-preview',function(){ render(); save(); });
  var SIG=initSignature('sig-pad',function(){ render(); save(); });
  var EX=initExport(function(){ return $('invoice-preview'); }, function(){ return $('quoteNo').value||'Quotation'; });
  initBranding(function(){ render(); });
  var LASTTOTAL=0;
  function saveData(){ return { type:'quotation', docNumber:$('quoteNo').value, partyName:$('cliName').value, total:LASTTOTAL, payload:collect() }; }

  function collectTerms(){
    var out=[];
    document.querySelectorAll('.tcbox').forEach(function(cb){
      if(cb.checked){ var s=cb.parentNode.querySelector('span'); if(s) out.push(s.textContent); }
    });
    return out;
  }
  function termStates(){ var out=[]; document.querySelectorAll('.tcbox').forEach(function(cb){ out.push(!!cb.checked); }); return out; }

  function collect(){
    return {
      bizName:$('bizName').value, bizGstin:$('bizGstin').value, bizAddr:$('bizAddr').value, quoteNo:$('quoteNo').value,
      cliName:$('cliName').value, cliAddr:$('cliAddr').value, quoteDate:$('quoteDate').value, validUntil:$('validUntil').value,
      gstRate:$('gstRate').value, taxType:$('taxType').value, notes:$('notes').value, terms:termStates(), items:IT.get(),
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
        var cgst=round2(taxTotal/2), sgst=round2(taxTotal-cgst);
        taxRows='<tr><td colspan="3" style="padding:5px 8px;text-align:right;color:#64748B">CGST ('+(rate/2)+'%)</td><td style="padding:5px 8px;text-align:right">'+money(cgst)+'</td></tr>'+
          '<tr><td colspan="3" style="padding:5px 8px;text-align:right;color:#64748B">SGST ('+(rate/2)+'%)</td><td style="padding:5px 8px;text-align:right">'+money(sgst)+'</td></tr>';
      }
    }
    var terms=collectTerms();
    var termsHtml = terms.length ? '<div style="margin-top:14px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#94A3B8;margin-bottom:4px">Terms &amp; conditions</div><ol style="margin:0;padding-left:18px;font-size:12px;color:#475569">'+terms.map(function(t){return '<li style="margin-bottom:3px">'+esc(t)+'</li>';}).join('')+'</ol></div>' : '';
    var bn=$('bizName').value||'Your Business';
    var html=''+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">'+
        '<div>'+(LOGO.get()?'<img src="'+LOGO.get()+'" alt="" style="max-height:50px;max-width:180px;object-fit:contain;margin-bottom:8px;display:block" />':'')+'<div style="font-size:20px;font-weight:800;color:#0F172A">'+esc(bn)+'</div>'+
          ($('bizGstin').value?'<div style="font-size:12px;color:#64748B">GSTIN: '+esc($('bizGstin').value)+'</div>':'')+
          '<div style="font-size:12px;color:#64748B;white-space:pre-line">'+esc($('bizAddr').value)+'</div></div>'+
        '<div style="text-align:right"><div style="font-size:22px;font-weight:800;letter-spacing:.04em;color:#0E8C5A">QUOTATION</div>'+
          ($('quoteNo').value?'<div style="font-size:13px;color:#0F172A"># '+esc($('quoteNo').value)+'</div>':'')+
          ($('quoteDate').value?'<div style="font-size:12px;color:#64748B">Date: '+fmtDate($('quoteDate').value)+'</div>':'')+
          ($('validUntil').value?'<div style="font-size:12px;color:#64748B">Valid until: '+fmtDate($('validUntil').value)+'</div>':'')+'</div>'+
      '</div>'+
      '<div style="margin:16px 0 10px;padding:10px 12px;background:#F8FAFC;border-radius:10px">'+
        '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#94A3B8">Quotation for</div>'+
        '<div style="font-weight:700;color:#0F172A">'+esc($('cliName').value||'Client name')+'</div>'+
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
      termsHtml+
      ($('notes').value?'<div style="margin-top:12px;padding-top:10px;border-top:1px dashed #E2E8F0;font-size:12px;color:#475569;white-space:pre-line"><b>Notes:</b> '+esc($('notes').value)+'</div>':'')+
      (SIG.get()?'<div style="margin-top:26px;display:flex;justify-content:flex-end"><div style="text-align:center;min-width:180px"><img src="'+SIG.get()+'" alt="signature" style="max-height:58px;max-width:190px;object-fit:contain" /><div style="border-top:1px solid #94A3B8;margin-top:2px;padding-top:4px;font-size:12px;font-weight:600;color:#0F172A">'+esc($('sigName').value||bn)+'</div><div style="font-size:10px;color:#94A3B8">Authorised Signatory</div></div></div>':'')+
      brandFooter();
    $('invoice-preview').innerHTML=html;
  }

  ['bizName','bizGstin','bizAddr','quoteNo','cliName','cliAddr','quoteDate','validUntil','gstRate','taxType','notes','sigName'].forEach(function(id){
    $(id).addEventListener('input',function(){ render(); save(); });
  });
  document.querySelectorAll('.tcbox').forEach(function(cb){ cb.addEventListener('change',function(){ render(); save(); }); });
  $('sig-upload').addEventListener('change',function(e){ SIG.upload(e.target.files && e.target.files[0]); e.target.value=''; });
  $('sig-clear').addEventListener('click',function(){ SIG.clear(); });
  $('reset').addEventListener('click',function(){
    try{localStorage.removeItem(STORE);}catch(e){}
    ['bizName','bizGstin','bizAddr','quoteNo','cliName','cliAddr','quoteDate','validUntil','notes','sigName'].forEach(function(id){$(id).value='';});
    $('gstRate').value='0'; $('taxType').value='cgst_sgst';
    document.querySelectorAll('.tcbox').forEach(function(cb){ cb.checked=true; });
    LOGO.clear(); SIG.clear();
    IT.set([]); IT.render(); render(); save();
  });
  $('download').addEventListener('click',function(){ document.title=($('quoteNo').value||'Quotation'); EX.open(); });

  var saved=null; try{ saved=JSON.parse(localStorage.getItem(STORE)||'null'); }catch(e){}
  if(saved){
    ['bizName','bizGstin','bizAddr','quoteNo','cliName','cliAddr','quoteDate','validUntil','gstRate','taxType','notes','sigName'].forEach(function(id){ if(saved[id]!=null)$(id).value=saved[id]; });
    if(saved.terms){ var boxes=document.querySelectorAll('.tcbox'); saved.terms.forEach(function(v,i){ if(boxes[i])boxes[i].checked=!!v; }); }
    if(saved.logo)LOGO.set(saved.logo);
    if(saved.sig)SIG.set(saved.sig);
    IT.set(saved.items);
  }else{
    IT.set([{desc:'',qty:1,rate:0}]);
  }
  IT.render(); render();
`;

export function quotationMakerPage(): string {
  return renderToolPage({
    title: TITLE,
    description: DESC,
    canonicalPath: PATH,
    jsonLd: jsonLd(),
    bodyHtml: BODY,
    bodyEndScripts: "<script>(function(){" + COMMON_JS + MEDIA_JS + EXPORT_JS + ITEMS_JS + PAGE_JS + "})();</script>",
  });
}

export const quotationMakerMeta = {
  slug: "quotation-maker",
  path: PATH,
  title: "Free Quotation Maker",
  blurb: "Build a professional quotation with line items, GST and standard terms, then download it as a PDF — free, no sign-up.",
};
