/**
 * Analytics consent, option (a): Google Analytics is not loaded at all until the visitor accepts. No gtag script, no
 * cookies, no requests to Google Analytics before that. The choice lives in this origin's localStorage under
 * CONSENT_KEY, so the SPA and the server-rendered pages (tools, blog, category, comparison) share it.
 *
 * consentScript() is the ONE implementation, inlined in <head>:
 *   - "server" pages get it from server/tools/layout.ts (gaSnippet);
 *   - the SPA has the identical "spa" output pasted into client/index.html (it is static), and server/seo.test.ts fails
 *     if the two ever differ.
 * It defines window.disConsent = { get, set, load }: get() is "granted" | "denied" | null (no choice, or a choice
 * older than CONSENT_MAX_AGE_DAYS); set("denied") turns GA off for the rest of the page (ga-disable flag) and
 * deletes the _ga cookies. Never on localhost, so development never reaches GA.
 *
 * consentBanner() is the server pages' banner and "Cookie settings" handler; the SPA has a React banner
 * (client/src/components/cookie-banner.tsx) over the same API.
 */
export const GA_ID = "G-W3VTLRH79B";
export const CONSENT_KEY = "dis_consent";
export const CONSENT_VERSION = 1;
export const CONSENT_MAX_AGE_DAYS = 365;

export function consentScript(mode: "spa" | "server"): string {
  // SPA: page views are sent by React on each route (lib/analytics.ts). Server pages: GA's own page_view, plus the
  // product-link click event (anchors marked data-cta and links into /auth, /pricing, /?...).
  const config = mode === "spa" ? "{send_page_view:false}" : "{}";
  const after = mode === "spa" ? "" : "document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href]');if(!a)return;var u=a.getAttribute('href')||'';if(a.hasAttribute('data-cta')||/^\\/auth|^\\/pricing|^\\/\\?/.test(u)){window.gtag('event','seo_cta_click',{page:location.pathname,target:u,transport_type:'beacon'})}});";
  return `<script>(function(){var ID='${GA_ID}',KEY='${CONSENT_KEY}',V=${CONSENT_VERSION},MAX=${CONSENT_MAX_AGE_DAYS}*864e5;`
    + `function read(){try{var v=JSON.parse(localStorage.getItem(KEY)||'null');if(!v||v.v!==V||(v.analytics!=='granted'&&v.analytics!=='denied'))return null;if(!(Date.now()-Date.parse(v.at)<MAX))return null;return v.analytics}catch(e){return null}}`
    + `function local(){var h=location.hostname;return h==='localhost'||h==='127.0.0.1'||h==='[::1]'||/\\.local$/.test(h)}`
    + `function load(){if(window.__disGa||local())return;window.__disGa=true;window['ga-disable-'+ID]=false;var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id='+ID;document.head.appendChild(s);window.dataLayer=window.dataLayer||[];window.gtag=function(){window.dataLayer.push(arguments)};window.gtag('js',new Date());window.gtag('config',ID,${config});${after}}`
    + `function wipe(){var d=location.hostname.replace(/^www\\./,'');document.cookie.split(';').forEach(function(c){var n=c.split('=')[0].trim();if(!/^_ga/.test(n))return;['',';domain='+d,';domain=.'+d].forEach(function(x){document.cookie=n+'=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/'+x})})}`
    + `window.disConsent={get:read,load:load,set:function(a){if(a!=='granted'&&a!=='denied')return;try{localStorage.setItem(KEY,JSON.stringify({v:V,analytics:a,at:new Date().toISOString()}))}catch(e){}if(a==='granted'){load()}else{window['ga-disable-'+ID]=true;wipe()}try{window.dispatchEvent(new CustomEvent('dis:consent',{detail:a}))}catch(e){}}};`
    + `if(read()==='granted')load()})();</script>`;
}

/**
 * The server pages' banner: shown while no choice is stored, reopened by any element with data-consent-open (the
 * footer's "Cookie settings"). Two equal buttons, no pre-ticked choice, not a modal: the page stays usable.
 */
export function consentBanner(): string {
  return `<div id="dis-consent" role="region" aria-label="Cookie choices" hidden style="position:fixed;left:12px;right:12px;bottom:12px;z-index:60;max-width:640px;margin:0 auto;background:#0f172a;color:#f8fafc;border-radius:14px;padding:16px;box-shadow:0 10px 30px rgba(0,0,0,.25);font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif">`
    + `<p style="margin:0 0 12px">We'd like to use Google Analytics to understand how DealInSec is used. It sets cookies, and it stays off unless you accept. <a href="/cookies" style="color:#6ee7b7">Cookie policy</a></p>`
    + `<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" data-consent="granted" style="flex:1;min-width:140px;min-height:44px;border:0;border-radius:10px;background:#10b981;color:#052e16;font-weight:600;cursor:pointer">Accept analytics</button>`
    + `<button type="button" data-consent="denied" style="flex:1;min-width:140px;min-height:44px;border:1px solid #64748b;border-radius:10px;background:transparent;color:#f8fafc;font-weight:600;cursor:pointer">Decline</button></div></div>`
    + `<script>(function(){var b=document.getElementById('dis-consent');if(!b||!window.disConsent)return;function show(){b.hidden=false;var f=b.querySelector('button');if(f)f.focus()}`
    + `if(window.disConsent.get()===null)b.hidden=false;`
    + `b.addEventListener('click',function(e){var t=e.target.closest&&e.target.closest('[data-consent]');if(!t)return;window.disConsent.set(t.getAttribute('data-consent'));b.hidden=true});`
    + `document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!b.hidden&&window.disConsent.get()!==null)b.hidden=true});`
    + `document.addEventListener('click',function(e){var t=e.target.closest&&e.target.closest('[data-consent-open]');if(!t)return;e.preventDefault();show()})})();</script>`;
}
