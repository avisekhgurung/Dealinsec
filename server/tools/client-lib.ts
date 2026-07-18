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
