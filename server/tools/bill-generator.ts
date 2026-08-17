/**
 * Free Bill Generator / Online Bill Maker — a lead-magnet SEO page.
 *
 * The keyword rationale (competitor page data, Aug 2026): India searches
 * "bill", not "invoice" — "generate invoice" 60.5K/mo, "online bill generate"
 * 14.8K/mo, "bill create online" 14.8K/mo, "handwritten bill" 9.9K/mo at
 * SD 22. Our tools spoke only "invoice"; this page owns the "bill"
 * vocabulary: bill generator, online bill maker, create bill online, cash
 * bill, handwritten-vs-computer bill.
 *
 * Deliberately simpler than the GST invoice tool: a shop/service bill with
 * items, optional GST, amount in words and a PAID/DUE stamp. GST-heavy needs
 * funnel to the invoice generator; deal-shaped needs funnel to the app.
 */
import { renderToolPage, SITE_ORIGIN } from "./layout";
import { COMMON_JS, ITEMS_JS, MEDIA_JS, EXPORT_JS } from "./client-lib";

const PATH = "/tools/bill-generator";
const TITLE = "Free Bill Generator — Create a Bill Online (India) | DealInSec";
const DESC =
  "Create a bill online free: item-wise bill with total, amount in words, optional GST, logo, signature and a PAID stamp — instant PDF, no sign-up. The online bill maker for Indian shops and service businesses.";

const FAQ: { q: string; a: string }[] = [
  {
    q: "Is this bill generator free?",
    a: "Yes. Create and download unlimited bills as PDF or PNG for free, with no sign-up. Everything runs in your browser — what you type never leaves your device.",
  },
  {
    q: "How do I create a bill online?",
    a: "Enter your business name, add a bill number and date, list the items with quantity and rate, choose GST if it applies, and download the finished bill. The preview updates live and the whole thing takes about a minute.",
  },
  {
    q: "What is the difference between a bill and an invoice?",
    a: "In everyday Indian usage they're the same document — a request for payment listing what was sold and for how much. 'Bill' is the common word in shops and local services; 'invoice' is the formal word in business paperwork and GST law. If you need a GST tax invoice with CGST/SGST/IGST computed and your GSTIN shown, use our free GST invoice generator.",
  },
  {
    q: "Is a handwritten bill valid? Should I switch to computer bills?",
    a: "Handwritten bills from a bill book are perfectly legal and millions of Indian businesses use them daily. The case for a computer-made bill is practical, not legal: totals are calculated for you, the bill is legible, it looks professional on WhatsApp, and you always have a copy. This tool gives you that without buying software.",
  },
  {
    q: "Can I mark a bill as paid?",
    a: "Yes — set the payment status and the bill prints a PAID stamp (or DUE if payment is pending). Useful for cash bills and counter sales where the customer pays on the spot.",
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
      name: "DealInSec Bill Generator",
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
  <h1>Free Online Bill Maker</h1>
  <p class="sub">Create a bill online in under a minute — items, total, amount in words, optional GST and a PAID stamp. No sign-up, no cost.</p>
  <div class="chips">
    <span class="chip">100% free</span>
    <span class="chip">No sign-up</span>
    <span class="chip">PAID / DUE stamp</span>
    <span class="chip">Instant PDF</span>
    <span class="chip">Made for India</span>
  </div>
</div></div>

<section><div class="wrap">
  <div class="grid2">
    <div class="card" id="form-card">
      <h2 style="font-size:18px">Bill details</h2>

      <label>Your business / shop name</label>
      <input class="f" id="bizName" placeholder="e.g. Sharma Electricals" />
      <div class="row2">
        <div><label>Phone (optional)</label><input class="f" id="bizPhone" placeholder="e.g. 98300 12345" /></div>
        <div><label>Bill number</label><input class="f" id="billNo" placeholder="BILL-001" /></div>
      </div>
      <label>Address (optional)</label>
      <textarea class="f" id="bizAddr" rows="2" placeholder="Street, City, State, PIN"></textarea>

      <label>Business logo (optional)</label>
      <div class="logo-preview" id="logo-preview" style="display:none"></div>
      <div class="sig-actions">
        <label class="file-btn">Upload logo<input type="file" id="logo-input" accept="image/*" /></label>
        <button type="button" class="file-btn" id="logo-input-clear">Remove</button>
      </div>

      <hr style="border:none;border-top:1px solid var(--line);margin:18px 0" />

      <div class="row2">
        <div><label>Bill date</label><input class="f" id="billDate" type="date" /></div>
        <div><label>Customer name (optional)</label><input class="f" id="cliName" placeholder="e.g. Rahul Verma" /></div>
      </div>

      <label>Items</label>
      <div id="items"></div>
      <button class="btn ghost" id="addItem" type="button" style="margin-top:10px">+ Add item</button>

      <div class="row2" style="margin-top:16px">
        <div>
          <label>GST rate</label>
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

      <div class="row2" style="margin-top:4px">
        <div>
          <label>Payment status</label>
          <select class="f" id="payStatus">
            <option value="" selected>Not shown</option>
            <option value="PAID">PAID</option>
            <option value="DUE">DUE</option>
          </select>
        </div>
        <div><label>Notes (optional)</label><input class="f" id="notes" placeholder="e.g. Thank you! Visit again." /></div>
      </div>

      <label>Signature (optional) — draw below or upload an image</label>
      <canvas id="sig-pad" class="sig-pad"></canvas>
      <div class="sig-actions">
        <button type="button" class="file-btn" id="sig-clear">Clear</button>
        <label class="file-btn">Upload image<input type="file" id="sig-upload" accept="image/*" /></label>
      </div>

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
  <h2>How to create a bill online</h2>
  <div class="steps">
    <div class="step"><div class="n">1</div><b>Add your details</b><p class="muted">Business name, bill number, date — and the customer's name if you want it on the bill.</p></div>
    <div class="step"><div class="n">2</div><b>List the items</b><p class="muted">Description, quantity and rate — the total and amount in words are calculated for you.</p></div>
    <div class="step"><div class="n">3</div><b>Download &amp; share</b><p class="muted">Save the bill as a PDF or PNG, print it, or share it straight to WhatsApp.</p></div>
  </div>
</div></section>

<section><div class="wrap">
  <h2>Handwritten bill vs computer-made bill</h2>
  <p class="muted" style="max-width:720px">The bill book is not broken — handwritten bills are legal and half of India runs on them. But a computer-made bill fixes the four things that go wrong with handwriting:</p>
  <ul style="max-width:720px;color:var(--ink)">
    <li><b>The math is done for you</b> — no totalling mistakes at a busy counter, and the amount in words is generated automatically.</li>
    <li><b>Everyone can read it</b> — customers, your accountant, and you, three months later.</li>
    <li><b>It shares cleanly</b> — a crisp PDF or image on WhatsApp instead of a photo of a carbon copy.</li>
    <li><b>You always have a copy</b> — the bill book's carbon page fades; a file doesn't.</li>
  </ul>
  <p class="muted" style="max-width:720px">This tool is the middle path: computer bills with zero software to buy or learn.</p>
</div></section>

<section><div class="wrap">
  <h2>Need a GST invoice instead?</h2>
  <p class="muted" style="max-width:720px">A simple bill is fine for counter sales and everyday services. If you're GST-registered and the buyer needs to claim input credit, issue a proper tax invoice with CGST/SGST/IGST computed and your GSTIN shown — our <a href="/tools/gst-invoice-generator">free GST invoice generator</a> does that, also without a sign-up. And when your work is deal-shaped (quotation first, then an agreement, then bills), that's what <a href="/">DealInSec</a> itself is for.</p>
</div></section>

<section><div class="wrap faq">
  <h2>Frequently asked questions</h2>
  ${faqHtml()}
</div></section>
`;

const PAGE_JS = `
  var STORE='dis_bill_v1';
  var IT=initItems(function(){ render(); save(); });
  var LOGO=initLogo('logo-input','logo-preview',function(){ render(); save(); });
  var SIG=initSignature('sig-pad',function(){ render(); save(); });
  var EX=initExport(function(){ return $('invoice-preview'); }, function(){ return $('billNo').value||'Bill'; });
  initBranding(function(){ render(); });
  var LASTTOTAL=0;
  function saveData(){ return { type:'bill', docNumber:$('billNo').value, partyName:$('cliName').value, total:LASTTOTAL, payload:collect() }; }

  function collect(){
    return {
      bizName:$('bizName').value, bizPhone:$('bizPhone').value, bizAddr:$('bizAddr').value,
      billNo:$('billNo').value, billDate:$('billDate').value, cliName:$('cliName').value,
      gstRate:$('gstRate').value, taxType:$('taxType').value, payStatus:$('payStatus').value,
      notes:$('notes').value, items:IT.get(), logo:LOGO.get(), sig:SIG.get()
    };
  }
  function save(){ try{ localStorage.setItem(STORE, JSON.stringify(collect())); }catch(e){} }

  function render(){
    var subtotal=0;
    var rows=IT.get().map(function(it,i){
      var amt=round2(num(it.qty)*num(it.rate)); subtotal+=amt;
      return '<tr><td style="padding:7px 8px;border-bottom:1px solid #EEF2F6"><span style="color:#94A3B8;margin-right:6px">'+(i+1)+'.</span>'+esc(it.desc||'-')+'</td>'+
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
    var st=$('payStatus').value;
    var stamp = st==='PAID'
      ? '<span style="display:inline-block;border:2.5px solid #0E8C5A;color:#0E8C5A;font-weight:800;letter-spacing:.12em;padding:3px 12px;border-radius:8px;transform:rotate(-6deg);font-size:14px">PAID</span>'
      : st==='DUE'
      ? '<span style="display:inline-block;border:2.5px solid #D97706;color:#D97706;font-weight:800;letter-spacing:.12em;padding:3px 12px;border-radius:8px;transform:rotate(-6deg);font-size:14px">DUE</span>'
      : '';
    var bn=$('bizName').value||'Your Business';
    var html=''+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">'+
        '<div>'+(LOGO.get()?'<img src="'+LOGO.get()+'" alt="" style="max-height:50px;max-width:180px;object-fit:contain;margin-bottom:8px;display:block" />':'')+'<div style="font-size:20px;font-weight:800;color:#0F172A">'+esc(bn)+'</div>'+
          ($('bizPhone').value?'<div style="font-size:12px;color:#64748B">Ph: '+esc($('bizPhone').value)+'</div>':'')+
          '<div style="font-size:12px;color:#64748B;white-space:pre-line">'+esc($('bizAddr').value)+'</div></div>'+
        '<div style="text-align:right"><div style="font-size:22px;font-weight:800;letter-spacing:.04em;color:#0E8C5A">BILL</div>'+
          ($('billNo').value?'<div style="font-size:13px;color:#0F172A"># '+esc($('billNo').value)+'</div>':'')+
          ($('billDate').value?'<div style="font-size:12px;color:#64748B">Date: '+fmtDate($('billDate').value)+'</div>':'')+
          (stamp?'<div style="margin-top:8px">'+stamp+'</div>':'')+'</div>'+
      '</div>'+
      ($('cliName').value?'<div style="margin:16px 0 10px;padding:10px 12px;background:#F8FAFC;border-radius:10px">'+
        '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#94A3B8">Bill to</div>'+
        '<div style="font-weight:700;color:#0F172A">'+esc($('cliName').value)+'</div>'+
      '</div>':'<div style="margin-top:10px"></div>')+
      '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:6px">'+
        '<thead><tr style="background:#0E8C5A;color:#fff">'+
          '<th style="padding:8px;text-align:left;border-radius:8px 0 0 0">Item</th>'+
          '<th style="padding:8px;text-align:right">Qty</th>'+
          '<th style="padding:8px;text-align:right">Rate</th>'+
          '<th style="padding:8px;text-align:right;border-radius:0 8px 0 0">Amount</th>'+
        '</tr></thead><tbody>'+(rows||'<tr><td colspan="4" style="padding:14px;text-align:center;color:#94A3B8">Add an item to begin</td></tr>')+'</tbody>'+
        '<tfoot>'+
          (rate>0?'<tr><td colspan="3" style="padding:8px;text-align:right;color:#64748B">Subtotal</td><td style="padding:8px;text-align:right">'+money(subtotal)+'</td></tr>':'')+
          taxRows+
          '<tr><td colspan="3" style="padding:10px 8px;text-align:right;font-weight:800;font-size:15px">Total</td><td style="padding:10px 8px;text-align:right;font-weight:800;font-size:15px;color:#0E8C5A">'+money(total)+'</td></tr>'+
        '</tfoot>'+
      '</table>'+
      '<div style="margin-top:10px;font-size:12px;color:#475569"><b>Amount in words:</b> '+esc(words(total))+'</div>'+
      ($('notes').value?'<div style="margin-top:12px;padding-top:10px;border-top:1px dashed #E2E8F0;font-size:12px;color:#475569;white-space:pre-line">'+esc($('notes').value)+'</div>':'')+
      (SIG.get()?'<div style="margin-top:26px;display:flex;justify-content:flex-end"><div style="text-align:center;min-width:180px"><img src="'+SIG.get()+'" alt="signature" style="max-height:58px;max-width:190px;object-fit:contain" /><div style="border-top:1px solid #94A3B8;margin-top:2px;padding-top:4px;font-size:12px;font-weight:600;color:#0F172A">'+esc(bn)+'</div><div style="font-size:10px;color:#94A3B8">Authorised Signatory</div></div></div>':'')+
      brandFooter();
    $('invoice-preview').innerHTML=html;
  }

  ['bizName','bizPhone','bizAddr','billNo','billDate','cliName','gstRate','taxType','payStatus','notes'].forEach(function(id){
    $(id).addEventListener('input',function(){ render(); save(); });
  });
  $('sig-upload').addEventListener('change',function(e){ SIG.upload(e.target.files && e.target.files[0]); e.target.value=''; });
  $('sig-clear').addEventListener('click',function(){ SIG.clear(); });
  $('reset').addEventListener('click',function(){
    try{localStorage.removeItem(STORE);}catch(e){}
    ['bizName','bizPhone','bizAddr','billNo','billDate','cliName','notes'].forEach(function(id){$(id).value='';});
    $('gstRate').value='0'; $('taxType').value='cgst_sgst'; $('payStatus').value='';
    LOGO.clear(); SIG.clear();
    IT.set([]); IT.render(); render(); save();
  });
  $('download').addEventListener('click',function(){ document.title=($('billNo').value||'Bill'); EX.open(); });

  var saved=null; try{ saved=JSON.parse(localStorage.getItem(STORE)||'null'); }catch(e){}
  if(saved){
    ['bizName','bizPhone','bizAddr','billNo','billDate','cliName','gstRate','taxType','payStatus','notes'].forEach(function(id){ if(saved[id]!=null)$(id).value=saved[id]; });
    if(saved.logo)LOGO.set(saved.logo);
    if(saved.sig)SIG.set(saved.sig);
    IT.set(saved.items);
  }else{
    IT.set([{desc:'',qty:1,rate:0}]);
  }
  IT.render(); render();
`;

export function billGeneratorPage(): string {
  return renderToolPage({
    title: TITLE,
    description: DESC,
    canonicalPath: PATH,
    jsonLd: jsonLd(),
    bodyHtml: BODY,
    bodyEndScripts: "<script>(function(){" + COMMON_JS + MEDIA_JS + EXPORT_JS + ITEMS_JS + PAGE_JS + "})();</script>",
  });
}

export const billGeneratorMeta = {
  slug: "bill-generator",
  path: PATH,
  title: "Free Bill Generator",
  blurb: "Create a bill online in a minute — items, total, amount in words, optional GST and a PAID stamp. Free, no sign-up.",
};
