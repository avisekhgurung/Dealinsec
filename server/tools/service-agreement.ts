/**
 * Free Service Agreement / Contract Template generator.
 *
 * The strategic lead magnet: incumbents give away invoicing but NOT e-signable
 * contracts. This page generates a professional service agreement in-browser
 * (fillable fields -> formatted, printable document) and funnels into DealInSec's
 * paid e-sign flow: "sign up free to e-sign and get counter-signed proof".
 */
import { renderToolPage, SITE_ORIGIN } from "./layout";
import { COMMON_JS, MEDIA_JS, EXPORT_JS } from "./client-lib";

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

      <hr style="border:none;border-top:1px solid var(--line);margin:18px 0" />

      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <label style="margin:0">Terms &amp; clauses</label>
        <button type="button" class="btn ghost" id="add-clause" style="padding:9px 15px;min-height:auto;width:auto;flex-shrink:0">+ Add clause</button>
      </div>
      <p class="muted" style="font-size:12.5px;margin:6px 0 4px">Full control — edit, reorder or delete any clause, or add your own. Keep only the terms you want (or none).</p>
      <div id="clause-list"></div>

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
        <button class="btn" id="download" type="button">⬇ Download / Share</button>
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

<div id="clause-dialog" class="dlg-overlay no-print" role="dialog" aria-modal="true" aria-hidden="true"><div class="dlg-sheet"><div id="dlg-content"></div></div></div>
`;

const STYLE = `<style>
  /* Editable clause list */
  .cl-card{display:flex;gap:10px;align-items:flex-start;padding:11px 12px;border:1px solid var(--glass-line);border-radius:13px;background:rgba(255,255,255,.6);-webkit-backdrop-filter:var(--blur-lite);backdrop-filter:var(--blur-lite);margin-top:8px}
  .cl-main{flex:1;min-width:0}
  .cl-title{font-weight:700;font-size:13.5px;color:var(--ink)}
  .cl-snip{font-size:12px;color:var(--muted);margin-top:2px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .cl-btns{display:flex;gap:4px;flex-shrink:0}
  .cl-ico{width:30px;height:30px;border-radius:9px;border:1px solid var(--line);background:#fff;display:grid;place-items:center;cursor:pointer;color:var(--muted);transition:color .15s,border-color .15s}
  .cl-ico:hover{color:var(--green-d);border-color:var(--green)}
  .cl-ico:disabled{opacity:.35;cursor:not-allowed}
  .cl-ico.cl-del:hover{color:#DC2626;border-color:#DC2626}
  .cl-empty{font-size:12.5px;color:var(--muted);text-align:center;padding:16px 14px;border:1px dashed var(--line);border-radius:13px;margin-top:8px;background:rgba(255,255,255,.4)}
  .cl-danger{background:#DC2626!important;background-image:none!important}
  .cl-danger:hover{filter:brightness(1.06);background:#DC2626!important}

  /* Clause editor dialog */
  .dlg-overlay{position:fixed;inset:0;z-index:130;display:flex;align-items:center;justify-content:center;padding:20px;background:hsl(222 32% 12% / .5);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);opacity:0;visibility:hidden;transition:opacity .2s ease,visibility .2s ease}
  .dlg-overlay.open{opacity:1;visibility:visible}
  .dlg-sheet{width:100%;max-width:460px;background:var(--card);border-radius:20px;box-shadow:0 26px 64px rgba(0,0,0,.3);transform:translateY(16px) scale(.97);opacity:0;transition:transform .3s cubic-bezier(.34,1.4,.5,1),opacity .3s ease;overflow:hidden}
  .dlg-overlay.open .dlg-sheet{transform:none;opacity:1}
  .dlg-head{padding:20px 22px 0}
  .dlg-head h3{margin:0;font-size:17px;font-weight:800;color:var(--ink)}
  .dlg-body{padding:14px 22px 4px}
  .dlg-foot{display:flex;gap:10px;justify-content:flex-end;padding:16px 22px 20px}
  @media(max-width:480px){.dlg-overlay{align-items:flex-end;padding:0}.dlg-sheet{max-width:100%;border-radius:20px 20px 0 0}}
</style>`;

const PAGE_JS = `
  var STORE='dis_agreement_v2';
  var LOGO=initLogo('logo-input','logo-preview',function(){ render(); save(); });
  var SIG=initSignature('sig-pad',function(){ render(); save(); });
  var EX=initExport(function(){ return $('doc-preview'); }, function(){ return 'Service Agreement'+($('clName').value?' - '+$('clName').value:''); });
  initBranding(function(){ render(); });
  var LASTTOTAL=0;
  function saveData(){ return { type:'agreement', docNumber:'', partyName:$('clName').value, total:LASTTOTAL, payload:collect() }; }

  var FIELDS=['spName','spAddr','clName','clAddr','effDate','scope','deliverables','startDate','endDate','fee','advancePct'];

  var DEFAULT_CLAUSES=[
    {title:'Revisions', body:'Up to 2 round(s) of revisions are included in the fee. All change requests should be submitted together. Additional revisions may be charged separately at the Service Provider\\'s standard rates.'},
    {title:'Cancellation', body:'Either party may end this Agreement with written notice. If the Client cancels after work has started, any advance paid is non-refundable, and any work already delivered remains payable.'},
    {title:'Late Payment', body:'Invoices are payable within the agreed period. Overdue amounts may attract interest at 18% per annum, and the Service Provider may pause work until outstanding dues are cleared.'},
    {title:'Confidentiality', body:'Each party will keep the other party\\'s non-public information confidential and use it only to perform this Agreement.'},
    {title:'Intellectual Property', body:'On full payment of all fees, ownership of the final approved deliverables passes to the Client. The Service Provider may show the work in their portfolio unless agreed otherwise in writing.'},
    {title:'Governing Law', body:'This Agreement is governed by the laws of India, and the courts of the Service Provider\\'s city will have jurisdiction over any dispute.'}
  ];
  var clauses=[];
  var editIdx=-1;

  function collect(){
    var o={ clauses:clauses, logo:LOGO.get(), sig:SIG.get() };
    FIELDS.forEach(function(id){ o[id]=$(id).value; });
    return o;
  }
  function save(){ try{ localStorage.setItem(STORE, JSON.stringify(collect())); }catch(e){} }
  function commit(){ renderClauseList(); render(); save(); }

  // ── Clause list ──
  var ICO={
    up:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>',
    down:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    edit:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    del:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>'
  };
  function snip(t){ t=(t||'').replace(/\\s+/g,' ').trim(); return t.length>96 ? t.slice(0,96)+'\\u2026' : t; }
  function renderClauseList(){
    var w=$('clause-list');
    if(!clauses.length){ w.innerHTML='<div class="cl-empty">No extra clauses — the agreement shows only the core terms (parties, scope, deliverables, term, fees). Add clauses like Confidentiality or Cancellation whenever you want.</div>'; return; }
    w.innerHTML=clauses.map(function(c,i){
      return '<div class="cl-card">'+
        '<div class="cl-main"><div class="cl-title">'+esc(c.title||'Untitled clause')+'</div><div class="cl-snip">'+esc(snip(c.body))+'</div></div>'+
        '<div class="cl-btns">'+
          '<button type="button" class="cl-ico" data-a="up" data-i="'+i+'" aria-label="Move up"'+(i===0?' disabled':'')+'>'+ICO.up+'</button>'+
          '<button type="button" class="cl-ico" data-a="down" data-i="'+i+'" aria-label="Move down"'+(i===clauses.length-1?' disabled':'')+'>'+ICO.down+'</button>'+
          '<button type="button" class="cl-ico" data-a="edit" data-i="'+i+'" aria-label="Edit clause">'+ICO.edit+'</button>'+
          '<button type="button" class="cl-ico cl-del" data-a="del" data-i="'+i+'" aria-label="Delete clause">'+ICO.del+'</button>'+
        '</div>'+
      '</div>';
    }).join('');
  }
  $('clause-list').addEventListener('click', function(e){
    var b=e.target.closest('.cl-ico'); if(!b||b.disabled) return;
    var i=parseInt(b.getAttribute('data-i'),10), a=b.getAttribute('data-a'), t;
    if(a==='up'&&i>0){ t=clauses[i]; clauses[i]=clauses[i-1]; clauses[i-1]=t; commit(); }
    else if(a==='down'&&i<clauses.length-1){ t=clauses[i]; clauses[i]=clauses[i+1]; clauses[i+1]=t; commit(); }
    else if(a==='edit'){ openDlg('edit', i); }
    else if(a==='del'){ openDlg('confirm', i); }
  });

  // ── Dialog (add / edit / confirm delete) ──
  var dlg=$('clause-dialog'), dlgC=$('dlg-content');
  function openDlg(mode, idx){
    editIdx=idx;
    if(mode==='confirm'){
      var c=clauses[idx]||{};
      dlgC.innerHTML='<div class="dlg-head"><h3>Delete clause?</h3></div>'+
        '<div class="dlg-body"><p class="muted" style="font-size:13.5px;margin:0">Remove <b>'+esc(c.title||'this clause')+'</b> from the agreement?</p></div>'+
        '<div class="dlg-foot"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn cl-danger" data-x="del">Delete clause</button></div>';
    } else {
      var isNew=idx<0, cc=isNew?{title:'',body:''}:(clauses[idx]||{title:'',body:''});
      dlgC.innerHTML='<div class="dlg-head"><h3>'+(isNew?'Add clause':'Edit clause')+'</h3></div>'+
        '<div class="dlg-body"><label>Clause title</label><input class="f" id="dlg-title" maxlength="60" placeholder="e.g. Confidentiality" />'+
        '<label style="margin-top:10px">Clause text</label><textarea class="f" id="dlg-txt" rows="5" placeholder="Write the clause in plain language\\u2026"></textarea></div>'+
        '<div class="dlg-foot"><button type="button" class="btn ghost" data-x="cancel">Cancel</button><button type="button" class="btn" data-x="save">'+(isNew?'Add clause':'Save changes')+'</button></div>';
      $('dlg-title').value=cc.title||''; $('dlg-txt').value=cc.body||'';
      $('dlg-txt').addEventListener('keydown', function(ev){ if((ev.metaKey||ev.ctrlKey)&&ev.key==='Enter') saveDlg(); });
      setTimeout(function(){ try{ $('dlg-title').focus(); }catch(e){} }, 60);
    }
    dlg.classList.add('open'); dlg.setAttribute('aria-hidden','false');
  }
  function closeDlg(){ dlg.classList.remove('open'); dlg.setAttribute('aria-hidden','true'); }
  function saveDlg(){
    var tt=$('dlg-title'), bb=$('dlg-txt'); if(!tt||!bb) return;
    var t=tt.value.trim(), body=bb.value.trim();
    if(!t && !body){ closeDlg(); return; }
    var obj={title:t||'Clause', body:body};
    if(editIdx<0) clauses.push(obj); else clauses[editIdx]=obj;
    closeDlg(); commit();
  }
  dlg.addEventListener('click', function(e){
    if(e.target===dlg){ closeDlg(); return; }
    var b=e.target.closest('[data-x]'); if(!b) return;
    var x=b.getAttribute('data-x');
    if(x==='cancel') closeDlg();
    else if(x==='save') saveDlg();
    else if(x==='del'){ if(editIdx>-1) clauses.splice(editIdx,1); closeDlg(); commit(); }
  });
  document.addEventListener('keydown', function(e){ if(e.key==='Escape' && dlg.classList.contains('open')) closeDlg(); });
  $('add-clause').addEventListener('click', function(){ openDlg('edit', -1); });

  // ── Document render ──
  function para(t){ return '<p style="margin:8px 0;font-size:12.5px;color:#334155;line-height:1.6">'+t+'</p>'; }
  function clause(n,title,inner){ return '<div style="margin-top:12px"><div style="font-weight:700;font-size:13px;color:#0F172A">'+n+'. '+esc(title)+'</div>'+inner+'</div>'; }

  function render(){
    var sp=$('spName').value||'the Service Provider';
    var cl=$('clName').value||'the Client';
    var fee=round2(num($('fee').value));
    LASTTOTAL=fee;
    var pct=Math.max(0,Math.min(100,num($('advancePct').value)));
    var adv=round2(fee*pct/100);
    var bal=round2(fee-adv);

    var delivs=$('deliverables').value.split('\\n').map(function(s){return s.trim();}).filter(function(s){return s;});
    var delivHtml = delivs.length
      ? '<ul style="margin:4px 0;padding-left:18px;font-size:12.5px;color:#334155">'+delivs.map(function(d){return '<li style="margin-bottom:2px">'+esc(d)+'</li>';}).join('')+'</ul>'
      : para('As described in the scope of services above.');

    var n=0, body='';
    body+=clause(++n,'Parties', para('This Service Agreement is made between <b>'+esc(sp)+'</b>'+($('spAddr').value?' ('+esc($('spAddr').value.replace(/\\n/g,', '))+')':'')+' ("Service Provider") and <b>'+esc(cl)+'</b>'+($('clAddr').value?' ('+esc($('clAddr').value.replace(/\\n/g,', '))+')':'')+' ("Client")'+($('effDate').value?', effective '+fmtDate($('effDate').value):'')+'.'));
    body+=clause(++n,'Scope of Services', para($('scope').value?esc($('scope').value):'The Service Provider will provide the services agreed between the parties.'));
    body+=clause(++n,'Deliverables', delivHtml);
    body+=clause(++n,'Term', para('This Agreement '+($('startDate').value?'begins on '+fmtDate($('startDate').value):'begins on the effective date')+($('endDate').value?' and continues until '+fmtDate($('endDate').value):' and continues until the services are completed')+', unless ended earlier under the terms below.'));
    body+=clause(++n,'Fees & Payment', para('The total fee for the services is <b>'+money(fee)+'</b> ('+esc(words(fee))+').'+(pct>0?' An advance of '+money(adv)+' ('+pct+'%) is payable to confirm the engagement, and the balance of '+money(bal)+' is payable on completion / final delivery.':' Payment is due as agreed between the parties.')));
    clauses.forEach(function(c){ if((c.title&&c.title.trim())||(c.body&&c.body.trim())){ body+=clause(++n, c.title||'Clause', '<div style="margin:8px 0;font-size:12.5px;color:#334155;line-height:1.6;white-space:pre-line">'+esc(c.body||'')+'</div>'); } });

    var spSignInk = SIG.get() ? '<img src="'+SIG.get()+'" alt="signature" style="max-height:42px;max-width:170px;object-fit:contain" />' : '';
    var sign='<div style="margin-top:22px;display:flex;gap:24px">'+
      '<div style="flex:1"><div style="min-height:36px;border-bottom:1px solid #94A3B8;display:flex;align-items:flex-end">'+spSignInk+'</div><div style="font-size:11px;color:#64748B;margin-top:4px">Service Provider</div><div style="font-size:12px;font-weight:600;color:#0F172A">'+esc(sp)+'</div><div style="font-size:11px;color:#94A3B8">Signature / Date</div></div>'+
      '<div style="flex:1"><div style="min-height:36px;border-bottom:1px solid #94A3B8"></div><div style="font-size:11px;color:#64748B;margin-top:4px">Client</div><div style="font-size:12px;font-weight:600;color:#0F172A">'+esc(cl)+'</div><div style="font-size:11px;color:#94A3B8">Signature / Date</div></div>'+
    '</div>';

    var html=''+
      '<div style="text-align:center;border-bottom:2px solid #0E8C5A;padding-bottom:8px;margin-bottom:6px">'+(LOGO.get()?'<img src="'+LOGO.get()+'" alt="" style="max-height:46px;max-width:180px;object-fit:contain;margin:0 auto 6px;display:block" />':'')+'<div style="font-size:19px;font-weight:800;letter-spacing:.03em;color:#0F172A">SERVICE AGREEMENT</div></div>'+
      body+sign+
      brandFooter();
    $('doc-preview').innerHTML=html;
  }

  FIELDS.forEach(function(id){ $(id).addEventListener('input',function(){ render(); save(); }); });
  $('sig-upload').addEventListener('change',function(e){ SIG.upload(e.target.files && e.target.files[0]); e.target.value=''; });
  $('sig-clear').addEventListener('click',function(){ SIG.clear(); });
  $('reset').addEventListener('click',function(){
    try{localStorage.removeItem(STORE);}catch(e){}
    FIELDS.forEach(function(id){$(id).value='';});
    LOGO.clear(); SIG.clear();
    clauses=DEFAULT_CLAUSES.map(function(c){return {title:c.title, body:c.body};});
    renderClauseList(); render(); save();
  });
  $('download').addEventListener('click',function(){ document.title=('Service Agreement'+($('clName').value?' - '+$('clName').value:'')); EX.open(); });

  var saved=null; try{ saved=JSON.parse(localStorage.getItem(STORE)||'null'); }catch(e){}
  if(saved){
    FIELDS.forEach(function(id){ if(saved[id]!=null)$(id).value=saved[id]; });
    if(saved.logo)LOGO.set(saved.logo);
    if(saved.sig)SIG.set(saved.sig);
    clauses = Array.isArray(saved.clauses) ? saved.clauses : DEFAULT_CLAUSES.map(function(c){return {title:c.title, body:c.body};});
  } else {
    clauses = DEFAULT_CLAUSES.map(function(c){return {title:c.title, body:c.body};});
  }
  renderClauseList(); render();
`;

export function serviceAgreementPage(): string {
  return renderToolPage({
    title: TITLE,
    description: DESC,
    canonicalPath: PATH,
    jsonLd: jsonLd(),
    headExtra: STYLE,
    bodyHtml: BODY,
    bodyEndScripts: "<script>(function(){" + COMMON_JS + MEDIA_JS + EXPORT_JS + PAGE_JS + "})();</script>",
  });
}

export const serviceAgreementMeta = {
  slug: "service-agreement-template",
  path: PATH,
  title: "Free Service Agreement Template",
  blurb: "Generate a professional service contract — scope, fees, revisions, cancellation and signatures — and download it as a PDF, free.",
};
