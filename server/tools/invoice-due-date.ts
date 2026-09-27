/**
 * Invoice Due Date Calculator — /tools/invoice-due-date-calculator
 *
 * One page for the "invoice due date" / "net 30 calculator" family of
 * searches: the visitor picks an invoice date and a payment term and gets the
 * due date. There are deliberately no separate Net 15 / Net 30 / Net 60 URLs.
 *
 * Deliberately small and honest:
 *  - Pure client-side arithmetic. No AI, no server call, nothing stored.
 *  - Net terms count calendar days from the invoice date. Moving a weekend due
 *    date to Monday is an OPTION the visitor chooses (some agreements say so,
 *    many don't); the page never says a weekend rule is legally required, and
 *    it ignores public holidays, which differ by country and region.
 *  - Day arithmetic is done in UTC, like the UK late payment calculator:
 *    local-midnight arithmetic loses an hour across a DST change and can land
 *    on the wrong day.
 *
 * CORE_JS is the single implementation. The browser runs it, the server runs
 * it to build the worked-examples table, and server/tools/invoice-due-date
 * .test.ts evaluates the same string — so the page, the table and the tests
 * cannot disagree. It is a string (not a TS function passed through
 * toString()) because the server bundle is minified.
 */
import { renderToolPage, esc, SITE_ORIGIN } from "./layout";

const PATH = "/tools/invoice-due-date-calculator";
const TITLE = "Invoice Due Date Calculator — Net 15, Net 30, Net 45 & Net 60 | DealInSec";
const DESC =
  "Calculate an invoice due date from the invoice date and payment terms such as Net 15, Net 30, Net 45 and Net 60, with an option to move a weekend due date to the next business day.";
const SIGNUP = "/auth?mode=signup&ref=tool_due_date";

/** The payment terms on offer, in days after the invoice date (0 = due on receipt). */
export const TERMS: { days: number; label: string }[] = [
  { days: 0, label: "Due on receipt" },
  { days: 7, label: "Net 7" },
  { days: 15, label: "Net 15" },
  { days: 30, label: "Net 30" },
  { days: 45, label: "Net 45" },
  { days: 60, label: "Net 60" },
];
const DEFAULT_TERM = 30;

/**
 * The calculator. Plain ES5 so every browser runs it as-is.
 *
 *   ddCalc(invoiceIso, days, rule, todayIso?) -> result
 *     invoiceIso  "YYYY-MM-DD"
 *     days        one of DD_TERMS
 *     rule        "keep" | "next-business-day"
 *     todayIso    optional; when given, result.daysFromToday is set
 *   result = { ok:false, error:"date"|"terms" }
 *          | { ok:true, raw, rawWeekday, weekend, shifted, due, dueWeekday, daysFromToday }
 *
 *   ddExplain(result, fmt) -> string[]  the human-readable explanation;
 *     fmt(iso) formats a date WITHOUT the weekday (ddExplain names weekdays
 *     itself; a formatter that adds one would print it twice).
 */
export const CORE_JS = `
  var DD_DAY = 86400000;
  var DD_TERMS = [${TERMS.map((t) => t.days).join(",")}];
  var DD_WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  function ddParse(s) {
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(s || ''))) return null;
    var p = String(s).split('-'), y = +p[0], m = +p[1], d = +p[2];
    // Date.UTC maps years 0-99 to 1900-1999; a browser date input can hold
    // "0026". Outside a sane range, treat the date as not entered.
    if (y < 1900 || y > 2200) return null;
    var dt = new Date(Date.UTC(y, m - 1, d));
    // Rejects 2026-02-30 and friends, which Date.UTC would roll forward.
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return dt;
  }
  function ddIso(dt) { return dt.toISOString().slice(0, 10); }
  function ddCalc(invoiceIso, days, rule, todayIso) {
    var inv = ddParse(invoiceIso);
    if (!inv) return { ok: false, error: 'date' };
    days = +days;
    if (DD_TERMS.indexOf(days) < 0) return { ok: false, error: 'terms' };
    var raw = new Date(inv.getTime() + days * DD_DAY);
    var wd = raw.getUTCDay();
    var weekend = wd === 0 || wd === 6;
    var shift = rule === 'next-business-day' ? (wd === 6 ? 2 : (wd === 0 ? 1 : 0)) : 0;
    var due = new Date(raw.getTime() + shift * DD_DAY);
    var today = ddParse(todayIso);
    return {
      ok: true, days: days, rule: rule,
      raw: ddIso(raw), rawWeekday: wd, weekend: weekend, shifted: shift > 0,
      due: ddIso(due), dueWeekday: due.getUTCDay(),
      daysFromToday: today ? Math.round((due.getTime() - today.getTime()) / DD_DAY) : null
    };
  }
  function ddExplain(r, fmt) {
    var out = [];
    if (r.days === 0) {
      out.push('With due on receipt terms, payment is due as soon as the client receives the invoice. This calculator uses the invoice date as the date of receipt.');
    } else {
      out.push('With Net ' + r.days + ' terms, payment is due ' + r.days + ' calendar days after the invoice date. Weekends and public holidays count as days.');
    }
    if (r.shifted) {
      out.push((r.days === 0 ? 'The invoice date' : 'Day ' + r.days) + ' is ' + DD_WEEKDAYS[r.rawWeekday] + ', ' + fmt(r.raw) + ', so with \\u201cmove to next business day\\u201d selected the due date becomes ' + DD_WEEKDAYS[r.dueWeekday] + ', ' + fmt(r.due) + '.');
    } else if (r.weekend) {
      out.push('This due date is a ' + DD_WEEKDAYS[r.rawWeekday] + '. If your agreement moves weekend due dates, choose \\u201cmove to next business day\\u201d.');
    }
    return out;
  }
`;

type DdResult = { ok: boolean; raw: string; due: string; shifted: boolean; weekend: boolean };
const core = new Function(`${CORE_JS}; return { ddCalc: ddCalc };`)() as {
  ddCalc: (invoiceIso: string, days: number, rule: string) => DdResult;
};

/** Illustrative invoice date for the examples table: a Thursday, chosen so that
 *  Net 30 lands on a Saturday and Net 45 on a Sunday. */
export const EXAMPLE_INVOICE_DATE = "2026-10-01";

function fmtLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function examplesTable(): string {
  const rows = TERMS.map((t) => {
    const keep = core.ddCalc(EXAMPLE_INVOICE_DATE, t.days, "keep");
    const moved = core.ddCalc(EXAMPLE_INVOICE_DATE, t.days, "next-business-day");
    const counting = t.days === 0 ? "On the invoice date" : `Invoice date + ${t.days} days`;
    const movedCell = moved.shifted ? `<b>${fmtLong(moved.due)}</b>` : "No change";
    return `<tr><td>${t.label}</td><td>${counting}</td><td>${fmtLong(keep.due)}</td><td>${movedCell}</td></tr>`;
  }).join("\n    ");
  return `<div class="dd-table-wrap"><table class="dd-table">
    <thead><tr><th>Payment term</th><th>Counting</th><th>Due date</th><th>Moved to next business day</th></tr></thead>
    <tbody>
    ${rows}
    </tbody>
  </table></div>`;
}

export const FAQ: { q: string; a: string }[] = [
  {
    q: "How do I calculate an invoice due date?",
    a: "Add the number of days in the payment term to the invoice date, counting every calendar day. For Net 30 on an invoice dated 1 October 2026, the due date is 31 October 2026. If your agreement moves weekend due dates, a Saturday or Sunday due date moves to the following Monday.",
  },
  {
    q: "What does Net 30 mean on an invoice?",
    a: "Net 30 generally means the full invoice amount is due 30 calendar days after the invoice date. Some agreements count from a different day, such as the date the invoice is received or the end of the month, so check what yours says.",
  },
  {
    q: "Does Net 30 include weekends?",
    a: "Yes. Net terms normally count calendar days, so weekends and public holidays are included. Only a term written in business or working days skips them. What happens when the due date itself falls on a weekend depends on the agreement between you and your client.",
  },
  {
    q: "What is the difference between Net 15 and Net 30?",
    a: "Only the number of days. Net 15 is due 15 calendar days after the invoice date and Net 30 is due 30 days after it. A shorter term means you are paid sooner; some clients pay on a fixed monthly cycle and ask for a longer one.",
  },
  {
    q: "What does due on receipt mean?",
    a: "Due on receipt means payment is due as soon as the client receives the invoice, with no extra days in the term. Writing a specific date on the invoice next to it makes it clear from which day the invoice is overdue.",
  },
  {
    q: "What should I do if a client does not pay by the due date?",
    a: "Send a short reminder the working day after the due date that names the invoice number, the amount and the due date, and ask for a payment date. If it stays unpaid, follow up more firmly and check what your agreement allows next, such as a late fee or pausing work.",
  },
];

function faqHtml(): string {
  return FAQ.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("\n");
}

function jsonLd(): object[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Invoice Due Date Calculator",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Any",
      url: SITE_ORIGIN + PATH,
      description: DESC,
      isAccessibleForFree: true,
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
        { "@type": "ListItem", position: 1, name: "Free Tools", item: SITE_ORIGIN + "/tools" },
        { "@type": "ListItem", position: 2, name: "Invoice Due Date Calculator", item: SITE_ORIGIN + PATH },
      ],
    },
  ];
}

const termChips = TERMS.map(
  (t) =>
    `<label class="dd-chip"><input type="radio" name="terms" value="${t.days}"${t.days === DEFAULT_TERM ? " checked" : ""} /><span>${t.label}</span></label>`,
).join("\n          ");

const BODY = `
<section class="dd-hero"><div class="wrap">
  <h1>Invoice Due Date Calculator</h1>
  <p class="dd-answer">Enter the invoice date and choose the payment terms. The calculator adds the term's calendar days to the invoice date — 30 days for Net 30, 15 for Net 15, none for due on receipt — and shows the due date and how many days away it is. If your agreement moves weekend due dates, it can move a Saturday or Sunday due date to the following Monday.</p>
</div></section>

<section class="dd-calc"><div class="wrap">
  <form class="dd-grid" id="dd-form" novalidate>
    <div class="card dd-inputs">
      <label for="dd-date">Invoice date</label>
      <input class="f" id="dd-date" type="date" required aria-describedby="dd-date-err" />
      <p class="dd-err" id="dd-date-err" role="alert" hidden>Enter a valid invoice date.</p>

      <fieldset class="dd-set">
        <legend>Payment terms</legend>
        <div class="dd-chips">
          ${termChips}
        </div>
      </fieldset>
    </div>

    <div class="card dd-result" aria-live="polite">
      <p class="dd-label">Due date</p>
      <p class="dd-due" id="dd-due">—</p>
      <p class="dd-rel" id="dd-rel"></p>
      <div id="dd-explain" class="dd-explain"></div>
      <p class="dd-note">Public holidays are not taken into account; they differ by country and region. The terms that apply are the ones agreed between you and your client.</p>
    </div>

    <div class="card dd-weekend">
      <fieldset class="dd-set dd-set-first">
        <legend>If the due date falls on a weekend</legend>
        <label class="dd-radio"><input type="radio" name="weekend" value="keep" checked /> Keep the calculated due date</label>
        <label class="dd-radio"><input type="radio" name="weekend" value="next-business-day" /> Move it to the next business day (Monday)</label>
      </fieldset>

      <button type="button" class="btn ghost dd-reset" id="dd-reset">Reset</button>
    </div>
  </form>
</div></section>

<section><div class="wrap dd-prose">
  <h2>How to calculate an invoice due date</h2>
  <ol>
    <li><b>Start from the date the term counts from</b> — usually the invoice date. Your agreement may name another, such as the date the invoice is received.</li>
    <li><b>Add the days in the term</b>, counting every calendar day, weekends included: 30 for Net 30, 15 for Net 15.</li>
    <li><b>Check the weekday.</b> If the result is a Saturday or Sunday and your agreement moves weekend due dates, use the next business day.</li>
    <li><b>Write the date on the invoice</b>, not only the term, so there is no doubt about the day payment is due.</li>
  </ol>

  <h2>What does Net 15 mean?</h2>
  <p>Net 15 means the full invoice amount is due 15 calendar days after the invoice date. An invoice dated 1 October 2026 on Net 15 terms is due on 16 October 2026.</p>

  <h2>What does Net 30 mean?</h2>
  <p>Net 30 generally means payment is due 30 calendar days after the invoice date, unless the agreement names a different starting date. "Net" refers to the full amount of the invoice. An invoice dated 1 October 2026 on Net 30 terms is due on 31 October 2026.</p>

  <h2>What does Net 45 mean?</h2>
  <p>Net 45 means payment is due 45 calendar days after the invoice date — about six and a half weeks. An invoice dated 1 October 2026 on Net 45 terms is due on 15 November 2026.</p>

  <h2>What does Net 60 mean?</h2>
  <p>Net 60 means payment is due 60 calendar days after the invoice date, roughly two months. In some countries the law limits how long payment terms between businesses can be, so check the rules that apply to you before agreeing to long terms.</p>

  <h2>What does "Due on receipt" mean?</h2>
  <p>Due on receipt means payment is due as soon as the client receives the invoice, with no extra days in the term. It is common for deposits and small jobs. Writing a date next to it on the invoice makes it clear from which day the invoice is overdue.</p>

  <h2>What happens if the invoice due date falls on a weekend?</h2>
  <p>Net terms count calendar days, so a due date can land on a Saturday or Sunday, and nothing in the term itself moves it. Some agreements say a due date on a weekend or public holiday moves to the next business day; others say nothing. If yours is silent, agree with your client which applies. The calculator above can show either: keep the calculated date, or move a weekend date to the following Monday.</p>

  <h2>Invoice due date examples</h2>
  <p>For an illustrative invoice dated <b>${fmtLong(EXAMPLE_INVOICE_DATE)}</b>. The dates are worked examples, not a rule for any market or country.</p>
  ${examplesTable()}

  <h2>Invoice payment terms</h2>
  <p>The due date on an invoice should follow the payment terms you and your client agreed in the quotation or contract, not a term chosen when the invoice is sent. <a href="/blog/freelance-payment-terms">Freelance payment terms</a> explains what to agree before work starts: deposits, milestones, the due date for each invoice and what happens if payment is late. Write the due date on the invoice next to the term, for example "Net 30 — due 31 October 2026"; in the free <a href="/tools/bill-generator">invoice generator</a>, the notes field is the place for it.</p>

  <h2>What to do when an invoice becomes overdue</h2>
  <p>Send a short reminder the working day after the due date that names the invoice number, the amount and the due date, and ask for a payment date. The <a href="/blog/payment-reminder-email">payment reminder email templates</a> cover the heads-up before the due date through to a final notice, and the <a href="/blog/overdue-invoice-email">overdue invoice email templates</a> are organised by how late the invoice is. The free <a href="/tools/payment-reminder-email-generator">payment reminder email generator</a> writes one from your invoice details. If reminders don't work, <a href="/blog/how-to-follow-up-on-unpaid-invoice">how to follow up on an unpaid invoice</a> covers the next steps; for a UK business client, the <a href="/tools/uk-late-payment-calculator">UK late payment calculator</a> shows the statutory interest that may apply.</p>
</div></section>

<section id="faq"><div class="wrap faq">
  <h2>Frequently asked questions</h2>
  ${faqHtml()}
</div></section>

<section><div class="wrap">
  <div class="dd-cta">
    <h2>Track the invoice after it is sent</h2>
    <p>Once an invoice is created in DealInSec, it is tracked as paid, pending or overdue, and DealInSec can draft a payment reminder from the invoice details — number, amount, due date and days overdue. It only drafts: you review the reminder and send it yourself. The free plan and a 7-day trial with no card are open in every country; paid plans can currently be bought in India only.</p>
    <a class="btn" href="${SIGNUP}" data-cta>Try DealInSec free →</a>
  </div>
</div></section>
`;

const PAGE_JS = `
  var $ = function (id) { return document.getElementById(id); };
  var LOC = 'en-GB';
  try { if (/^en-US/i.test(navigator.language || '')) LOC = 'en-US'; } catch (e) {}
  function fmtWith(iso, opts) {
    var d = ddParse(iso);
    if (!d) return iso;
    try { return d.toLocaleDateString(LOC, opts); } catch (e) { return iso; }
  }
  // The headline date carries its weekday; the explanation names weekdays itself.
  function fmt(iso) { return fmtWith(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); }
  function fmtDay(iso) { return fmtWith(iso, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); }
  function todayIso() {
    var n = new Date();
    return ddIso(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())));
  }
  function picked(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : '';
  }
  function rel(n) {
    if (n === 0) return 'Due today';
    if (n > 0) return 'Due in ' + n + (n === 1 ? ' day' : ' days') + ' from today';
    return 'Was due ' + (-n) + (n === -1 ? ' day' : ' days') + ' ago';
  }
  var used = false;
  function calc(fromUser) {
    var r = ddCalc($('dd-date').value, +picked('terms'), picked('weekend'), todayIso());
    $('dd-date-err').hidden = r.ok;
    $('dd-date').setAttribute('aria-invalid', r.ok ? 'false' : 'true');
    if (!r.ok) {
      $('dd-due').textContent = '—';
      $('dd-rel').textContent = '';
      $('dd-explain').innerHTML = '';
      return;
    }
    $('dd-due').textContent = fmt(r.due);
    $('dd-rel').textContent = rel(r.daysFromToday);
    $('dd-rel').className = 'dd-rel' + (r.daysFromToday < 0 ? ' past' : '');
    $('dd-explain').innerHTML = ddExplain(r, fmtDay).map(function (s) {
      return '<p>' + s.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</p>';
    }).join('');
    // One analytics event per page view, on the first real use.
    if (fromUser && !used) {
      used = true;
      if (typeof window.gtag === 'function') window.gtag('event', 'tool_use', { tool: 'invoice-due-date-calculator' });
    }
  }
  function reset() {
    $('dd-date').value = todayIso();
    document.querySelector('input[name="terms"][value="${DEFAULT_TERM}"]').checked = true;
    document.querySelector('input[name="weekend"][value="keep"]').checked = true;
    calc(false);
  }
  $('dd-form').addEventListener('input', function () { calc(true); });
  $('dd-form').addEventListener('change', function () { calc(true); });
  $('dd-form').addEventListener('submit', function (e) { e.preventDefault(); });
  $('dd-reset').addEventListener('click', reset);
  reset();
`;

const STYLE = `<style>
  .dd-hero{padding:36px 0 4px}
  @media(max-width:600px){.dd-hero{padding-top:22px}.dd-answer{font-size:15px}}
  .dd-hero h1{font-size:clamp(28px,4.6vw,42px);font-weight:800;letter-spacing:-.02em;margin:0 0 12px}
  .dd-answer{max-width:68ch;color:var(--muted);font-size:16px;line-height:1.65;margin:0}
  .dd-calc{padding-top:18px}
  /* Phone: date + terms, then the result right under them, then the weekend
     option. Wider: inputs stacked on the left, the result beside them. */
  .dd-grid{display:grid;gap:16px;grid-template-columns:1fr;grid-template-areas:"inputs" "result" "weekend"}
  @media(min-width:861px){.dd-grid{grid-template-columns:1fr 1fr;gap:22px;grid-template-areas:"inputs result" "weekend result";align-items:start}}
  .dd-inputs{grid-area:inputs}.dd-result{grid-area:result}.dd-weekend{grid-area:weekend}
  .dd-inputs label[for="dd-date"]{margin-top:0}
  .dd-set-first{margin-top:0}
  .dd-set{border:0;padding:0;margin:16px 0 0}
  .dd-set legend{font-size:13px;font-weight:600;color:var(--muted);margin-bottom:8px;padding:0}
  .dd-chips{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
  .dd-chip{margin:0;cursor:pointer;display:flex}
  .dd-chip input{position:absolute;opacity:0;width:1px;height:1px}
  .dd-chip span{flex:1;display:flex;align-items:center;justify-content:center;text-align:center;line-height:1.25;font-size:14px;font-weight:600;color:var(--ink);background:#fff;border:1.5px solid var(--line);border-radius:10px;padding:10px 6px}
  .dd-chip input:checked+span{border-color:var(--green);background:var(--accent-bg);color:var(--accent-fg)}
  .dd-chip input:focus-visible+span{outline:2px solid var(--green);outline-offset:2px}
  .dd-radio{display:flex;gap:10px;align-items:flex-start;font-size:14.5px;font-weight:500;color:var(--ink);margin:8px 0;cursor:pointer}
  .dd-radio input{margin-top:4px}
  .dd-reset{margin-top:16px}
  .dd-err{color:#b42318;font-size:13px;margin:6px 0 0}
  .dd-label{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0}
  .dd-due{font-size:clamp(24px,3.6vw,32px);font-weight:800;letter-spacing:-.01em;color:var(--green-d);margin:6px 0 4px;line-height:1.2}
  .dd-rel{font-weight:600;margin:0 0 12px}
  .dd-rel.past{color:#b42318}
  .dd-explain p{margin:0 0 10px;line-height:1.6}
  .dd-note{font-size:12.5px;color:var(--muted);background:var(--bg);border-radius:10px;padding:10px 12px;line-height:1.55;margin:12px 0 0}
  .dd-prose{max-width:780px}
  .dd-prose h2{margin-top:30px}
  .dd-prose ol{padding-left:22px;line-height:1.7}
  .dd-prose li{margin-bottom:6px}
  .dd-table-wrap{overflow-x:auto}
  .dd-table{width:100%;border-collapse:collapse;font-size:14.5px;background:var(--card);border:1px solid var(--card-line)}
  .dd-table th,.dd-table td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--card-line);vertical-align:top}
  .dd-table th{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);background:var(--bg)}
  .faq details{border-bottom:1px solid var(--card-line);padding:12px 0}
  .faq summary{font-weight:600;cursor:pointer}
  .dd-cta{background:var(--accent-bg,#ecfdf5);border:1px solid var(--accent-line,#bbf7d0);border-radius:16px;padding:22px}
  .dd-cta h2{margin-top:0}
</style>`;

export function invoiceDueDatePage(): string {
  return renderToolPage({
    title: TITLE,
    description: DESC,
    canonicalPath: PATH,
    jsonLd: jsonLd(),
    headExtra: STYLE,
    bodyHtml: BODY,
    hideCtaBand: true,
    bodyEndScripts: "<script>(function(){" + CORE_JS + PAGE_JS + "})();</script>",
  });
}

export const invoiceDueDateMeta = {
  slug: "invoice-due-date-calculator",
  path: PATH,
  title: "Invoice Due Date Calculator",
  blurb:
    "Pick an invoice date and payment terms — due on receipt, Net 7, 15, 30, 45 or 60 — and get the due date, with an option to move a weekend date to Monday.",
};
