/**
 * Shared browser-side helpers for the free-tool pages.
 *
 * These strings are injected verbatim at the top of each tool's inline IIFE, so
 * the reviewed money/number/escaping logic has a single source of truth (the
 * GST-invoice review fixes live here and apply to every tool). No template
 * literals or `${}` inside these strings — they are embedded in TS template
 * literals in the page modules.
 */

// Pure helpers: DOM lookup, HTML-escape (quotes included — attribute-safe),
// number parsing, paise-safe rounding, ₹ formatting, and Indian amount-in-words
// (handles paise and >99 crore). Depended on by every tool page.
export const COMMON_JS = `
  function $(id){return document.getElementById(id);}
  function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
  function num(x){var v=parseFloat(x);return isFinite(v)?v:0;}
  function round2(x){return Math.round((num(x)+Number.EPSILON)*100)/100;}
  function money(x){return '\\u20B9'+(num(x)).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});}
  var ONES=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  var TENS=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  function two(x){return x<20?ONES[x]:TENS[Math.floor(x/10)]+(x%10?' '+ONES[x%10]:'');}
  function three(x){var h=Math.floor(x/100),r=x%100;return (h?ONES[h]+' Hundred'+(r?' ':''):'')+(r?two(r):'');}
  function wordsInt(n){n=Math.floor(n);if(n===0)return 'Zero';var out='';var cr=Math.floor(n/10000000);n=n%10000000;var la=Math.floor(n/100000);n=n%100000;var th=Math.floor(n/1000);n=n%1000;if(cr)out+=(cr>99?wordsInt(cr):two(cr))+' Crore ';if(la)out+=two(la)+' Lakh ';if(th)out+=two(th)+' Thousand ';if(n)out+=three(n);return out.replace(/\\s+/g,' ').trim();}
  function words(x){var v=round2(x);var rup=Math.floor(v);var pai=Math.round((v-rup)*100);var w=wordsInt(rup)+' Rupees';if(pai>0)w+=' and '+wordsInt(pai)+' Paise';return w+' Only';}
  function fmtDate(s){if(!s)return '';var p=String(s).split('-');return p.length===3?(p[2]+'/'+p[1]+'/'+p[0]):s;}
  // "Made with DealInSec" footer — omitted when a signed-in user has opted out
  // (window.__disNoBrand is set by initBranding). Single source of truth.
  function brandFooter(){ return window.__disNoBrand ? '' : '<div style="margin-top:18px;padding-top:10px;border-top:1px solid #EEF2F6;text-align:center;font-size:11px;color:#94A3B8">Made with DealInSec &middot; dealinsec.com</div>'; }
`;

// Logo + signature helpers. Requires COMMON_JS ($) first.
// initLogo(inputId, previewId, onChange): manages an optional business logo (a
//   file -> data URL, rendered into previewId). Returns get/set/clear.
// initSignature(canvasId, onChange): a draw-with-mouse/touch signature pad that
//   can also accept an uploaded image. Returns get/set/clear.
export const MEDIA_JS = `
  function readImageFile(file, cb){
    if(!file){cb('');return;}
    if(file.size > 1200000){ alert('Image too large — please use one under ~1MB.'); cb(''); return; }
    if(!/^image\\//.test(file.type)){ alert('Please choose an image file (PNG or JPG).'); cb(''); return; }
    var reader=new FileReader();
    reader.onload=function(){ cb(String(reader.result||'')); };
    reader.readAsDataURL(file);
  }
  function initLogo(inputId, previewId, onChange){
    var url='';
    function paint(){ var p=$(previewId); if(p){ p.innerHTML = url ? '<img src="'+url+'" alt="logo" style="max-height:54px;max-width:170px;object-fit:contain" />' : ''; p.style.display = url ? 'block' : 'none'; } }
    var input=$(inputId);
    if(input) input.addEventListener('change', function(e){ readImageFile(e.target.files && e.target.files[0], function(u){ if(u){url=u; paint(); onChange&&onChange();} }); e.target.value=''; });
    var clr=$(inputId+'-clear');
    if(clr) clr.addEventListener('click', function(){ url=''; paint(); onChange&&onChange(); });
    return { get:function(){return url;}, set:function(u){ url=u||''; paint(); }, clear:function(){ url=''; paint(); } };
  }
  function initSignature(canvasId, onChange){
    var canvas=$(canvasId); if(!canvas) return { get:function(){return '';}, set:function(){}, clear:function(){} };
    var ctx=canvas.getContext('2d');
    var drawing=false, hasInk=false, dataUrl='';
    function setup(){ var r=canvas.getBoundingClientRect(); var w=r.width||360, h=r.height||96; canvas.width=w*2; canvas.height=h*2; ctx.setTransform(2,0,0,2,0,0); ctx.lineWidth=2; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle='#0F172A'; }
    setup();
    function pt(e){ var r=canvas.getBoundingClientRect(); var t=e.touches&&e.touches[0]; return { x:(t?t.clientX:e.clientX)-r.left, y:(t?t.clientY:e.clientY)-r.top }; }
    function down(e){ drawing=true; var p=pt(e); ctx.beginPath(); ctx.moveTo(p.x,p.y); if(e.cancelable)e.preventDefault(); }
    function move(e){ if(!drawing)return; var p=pt(e); ctx.lineTo(p.x,p.y); ctx.stroke(); hasInk=true; if(e.cancelable)e.preventDefault(); }
    function up(){ if(!drawing)return; drawing=false; if(hasInk){ dataUrl=canvas.toDataURL('image/png'); onChange&&onChange(); } }
    canvas.addEventListener('mousedown',down); canvas.addEventListener('mousemove',move); window.addEventListener('mouseup',up);
    canvas.addEventListener('touchstart',down,{passive:false}); canvas.addEventListener('touchmove',move,{passive:false}); canvas.addEventListener('touchend',up);
    function clear(){ ctx.clearRect(0,0,canvas.width,canvas.height); hasInk=false; dataUrl=''; onChange&&onChange(); }
    function draw(u){ var img=new Image(); img.onload=function(){ ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0,canvas.width/2,canvas.height/2); }; img.src=u; }
    return {
      get:function(){return dataUrl;},
      set:function(u){ dataUrl=u||''; if(u){ hasInk=true; draw(u); } },
      clear:clear,
      // accept an uploaded signature image
      upload:function(file){ readImageFile(file, function(u){ if(u){ dataUrl=u; hasInk=true; draw(u); onChange&&onChange(); } }); }
    };
  }
`;

// Export panel wiring. initExport(getEl, getName) opens the shared #export-panel
// and handles Download PDF (print), Download PNG + Share (via window.htmlToImage,
// loaded from /tools/lib/html-to-image.js), and Print. Requires COMMON_JS ($).
export const EXPORT_JS = `
  function initExport(getEl, getName){
    var overlay=$('export-panel');
    if(!overlay) return { open:function(){ window.print(); }, close:function(){} };
    function open(){ overlay.classList.add('open'); overlay.setAttribute('aria-hidden','false'); }
    function close(){ overlay.classList.remove('open'); overlay.setAttribute('aria-hidden','true'); }
    function busy(btn,on){ if(btn) btn.classList[on?'add':'remove']('busy'); }
    $('export-close').addEventListener('click', close);
    overlay.addEventListener('click', function(e){ if(e.target===overlay) close(); });
    document.addEventListener('keydown', function(e){ if(e.key==='Escape' && overlay.classList.contains('open')) close(); });

    function toPng(cb, onErr){
      if(!window.htmlToImage){ onErr('The image tool is still loading — please try again, or use Download PDF.'); return; }
      var el=getEl(); if(!el){ onErr('Nothing to export yet.'); return; }
      // html-to-image reads cssRules from every stylesheet; a CROSS-ORIGIN one
      // (Google Fonts) throws a SecurityError and hangs the render. Detach any
      // cross-origin stylesheet for the duration, then restore. The document
      // uses a system font stack, so its appearance is unaffected, and the open
      // export panel hides any brief flash on the page behind it.
      var detached=[];
      [].slice.call(document.querySelectorAll('link[rel="stylesheet"]')).forEach(function(l){
        if(l.href && l.href.indexOf(location.origin+'/')!==0 && l.parentNode){ detached.push([l, l.nextSibling, l.parentNode]); l.parentNode.removeChild(l); }
      });
      function restore(){ detached.forEach(function(x){ if(x[2]) x[2].insertBefore(x[0], x[1]); }); }
      var done=false;
      var finish=function(fn, arg){ if(done)return; done=true; clearTimeout(to); restore(); fn(arg); };
      var to=setTimeout(function(){ finish(onErr, 'Rendering took too long — please use Download PDF instead.'); }, 12000);
      window.htmlToImage.toPng(el, { pixelRatio:2, backgroundColor:'#ffffff', skipFonts:true })
        .then(function(d){ finish(cb, d); })
        .catch(function(){ finish(onErr, 'Could not create the image. Please try Download PDF.'); });
    }
    function saveDataUrl(dataUrl){ var a=document.createElement('a'); a.href=dataUrl; a.download=getName()+'.png'; document.body.appendChild(a); a.click(); a.remove(); }
    function printDoc(){ close(); setTimeout(function(){ window.print(); }, 240); }

    $('exp-pdf').addEventListener('click', printDoc);
    $('exp-png').addEventListener('click', function(){ var btn=this; busy(btn,true);
      toPng(function(dataUrl){ saveDataUrl(dataUrl); busy(btn,false); close(); },
            function(msg){ busy(btn,false); alert(msg); });
    });
    $('exp-share').addEventListener('click', function(){ var btn=this; busy(btn,true);
      toPng(function(dataUrl){
        fetch(dataUrl).then(function(r){return r.blob();}).then(function(blob){
          var file=new File([blob], getName()+'.png', {type:'image/png'});
          if(navigator.canShare && navigator.canShare({files:[file]})){
            navigator.share({ files:[file], title:getName() }).catch(function(){}).finally(function(){ busy(btn,false); close(); });
          } else {
            saveDataUrl(dataUrl); busy(btn,false); close();
            alert('Direct sharing is not available on this device — the image was downloaded so you can attach it.');
          }
        }).catch(function(){ busy(btn,false); });
      }, function(msg){ busy(btn,false); alert(msg); });
    });
    return { open:open, close:close };
  }

  // "Remove DealInSec branding" toggle. Injects a checkbox next to the download
  // button; enabling it requires a signed-in account (checked via /api/auth/user,
  // same-origin session) — otherwise a sign-up modal (#brand-modal) is shown.
  // Signed-in + enabled sets window.__disNoBrand so brandFooter() omits the line.
  function initBranding(cb){
    var KEY='dis_nobrand', authed=null, chk=null;
    var modal=$('brand-modal');
    var dl=$('download');
    if(dl && dl.parentNode && dl.parentNode.parentNode){
      var row=document.createElement('label');
      row.className='nobrand-row';
      row.innerHTML='<input type="checkbox" id="no-brand" /><span>Remove the \\u201CMade with DealInSec\\u201D footer</span>';
      dl.parentNode.parentNode.insertBefore(row, dl.parentNode.nextSibling);
      chk=$('no-brand');
    }
    function openModal(){ if(modal){ modal.classList.add('open'); modal.setAttribute('aria-hidden','false'); } }
    function closeModal(){ if(modal){ modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); } }
    function checkAuth(){ if(authed!==null) return Promise.resolve(authed); return fetch('/api/auth/user',{credentials:'include'}).then(function(r){ authed=r.ok; return authed; }).catch(function(){ authed=false; return false; }); }
    function apply(v){ window.__disNoBrand=v; if(chk) chk.checked=v; cb&&cb(); }
    if(chk){
      chk.addEventListener('change', function(){
        if(chk.checked){
          checkAuth().then(function(ok){ if(ok){ try{localStorage.setItem(KEY,'1');}catch(e){} apply(true); } else { chk.checked=false; window.__disNoBrand=false; openModal(); } });
        } else { try{localStorage.removeItem(KEY);}catch(e){} apply(false); }
      });
    }
    if(modal){
      modal.addEventListener('click', function(e){ if(e.target===modal || (e.target.closest && e.target.closest('[data-close]'))) closeModal(); });
      document.addEventListener('keydown', function(e){ if(e.key==='Escape' && modal.classList.contains('open')) closeModal(); });
    }
    var want=false; try{ want=localStorage.getItem(KEY)==='1'; }catch(e){}
    if(want){ checkAuth().then(function(ok){ if(ok) apply(true); else { try{localStorage.removeItem(KEY);}catch(e){} } }); }
    return { enabled:function(){ return !!window.__disNoBrand; } };
  }

`;

// A reusable description/qty/rate line-item editor bound to an #items container
// and an #addItem button. Editing a value re-renders only the preview (keeps
// focus); add/remove rebuild the rows. Requires COMMON_JS ($/esc) first.
export const ITEMS_JS = `
  function initItems(onChange){
    var items=[];
    function renderItems(){
      var c=$('items');c.innerHTML='';
      items.forEach(function(it,i){
        var row=document.createElement('div');
        row.style.cssText='display:grid;grid-template-columns:1fr 68px 96px 32px;gap:8px;margin-bottom:8px;align-items:center';
        row.innerHTML=
          '<input class="f" placeholder="Description" value="'+esc(it.desc)+'" data-i="'+i+'" data-k="desc" />'+
          '<input class="f" type="number" min="0" placeholder="Qty" value="'+esc(it.qty)+'" data-i="'+i+'" data-k="qty" />'+
          '<input class="f" type="number" min="0" placeholder="Rate" value="'+esc(it.rate)+'" data-i="'+i+'" data-k="rate" />'+
          '<button type="button" data-rm="'+i+'" title="Remove" style="border:1.5px solid var(--line);background:#fff;border-radius:8px;height:40px;cursor:pointer;color:#94A3B8;font-size:18px">&times;</button>';
        c.appendChild(row);
      });
    }
    $('items').addEventListener('input',function(e){var t=e.target,i=t.getAttribute('data-i'),k=t.getAttribute('data-k');if(i==null||!k||!items[i])return;items[i][k]=t.value;onChange();});
    $('items').addEventListener('click',function(e){var rm=e.target.getAttribute('data-rm');if(rm==null)return;items.splice(Number(rm),1);renderItems();onChange();});
    $('addItem').addEventListener('click',function(){items.push({desc:'',qty:1,rate:0});renderItems();onChange();});
    return {
      get:function(){return items;},
      set:function(a){items=(a&&a.length)?a:[{desc:'',qty:1,rate:0}];},
      render:renderItems
    };
  }
`;
