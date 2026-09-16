/**
 * Country and currency for the free-tool pages.
 *
 * The tools were written for India: rupees, lakh/crore amount in words,
 * DD/MM/YYYY and a GST block. This module lets a document follow the person's
 * country instead, using the same data the app uses at signup (shared/region)
 * and on its invoices (shared/invoice-tax), so a tool and the product can never
 * disagree about what a UK or US document looks like.
 *
 * India is still the default, and an Indian visitor sees exactly what they saw
 * before: the country guess reads Asia/Kolkata, and every INR/IN branch below
 * keeps the original output.
 *
 * Page contract (a tool opts in by including these pieces):
 *   - regionFieldsHtml()   the Country + Currency selects (#country, #currency)
 *   - intlTaxFieldsHtml()  the non-India tax inputs (#tax-intl: #taxName, #taxPct);
 *                          the tool wraps its own GST inputs in #tax-in
 *   - REGION_JS            after COMMON_JS; defines initRegion(onChange)
 *   - data-taxid-label / data-taxid-wrap / data-taxid-input on the tax-ID field,
 *     data-ph-intl="..." on any input whose placeholder is India-shaped
 */
import {
  COUNTRY_CODES,
  ICU_TO_IANA_ZONE,
  countryName,
  currencyForCountry,
  flagEmoji,
  localeForCountry,
  zonesForCountry,
} from "@shared/region";
import { CURRENCIES, DEFAULT_LOCALE_SETTINGS } from "@shared/schema";
import { invoiceTaxProfile } from "@shared/invoice-tax";
import { esc } from "./layout";

interface CountryRow {
  code: string;
  name: string;
}

const COUNTRY_ROWS: CountryRow[] = COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) =>
  a.name.localeCompare(b.name, "en"),
);

/** Tax-ID field presentation per country, from the invoice tax profile. PAN is
 *  an Indian income-tax number with its own field elsewhere; the tools' single
 *  tax-ID slot is the indirect-tax registration (GSTIN / VAT number). */
function taxIdLabel(country: string): string {
  const reg = invoiceTaxProfile(country).registrations.find((r) => r.field === "gstNumber");
  return reg ? reg.label : "";
}

const TAX_ID_EXAMPLES: Record<string, string> = {
  IN: "e.g. 07AABCU9603R1ZM",
  GB: "e.g. GB123456789",
};

/** Per-country data the browser needs: [currency, locale, taxIdLabel, taxHint, taxIdExample]. */
function buildCountryData(): Record<string, [string, string, string, string, string]> {
  const out: Record<string, [string, string, string, string, string]> = {};
  for (const { code } of COUNTRY_ROWS) {
    const profile = invoiceTaxProfile(code);
    const vatLike = profile.taxLabelHint === "VAT";
    out[code] = [
      currencyForCountry(code).currency,
      localeForCountry(code),
      taxIdLabel(code),
      code === "IN" ? "GST" : profile.taxLabelHint,
      TAX_ID_EXAMPLES[code] ?? (vatLike ? `e.g. ${code === "GR" ? "EL" : code}123456789` : ""),
    ];
  }
  return out;
}

function buildZoneMap(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { code } of COUNTRY_ROWS) {
    for (const zone of zonesForCountry(code)) out[zone] = code;
  }
  for (const [alias, iana] of Object.entries(ICU_TO_IANA_ZONE)) {
    if (out[iana]) out[alias] = out[iana];
  }
  return out;
}

const DECIMALS: Record<string, number> = Object.fromEntries(
  Object.values(CURRENCIES).map((c) => [c.code, c.exponent]),
);

// JSON inside an inline <script>: escape "<" so no value can close the tag.
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

/** Country + currency selects. Server-rendered so the list exists without JS. */
export function regionFieldsHtml(): string {
  const def = DEFAULT_LOCALE_SETTINGS.country;
  const countries = COUNTRY_ROWS.map(
    (c) =>
      `<option value="${c.code}"${c.code === def ? " selected" : ""}>${flagEmoji(c.code)} ${esc(c.name)}</option>`,
  ).join("");
  const currencies = Object.values(CURRENCIES)
    .map(
      (c) =>
        `<option value="${c.code}"${c.code === DEFAULT_LOCALE_SETTINGS.currency ? " selected" : ""}>${c.code} — ${esc(c.name)}</option>`,
    )
    .join("");
  return `<div class="row2">
        <div><label for="country">Your country</label><select class="f" id="country">${countries}</select></div>
        <div><label for="currency">Currency</label><select class="f" id="currency">${currencies}</select></div>
      </div>`;
}

/** Tax inputs for everywhere except India. The issuer types the name and the
 *  rate — the product does not know anyone's tax rate (see shared/invoice-tax). */
export function intlTaxFieldsHtml(): string {
  return `<div class="row2" id="tax-intl" style="display:none">
        <div><label for="taxName">Tax name (optional)</label><input class="f" id="taxName" placeholder="Tax" /></div>
        <div><label for="taxPct">Tax rate % (leave 0 if none)</label><input class="f" id="taxPct" type="number" min="0" max="100" step="0.001" placeholder="0" /></div>
      </div>`;
}

// Browser side. Requires COMMON_JS (which declares REG with India defaults).
export const REGION_JS = `
  var RG_DATA=${json(buildCountryData())};
  var RG_ZONES=${json(buildZoneMap())};
  var RG_DEC=${json(DECIMALS)};
  function rgGuess(){
    var tz=''; try{ tz=Intl.DateTimeFormat().resolvedOptions().timeZone||''; }catch(e){}
    if(RG_ZONES[tz]) return RG_ZONES[tz];
    var langs=[]; try{ langs=navigator.languages||[navigator.language]; }catch(e){}
    for(var i=0;i<langs.length;i++){
      var m=/^[a-z]{2,3}(?:-[a-z]{4})?-([a-z]{2})(?:-|$)/i.exec(String(langs[i]||''));
      var cc=m&&m[1].toUpperCase();
      // "en-US" is the default of privacy browsers and of laptops sold in India; it proves nothing.
      if(cc && cc!=='US' && RG_DATA[cc]) return cc;
    }
    return 'IN';
  }
  function initRegion(onChange){
    var sel=$('country'), cur=$('currency');
    function apply(cc, code){
      var d=RG_DATA[cc]; if(!d){ cc='IN'; d=RG_DATA.IN; }
      if(!code || RG_DEC[code]==null) code=d[0];
      REG.cc=cc; REG.cur=code; REG.loc=d[1]; REG.dec=RG_DEC[code]; REG.taxId=d[2]; REG.taxHint=d[3];
      if(sel) sel.value=cc;
      if(cur) cur.value=code;
      var inn=$('tax-in'), intl=$('tax-intl');
      if(inn) inn.style.display = cc==='IN' ? '' : 'none';
      if(intl) intl.style.display = cc==='IN' ? 'none' : '';
      var tn=$('taxName'); if(tn) tn.placeholder=d[3]||'Tax';
      document.querySelectorAll('[data-taxid-label]').forEach(function(el){ el.textContent=(d[2]||'Tax ID')+' (optional)'; });
      document.querySelectorAll('[data-taxid-wrap]').forEach(function(el){ el.style.display = d[2] ? '' : 'none'; });
      document.querySelectorAll('[data-taxid-input]').forEach(function(el){ el.placeholder=d[4]||''; });
      document.querySelectorAll('[data-ph-intl]').forEach(function(el){
        if(el.getAttribute('data-ph-in')==null) el.setAttribute('data-ph-in', el.placeholder||'');
        el.placeholder = cc==='IN' ? el.getAttribute('data-ph-in') : el.getAttribute('data-ph-intl');
      });
    }
    if(sel) sel.addEventListener('change', function(){ apply(sel.value, ''); onChange&&onChange(); });
    if(cur) cur.addEventListener('change', function(){ apply(REG.cc, cur.value); onChange&&onChange(); });
    return {
      get:function(){ return { country:REG.cc, currency:REG.cur }; },
      // A saved choice wins; with none, the browser's clock and language decide.
      set:function(cc, code){ apply(cc || rgGuess(), code || ''); },
      reset:function(){ apply(rgGuess(), ''); }
    };
  }
  // The non-India tax line: { rate, amount, label }, rate 0 meaning none.
  function intlTax(subtotal){
    var r=Math.min(100, Math.max(0, num($('taxPct') ? $('taxPct').value : 0)));
    var name=(($('taxName') && $('taxName').value) || REG.taxHint || 'Tax').trim();
    return { rate:r, amount:round2(subtotal*r/100), label:name+' ('+r+'%)' };
  }
`;
