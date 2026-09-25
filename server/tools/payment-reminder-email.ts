/**
 * Payment Reminder Email Generator — /tools/payment-reminder-email-generator
 *
 * Built for the reminder-email search cluster ("payment reminder email",
 * "invoice reminder email", "overdue invoice email"): the visitor types an
 * invoice's details and gets a ready-to-send subject and message whose tone is
 * chosen from how overdue the invoice is.
 *
 * Deliberately small and honest:
 *  - Pure client-side templating. No AI, no server call, nothing stored on our
 *    servers (fields persist in the visitor's own localStorage only).
 *  - It writes text; it never sends anything. The visitor copies it or opens
 *    it in their own email app.
 *  - It adds no late fee, interest or legal claim. Those depend on the
 *    contract and the country, so the page says so instead of guessing. The
 *    final-notice template mentions pausing work only if the visitor ticks a
 *    box saying their agreement allows it.
 *  - Money and dates use the shared region helpers (COMMON_JS / REGION_JS), so
 *    the amount and due date read the way the visitor's country writes them.
 */
import { renderToolPage } from "./layout";
import { COMMON_JS } from "./client-lib";
import { REGION_JS, regionFieldsHtml } from "./region-lib";

const PATH = "/tools/payment-reminder-email-generator";
const TITLE = "Payment Reminder Email Generator — Free Invoice Reminder | DealInSec";
const DESC =
  "Free payment reminder email generator: enter your invoice details and get a polite reminder — friendly, firm or final — in your currency. Copy it or open it in your email app. No sign-up.";
const SIGNUP = "/auth?mode=signup&ref=tool_payment_reminder";

const FAQ: { q: string; a: string }[] = [
  {
    q: "When should I send a payment reminder email?",
    a: "Many freelancers send a short heads-up a day or two before the due date and the first reminder the working day after it. If your invoice terms say something different, follow them. This generator suggests a tone from how many days overdue the invoice is, and you can override it.",
  },
  {
    q: "How many payment reminders should I send?",
    a: "Three well-spaced emails is a sensible ceiling: a friendly one, a firmer one that asks for a date, and a final notice. After that another email rarely helps — call, confirm what you agree in writing, and check what your agreement lets you do next.",
  },
  {
    q: "Can I add a late fee to the reminder?",
    a: "Only if your signed agreement or invoice terms provide for it, or the law in your country gives you a right to it. This tool does not add fees or interest, because the rules differ by country and contract. If your client is a UK business, the UK late payment calculator explains the statutory rules.",
  },
  {
    q: "Does this tool send the email for me?",
    a: "No. It writes the text in your browser. You copy it, or open it in your own email app, and send it yourself. Nothing you type is sent to or stored on our servers.",
  },
  {
    q: "What if the client ignores every reminder?",
    a: "Change the approach instead of sending a fifth email: call, confirm the outcome in writing and, if your agreement allows it, pause work. Formal steps depend on your country and the amount, so speak to a professional before you take them.",
  },
];

function faqHtml(): string {
  return FAQ.map((f) => `<details><summary>${f.q}</summary><p>${f.a}</p></details>`).join("\n");
}

function jsonLd(): object[] {
  const origin = "https://www.dealinsec.com";
  return [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Payment Reminder Email Generator",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Any",
      url: origin + PATH,
      description: DESC,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
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
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Free Tools", item: origin + "/tools" },
        { "@type": "ListItem", position: 2, name: "Payment Reminder Email Generator", item: origin + PATH },
      ],
    },
  ];
}

const BODY = `
<div class="hero"><div class="wrap">
  <h1>Payment Reminder Email Generator</h1>
  <p class="sub">Enter your invoice details and get a polite, ready-to-send payment reminder — friendly, firm or final, chosen from how overdue the invoice is. Free, in your own currency, and nothing leaves your browser.</p>
  <div class="chips">
    <span class="chip">100% free</span>
    <span class="chip">No sign-up</span>
    <span class="chip">Any country · any currency</span>
    <span class="chip">You send it — we never do</span>
  </div>
</div></div>

<section><div class="wrap">
  <div class="grid2">
    <div class="card">
      <h2 style="font-size:18px">Invoice details</h2>

      ${regionFieldsHtml()}

      <div class="row2">
        <div><label for="me">Your name or business</label><input class="f" id="me" placeholder="e.g. Alex Rivera" autocomplete="off" /></div>
        <div><label for="client">Client name</label><input class="f" id="client" placeholder="e.g. Jordan" autocomplete="off" /></div>
      </div>
      <div class="row2">
        <div><label for="inv">Invoice number</label><input class="f" id="inv" placeholder="e.g. INV-0042" autocomplete="off" /></div>
        <div><label for="amount">Amount</label><input class="f" id="amount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="e.g. 1500" /></div>
      </div>
      <div class="row2">
        <div>
          <label for="due">Invoice due date</label>
          <input class="f" id="due" type="date" />
          <p class="pr-note" id="days-note"></p>
        </div>
        <div>
          <label for="tone">Tone</label>
          <select class="f" id="tone">
            <option value="auto" selected>Auto — from days overdue</option>
            <option value="headsup">Heads-up (before the due date)</option>
            <option value="friendly">Friendly reminder</option>
            <option value="firm">Firm reminder</option>
            <option value="final">Final notice</option>
          </select>
          <p class="pr-note" id="tone-note"></p>
        </div>
      </div>
      <label for="pay">How to pay (optional)</label>
      <textarea class="f" id="pay" rows="2" placeholder="e.g. Bank transfer to the account on the invoice, quoting the invoice number."></textarea>
      <label class="pr-check"><input type="checkbox" id="pause" /> My agreement lets me pause work for non-payment <span class="pr-note" style="display:inline">(adds one sentence to a final notice)</span></label>
      <p class="pr-note">Editing a field rewrites the message on the right.</p>
    </div>

    <div class="card">
      <h2 style="font-size:18px">Your email</h2>
      <label for="subject">Subject</label>
      <input class="f" id="subject" />
      <label for="body">Message</label>
      <textarea class="f" id="body" rows="14"></textarea>
      <div class="pr-actions">
        <button type="button" class="btn" id="copy-email">Copy email</button>
        <button type="button" class="btn ghost" id="copy-subject">Copy subject</button>
        <a class="btn ghost" id="mailto" href="#">Open in email app</a>
      </div>
      <p class="pr-note">Anything in {curly braces} is a blank to fill in. Check the details, then send it from your own email — this tool never sends anything.</p>
    </div>
  </div>
</div></section>

<section><div class="wrap">
  <h2>Which tone should you use?</h2>
  <div class="pr-table-wrap"><table class="pr-table">
    <tr><th>Invoice status</th><th>Tone</th><th>What the email does</th></tr>
    <tr><td>Due in the next few days</td><td>Heads-up</td><td>Confirms it arrived and prevents a slip</td></tr>
    <tr><td>1–6 days overdue</td><td>Friendly reminder</td><td>Assumes it was missed and asks for a payment date</td></tr>
    <tr><td>7–20 days overdue</td><td>Firm reminder</td><td>Asks for a specific date and offers to fix any problem</td></tr>
    <tr><td>21+ days overdue</td><td>Final notice</td><td>States a deadline; mentions pausing work only if your agreement allows it</td></tr>
  </table></div>
  <p class="muted" style="font-size:14px;margin-top:10px">Common rhythms, not rules — adjust for your client and your agreement.</p>
</div></section>

<section><div class="wrap">
  <h2>Get better results from any reminder</h2>
  <ol class="pr-list">
    <li><b>Attach the invoice again</b> so nobody has to search for it.</li>
    <li><b>Ask for a date</b>, not a promise — "confirm by Friday" gets a commitment you can follow up on.</li>
    <li><b>Reply in the original thread</b> so the history travels with the message.</li>
    <li><b>Never apologise for asking.</b> It is a routine business email, not a favour.</li>
    <li><b>Confirm calls in writing.</b> If the client promises payment by phone, email the date back to them.</li>
  </ol>
  <p>More templates and timing guidance: <a href="/blog/payment-reminder-email">payment reminder email templates</a>, <a href="/blog/overdue-invoice-email">overdue invoice email templates</a> and <a href="/blog/reminder-email-templates">reminder email templates for any follow-up</a>. Chasing a UK business client? The <a href="/tools/uk-late-payment-calculator">UK late payment calculator</a> shows the statutory interest and compensation that may apply.</p>
</div></section>

<section><div class="wrap">
  <div class="pr-cta">
    <h2>Keep the follow-up on the same record as the invoice</h2>
    <p>This tool drafts one email from what you type. In DealInSec, invoices are tracked from sent to paid, and Copilot can draft a payment reminder from the real invoice — number, amount, due date, days overdue — so nothing is retyped. It only drafts: you review it and send it yourself, and DealInSec never contacts your client for you. Free plan and 7-day trial in every country, no card.</p>
    <a class="btn" href="${SIGNUP}" data-cta>Try DealInSec free →</a>
  </div>
</div></section>

<section id="faq"><div class="wrap faq">
  <h2>Frequently asked questions</h2>
  ${faqHtml()}
</div></section>
`;

const PAGE_JS = `
  var STORE='dis_payment_reminder_v1';
  var RG=initRegion(function(){ build(); save(); });
  var FIELDS=['me','client','inv','amount','due','tone','pay','pause'];
  var LABEL={headsup:'Heads-up',friendly:'Friendly reminder',firm:'Firm reminder',final:'Final notice'};

  function p2(n){ return (n<10?'0':'')+n; }
  function todayStr(){ var d=new Date(); return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate()); }
  // Whole days from a to b, both 'yyyy-mm-dd', computed in UTC so a DST change
  // never drops or adds a day.
  function dayDiff(a,b){
    var pa=a.split('-'), pb=b.split('-');
    return Math.round((Date.UTC(+pb[0],+pb[1]-1,+pb[2])-Date.UTC(+pa[0],+pa[1]-1,+pa[2]))/86400000);
  }
  function addDays(s,n){
    var p=s.split('-'), d=new Date(Date.UTC(+p[0],+p[1]-1,+p[2]+n));
    return d.getUTCFullYear()+'-'+p2(d.getUTCMonth()+1)+'-'+p2(d.getUTCDate());
  }
  function stageFor(days){ return days<=0 ? 'headsup' : days<=6 ? 'friendly' : days<=20 ? 'firm' : 'final'; }
  function ph(v,fallback){ v=String(v||'').trim(); return v || ('{'+fallback+'}'); }
  function val(id){ var e=$(id); return e ? (e.type==='checkbox' ? e.checked : e.value) : ''; }

  function build(){
    var due=val('due');
    var days = due ? dayDiff(due, todayStr()) : null;
    var chosen=val('tone');
    var used = chosen==='auto' ? (days===null ? 'friendly' : stageFor(days)) : chosen;

    $('days-note').textContent = days===null ? 'Add the due date to see how overdue it is.'
      : days>0 ? days+' day'+(days===1?'':'s')+' overdue'
      : days===0 ? 'Due today'
      : 'Due in '+(-days)+' day'+(days===-1?'':'s');
    $('tone-note').textContent = chosen==='auto' ? 'Auto-selected: '+LABEL[used] : '';

    var client=ph(val('client'),'Client name'), me=ph(val('me'),'Your name'), inv=ph(val('inv'),'Invoice #');
    var amt = num(val('amount'))>0 ? money(num(val('amount'))) : '{Amount}';
    var dueTxt = due ? fmtDate(due) : '{Due date}';
    var by = fmtDate(addDays(todayStr(), used==='final' ? 5 : 3));
    var n = (days!==null && days>0) ? String(days) : '{X}';
    var payTxt = String(val('pay')||'').trim();
    var payBlock = payTxt ? ['', payTxt] : [];

    var subject, lines;
    if(used==='headsup'){
      subject='Invoice '+inv+' \\u2014 due '+dueTxt;
      lines=['Hi '+client+',','','A friendly heads-up that invoice '+inv+' for '+amt+' is due on '+dueTxt+'. It is attached again for convenience. Let me know if you need it re-sent or made out differently.'].concat(payBlock,['','Thanks,',me]);
    } else if(used==='friendly'){
      subject='Payment reminder: invoice '+inv;
      lines=['Hi '+client+',','','Invoice '+inv+' for '+amt+' was due on '+dueTxt+' and I do not see the payment yet. It may already be on its way \\u2014 I have attached a copy in case it helps. Could you confirm when it will be paid?'].concat(payBlock,['','Thank you,',me]);
    } else if(used==='firm'){
      subject='Invoice '+inv+' is '+n+' days overdue \\u2014 payment date needed';
      lines=['Hi '+client+',','','Following up on invoice '+inv+' for '+amt+', due on '+dueTxt+' and now '+n+' days overdue. Please confirm by '+by+' that payment has been sent, or tell me the date I can rely on. If something is holding it up on your side, tell me and I will help resolve it today.'].concat(payBlock,['','Regards,',me]);
    } else {
      subject='Final notice: invoice '+inv+' ('+amt+')';
      lines=['Dear '+client+',','','Invoice '+inv+' for '+amt+', due on '+dueTxt+', is now '+n+' days overdue and remains unpaid. Please arrange payment by '+by+'.'];
      if(val('pause')) lines.push('','If I have not received payment or heard from you by then, I will pause work in line with our agreement.');
      lines.push('','I would much prefer to settle this directly \\u2014 please reply or call me today.');
      lines=lines.concat(payBlock,['','Regards,',me]);
    }
    $('subject').value=subject;
    $('body').value=lines.join('\\n');
    $('mailto').href='mailto:?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(lines.join('\\n'));
  }

  function collect(){
    var o={country:REG.cc, currency:REG.cur};
    FIELDS.forEach(function(f){ o[f]=val(f); });
    return o;
  }
  function save(){ try{ localStorage.setItem(STORE, JSON.stringify(collect())); }catch(e){} }

  function copyText(text, btn){
    function ok(){
      var orig=btn.getAttribute('data-label')||btn.textContent;
      btn.setAttribute('data-label',orig);
      btn.textContent='Copied \\u2713';
      setTimeout(function(){ btn.textContent=orig; },1600);
    }
    function fb(){
      var ta=document.createElement('textarea');
      ta.value=text; ta.setAttribute('readonly',''); ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.select();
      var done=false;
      try{ done=document.execCommand('copy'); }catch(e){}
      document.body.removeChild(ta);
      if(done) ok();
      else {
        // Both clipboard routes were refused (some embedded browsers do this):
        // select the message so the visitor can copy it by hand, and say so.
        var src=(btn.id==='copy-subject') ? $('subject') : $('body');
        src.focus(); src.select();
        var orig=btn.getAttribute('data-label')||btn.textContent;
        btn.setAttribute('data-label',orig);
        btn.textContent='Press Ctrl/Cmd+C';
        setTimeout(function(){ btn.textContent=orig; },2600);
      }
    }
    if(navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(ok,fb); else fb();
  }

  var S=null;
  try{ S=JSON.parse(localStorage.getItem(STORE)||'null'); }catch(e){}
  if(S){
    FIELDS.forEach(function(f){
      var e=$(f); if(!e || S[f]==null) return;
      if(e.type==='checkbox') e.checked=!!S[f]; else e.value=S[f];
    });
    RG.set(S.country, S.currency);
  } else {
    RG.reset();
  }

  FIELDS.forEach(function(f){
    var e=$(f); if(!e) return;
    e.addEventListener('input', function(){ build(); save(); });
    e.addEventListener('change', function(){ build(); save(); });
  });
  $('copy-email').addEventListener('click', function(){ copyText($('subject').value+'\\n\\n'+$('body').value, this); });
  $('copy-subject').addEventListener('click', function(){ copyText($('subject').value, this); });
  build();
`;

const STYLE = `<style>
  .pr-note{font-size:12.5px;color:var(--muted);margin:6px 0 0;line-height:1.5}
  .pr-check{display:flex;gap:8px;align-items:flex-start;font-weight:500;color:var(--ink);margin-top:14px}
  .pr-check input{margin-top:3px}
  .pr-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
  .pr-table-wrap{overflow-x:auto}
  .pr-table{width:100%;border-collapse:collapse;font-size:14.5px;background:var(--card);border:1px solid var(--card-line)}
  .pr-table th,.pr-table td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--card-line);vertical-align:top}
  .pr-table th{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);background:var(--bg)}
  .pr-list{padding-left:22px;line-height:1.7}
  .pr-list li{margin-bottom:6px}
  .pr-cta{background:var(--accent-bg,#ecfdf5);border:1px solid var(--accent-line,#bbf7d0);border-radius:16px;padding:22px}
  .pr-cta h2{margin-top:0}
  #body{min-height:260px;font-size:15px;line-height:1.6}
</style>`;

export function paymentReminderPage(): string {
  return renderToolPage({
    title: TITLE,
    description: DESC,
    canonicalPath: PATH,
    jsonLd: jsonLd(),
    headExtra: STYLE,
    bodyHtml: BODY,
    bodyEndScripts: "<script>(function(){" + COMMON_JS + REGION_JS + PAGE_JS + "})();</script>",
  });
}

export const paymentReminderMeta = {
  slug: "payment-reminder-email-generator",
  path: PATH,
  title: "Payment Reminder Email Generator",
  blurb:
    "Enter an invoice's details and get a polite reminder — friendly, firm or final — in your currency. Copy it or open it in your email app. Nothing is sent for you.",
};
