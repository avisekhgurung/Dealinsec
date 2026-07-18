/**
 * Free Service Agreement / Contract Template generator.
 *
 * The strategic lead magnet: incumbents give away invoicing but NOT e-signable
 * contracts. This page generates a professional service agreement in-browser
 * (fillable fields -> formatted, printable document) and funnels into DealInSec's
 * paid e-sign flow: "sign up free to e-sign and get counter-signed proof".
 */
import { renderToolPage, SITE_ORIGIN } from "./layout";
import { COMMON_JS, MEDIA_JS } from "./client-lib";

const PATH = "/tools/service-agreement-template";
const TITLE = "Free Service Agreement Template (India) — Download PDF | DealInSec";
const DESC =
  "Create a free service agreement between a service provider and client — scope, deliverables, fees, revisions, cancellation and signatures. Download as PDF, no sign-up.";

const FAQ: { q: string; a: string }[] = [
  {
    q: "Is this service agreement template free?",
    a: "Yes. Fill in the details and download a professional service agreement as a PDF for free, with no sign-up. It is generated entirely in your browser.",
  },
  {
    q: "What should a service agreement include?",
    a: "A solid service agreement names both parties, describes the scope of services and deliverables, sets the timeline, states the fee and payment schedule (such as an advance and balance), covers revisions, cancellation, confidentiality, and governing law, and provides signature blocks for both parties.",
  },
  {
    q: "Is this a legally binding contract?",
    a: "This template gives you a clear, professionally structured starting point. Whether an agreement is enforceable depends on the specific terms and how it is signed. For high-value or complex work, have a lawyer review it. This tool does not provide legal advice.",
  },
  {
    q: "How do I get it signed?",
    a: "You can print and sign it, or create a free DealInSec account to e-sign the agreement, collect the client's counter-signature, and keep signed proof attached to the deal.",
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
      name: "DealInSec Service Agreement Generator",
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
  <h1>Free Service Agreement Template</h1>
  <p class="sub">Generate a clear, professional contract between you and your client — scope, deliverables, fees, revisions, cancellation and signatures. Fill it in and download a PDF, free.</p>
  <div class="chips">
    <span class="chip">100% free</span>
    <span class="chip">No sign-up</span>
    <span class="chip">Ready-to-sign</span>
    <span class="chip">Instant PDF</span>
    <span class="chip">Made for India</span>
  </div>
</div></div>

<section><div class="wrap">
  <div class="grid2">
    <div class="card" id="form-card">
      <h2 style="font-size:18px">Agreement details</h2>

      <div class="row2">
        <div><label>Service provider (you)</label><input class="f" id="spName" placeholder="Your name / business" /></div>
        <div><label>Client</label><input class="f" id="clName" placeholder="Client name / business" /></div>
      </div>
      <div class="row2">
        <div><label>Your address</label><textarea class="f" id="spAddr" rows="2" placeholder="City, State"></textarea></div>
        <div><label>Client address</label><textarea class="f" id="clAddr" rows="2" placeholder="City, State"></textarea></div>
      </div>
      <label>Effective date</label>
      <input class="f" id="effDate" type="date" />

      <hr style="border:none;border-top:1px solid var(--line);margin:18px 0" />

      <label>Scope of services</label>
      <textarea class="f" id="scope" rows="3" placeholder="Describe the work you will provide."></textarea>
      <label>Deliverables (one per line)</label>
      <textarea class="f" id="deliverables" rows="3" placeholder="e.g.\n4 Instagram reels\n2 rounds of edits"></textarea>

      <div class="row2">
        <div><label>Start date</label><input class="f" id="startDate" type="date" /></div>
        <div><label>End date</label><input class="f" id="endDate" type="date" /></div>
      </div>

      <hr style="border:none;border-top:1px solid var(--line);margin:18px 0" />

      <div class="row2">
        <div><label>Total fee (₹)</label><input class="f" id="fee" type="number" min="0" placeholder="50000" /></div>
        <div><label>Advance %</label><input class="f" id="advancePct" type="number" min="0" max="100" placeholder="50" /></div>
      </div>
      <div class="row2">
        <div><label>Revisions included</label><input class="f" id="revisions" type="number" min="0" placeholder="2" /></div>
        <div><label>Governing law (state)</label><input class="f" id="govState" placeholder="e.g. West Bengal" /></div>
      </div>
      <label style="display:flex;gap:8px;align-items:center;font-weight:400;margin-top:12px"><input type="checkbox" id="exclusive" /> <span>Exclusive engagement (client won't hire others for the same scope during the term)</span></label>

      <label style="margin-top:12px">Extra clauses / notes (optional)</label>
      <textarea class="f" id="notes" rows="2" placeholder="Anything else to add."></textarea>

      <hr style="border:none;border-top:1px solid var(--line);margin:18px 0" />

      <label>Business logo (optional)</label>
      <div class="logo-preview" id="logo-preview" style="display:none"></div>
      <div class="sig-actions">
        <label class="file-btn">Upload logo<input type="file" id="logo-input" accept="image/*" /></label>
        <button type="button" class="file-btn" id="logo-input-clear">Remove</button>
      </div>

      <label style="margin-top:14px">Your signature (optional) — draw below or upload an image</label>
      <canvas id="sig-pad" class="sig-pad"></canvas>
      <div class="sig-actions">
        <button type="button" class="file-btn" id="sig-clear">Clear</button>
        <label class="file-btn">Upload image<input type="file" id="sig-upload" accept="image/*" /></label>
      </div>

      <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap">
        <button class="btn" id="download" type="button">⬇ Download PDF</button>
        <button class="btn ghost" id="reset" type="button">Reset</button>
      </div>
      <p class="muted" style="font-size:13px;margin-top:10px">This template is a starting point, not legal advice. In the print dialog choose <b>Save as PDF</b>.</p>
    </div>

    <div><div id="doc-preview" class="card print-doc"></div></div>
  </div>
</div></section>

<section><div class="wrap">
  <h2>How to create a service agreement</h2>
  <div class="steps">
    <div class="step"><div class="n">1</div><b>Name the parties</b><p class="muted">Add you, your client, and the effective date.</p></div>
    <div class="step"><div class="n">2</div><b>Define the work</b><p class="muted">Scope, deliverables, timeline, fee and payment split.</p></div>
    <div class="step"><div class="n">3</div><b>Download &amp; sign</b><p class="muted">Download the PDF, then print-and-sign or e-sign inside DealInSec.</p></div>
  </div>
</div></section>

<section><div class="wrap faq">
  <h2>Frequently asked questions</h2>
  ${faqHtml()}
</div></section>
`;

const PAGE_JS = `
  var STORE='dis_agreement_v1';
  var LOGO=initLogo('logo-input','logo-preview',function(){ render(); save(); });
  var SIG=initSignature('sig-pad',function(){ render(); save(); });

  function collect(){
    return {
      spName:$('spName').value, spAddr:$('spAddr').value, clName:$('clName').value, clAddr:$('clAddr').value,
      effDate:$('effDate').value, scope:$('scope').value, deliverables:$('deliverables').value,
      startDate:$('startDate').value, endDate:$('endDate').value, fee:$('fee').value, advancePct:$('advancePct').value,
      revisions:$('revisions').value, govState:$('govState').value, exclusive:$('exclusive').checked, notes:$('notes').value,
      logo:LOGO.get(), sig:SIG.get()
    };
  }
  function save(){ try{ localStorage.setItem(STORE, JSON.stringify(collect())); }catch(e){} }

  function para(t){ return '<p style="margin:8px 0;font-size:12.5px;color:#334155;line-height:1.6">'+t+'</p>'; }
  function clause(n,title,inner){ return '<div style="margin-top:12px"><div style="font-weight:700;font-size:13px;color:#0F172A">'+n+'. '+esc(title)+'</div>'+inner+'</div>'; }

  function render(){
    var sp=$('spName').value||'the Service Provider';
    var cl=$('clName').value||'the Client';
    var fee=round2(num($('fee').value));
    var pct=Math.max(0,Math.min(100,num($('advancePct').value)));
    var adv=round2(fee*pct/100);
    var bal=round2(fee-adv);
    var rev=$('revisions').value!==''?Math.floor(num($('revisions').value)):2;
    var gov=$('govState').value||'India';

    var delivs=$('deliverables').value.split('\\n').map(function(s){return s.trim();}).filter(function(s){return s;});
    var delivHtml = delivs.length
      ? '<ul style="margin:4px 0;padding-left:18px;font-size:12.5px;color:#334155">'+delivs.map(function(d){return '<li style="margin-bottom:2px">'+esc(d)+'</li>';}).join('')+'</ul>'
      : para('As described in the scope of services above.');

    var n=0;
    var body='';
    body+=clause(++n,'Parties', para('This Service Agreement is made between <b>'+esc(sp)+'</b>'+($('spAddr').value?' ('+esc($('spAddr').value.replace(/\\n/g,', '))+')':'')+' ("Service Provider") and <b>'+esc(cl)+'</b>'+($('clAddr').value?' ('+esc($('clAddr').value.replace(/\\n/g,', '))+')':'')+' ("Client")'+($('effDate').value?', effective '+fmtDate($('effDate').value):'')+'.'));
    body+=clause(++n,'Scope of Services', para($('scope').value?esc($('scope').value):'The Service Provider will provide the services agreed between the parties.'));
    body+=clause(++n,'Deliverables', delivHtml);
    body+=clause(++n,'Term', para('This Agreement '+($('startDate').value?'begins on '+fmtDate($('startDate').value):'begins on the effective date')+($('endDate').value?' and continues until '+fmtDate($('endDate').value):' and continues until the services are completed')+', unless ended earlier under the cancellation terms below.'));
    body+=clause(++n,'Fees & Payment', para('The total fee for the services is <b>'+money(fee)+'</b> ('+esc(words(fee))+').'+(pct>0?' An advance of '+money(adv)+' ('+pct+'%) is payable to confirm the engagement, and the balance of '+money(bal)+' is payable on completion / final delivery.':' Payment is due as agreed between the parties.')));
    body+=clause(++n,'Revisions', para('Up to '+rev+' round(s) of revisions are included. All change requests should be submitted together. Additional revisions may be charged separately.'));
    if($('exclusive').checked){ body+=clause(++n,'Exclusivity', para('During the term, the Client will not engage another provider for the same scope of services without the Service Provider\\'s written consent.')); }
    body+=clause(++n,'Cancellation', para('If the Client cancels after work has started, any advance paid is non-refundable. If work has already been delivered, the corresponding fee remains payable.'));
    body+=clause(++n,'Confidentiality', para('Each party will keep the other party\\'s non-public information confidential and use it only to perform this Agreement.'));
    body+=clause(++n,'Governing Law', para('This Agreement is governed by the laws of '+esc(gov)+', India, and the courts there will have jurisdiction.'));
    if($('notes').value){ body+=clause(++n,'Additional Terms', '<div style="font-size:12.5px;color:#334155;white-space:pre-line">'+esc($('notes').value)+'</div>'); }

    var spSignInk = SIG.get() ? '<img src="'+SIG.get()+'" alt="signature" style="max-height:42px;max-width:170px;object-fit:contain" />' : '';
    var sign='<div style="margin-top:22px;display:flex;gap:24px">'+
      '<div style="flex:1"><div style="min-height:36px;border-bottom:1px solid #94A3B8;display:flex;align-items:flex-end">'+spSignInk+'</div><div style="font-size:11px;color:#64748B;margin-top:4px">Service Provider</div><div style="font-size:12px;font-weight:600;color:#0F172A">'+esc(sp)+'</div><div style="font-size:11px;color:#94A3B8">Signature / Date</div></div>'+
      '<div style="flex:1"><div style="min-height:36px;border-bottom:1px solid #94A3B8"></div><div style="font-size:11px;color:#64748B;margin-top:4px">Client</div><div style="font-size:12px;font-weight:600;color:#0F172A">'+esc(cl)+'</div><div style="font-size:11px;color:#94A3B8">Signature / Date</div></div>'+
    '</div>';

    var html=''+
      '<div style="text-align:center;border-bottom:2px solid #0E8C5A;padding-bottom:8px;margin-bottom:6px">'+(LOGO.get()?'<img src="'+LOGO.get()+'" alt="" style="max-height:46px;max-width:180px;object-fit:contain;margin:0 auto 6px;display:block" />':'')+'<div style="font-size:19px;font-weight:800;letter-spacing:.03em;color:#0F172A">SERVICE AGREEMENT</div></div>'+
      body+sign+
      '<div style="margin-top:16px;padding-top:8px;border-top:1px solid #EEF2F6;text-align:center;font-size:11px;color:#94A3B8">Made with DealInSec &middot; dealinsec.com</div>';
    $('doc-preview').innerHTML=html;
  }

  ['spName','spAddr','clName','clAddr','effDate','scope','deliverables','startDate','endDate','fee','advancePct','revisions','govState','notes'].forEach(function(id){
    $(id).addEventListener('input',function(){ render(); save(); });
  });
  $('exclusive').addEventListener('change',function(){ render(); save(); });
  $('sig-upload').addEventListener('change',function(e){ SIG.upload(e.target.files && e.target.files[0]); e.target.value=''; });
  $('sig-clear').addEventListener('click',function(){ SIG.clear(); });
  $('reset').addEventListener('click',function(){
    try{localStorage.removeItem(STORE);}catch(e){}
    ['spName','spAddr','clName','clAddr','effDate','scope','deliverables','startDate','endDate','fee','advancePct','revisions','govState','notes'].forEach(function(id){$(id).value='';});
    $('exclusive').checked=false; LOGO.clear(); SIG.clear(); render(); save();
  });
  $('download').addEventListener('click',function(){ document.title=('Service Agreement'+($('clName').value?' - '+$('clName').value:'')); window.print(); });

  var saved=null; try{ saved=JSON.parse(localStorage.getItem(STORE)||'null'); }catch(e){}
  if(saved){
    ['spName','spAddr','clName','clAddr','effDate','scope','deliverables','startDate','endDate','fee','advancePct','revisions','govState','notes'].forEach(function(id){ if(saved[id]!=null)$(id).value=saved[id]; });
    if(saved.exclusive)$('exclusive').checked=true;
    if(saved.logo)LOGO.set(saved.logo);
    if(saved.sig)SIG.set(saved.sig);
  }
  render();
`;

export function serviceAgreementPage(): string {
  return renderToolPage({
    title: TITLE,
    description: DESC,
    canonicalPath: PATH,
    jsonLd: jsonLd(),
    bodyHtml: BODY,
    bodyEndScripts: "<script>(function(){" + COMMON_JS + MEDIA_JS + PAGE_JS + "})();</script>",
  });
}

export const serviceAgreementMeta = {
  slug: "service-agreement-template",
  path: PATH,
  title: "Free Service Agreement Template",
  blurb: "Generate a professional service contract — scope, fees, revisions, cancellation and signatures — and download it as a PDF, free.",
};
