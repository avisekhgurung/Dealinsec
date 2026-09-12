/**
 * UK Late Payment Interest & Compensation Calculator — /tools/uk-late-payment-calculator
 *
 * The first deliberately non-India tool: the wedge into a market where the
 * competitive floor for invoicing software is £0 but nobody has built the
 * "my client is late, what can I actually claim?" moment.
 *
 * Statute: Late Payment of Commercial Debts (Interest) Act 1998. Everything
 * below was adversarially fact-checked against primary sources before launch;
 * five findings were dangerous and each fix is load-bearing:
 *
 *  1. RATE IS FIXED BY WHEN THE DEBT WENT LATE, NOT BY TODAY. SI 2002/1675
 *     art.4 sets it at 8% over the Bank of England rate in force on the 30 June
 *     or 31 December *immediately before statutory interest starts to run*. A
 *     debt that fell due in Sept 2025 carries 12.25%, not today's 11.75% — so
 *     the rate is DERIVED from the due date via RATE_TABLE, never hardcoded.
 *  2. FIXED COMPENSATION ONLY EXISTS ONCE INTEREST RUNS (s.5A(1)) — it must be
 *     £0, and no letter may be produced, while the invoice is not yet late.
 *  3. THE LETTER MUST NOT CLAIM PROTOCOL COMPLIANCE. The Pre-Action Protocol
 *     for Debt Claims (para 3.1(c),(d)) requires an Information Sheet, Reply
 *     Form and Financial Statement to be enclosed in every case against an
 *     individual or sole trader. We cannot enclose them, so the letter tells
 *     the user to attach them instead of falsely asserting compliance.
 *  4. NOTICE WORDING MUST BRANCH BY DEBTOR TYPE. "Without further notice" is
 *     contrary to Protocol paras 4.2 and 8.2 for individuals/sole traders.
 *  5. SIX-YEAR LIMITATION (Limitation Act 1980 s.5) — warn near it, and refuse
 *     to draft a demand once the debt is likely statute-barred.
 *
 * Day counting is done in UTC: local-midnight arithmetic loses an hour across
 * the March BST transition and silently drops a day of interest.
 *
 * This is an entitlement calculator plus a letter draft. It is not legal
 * advice and the page never implies otherwise.
 */
import { renderToolPage } from "./layout";

const PATH = "/tools/uk-late-payment-calculator";
const TITLE = "UK Late Payment Interest Calculator — Statutory Interest & Compensation | DealInSec";
const DESC =
  "Free UK late payment calculator: work out statutory interest (8% over base) and the £40/£70/£100 compensation you can claim on an overdue invoice, then copy a letter before action. No sign-up.";

const GOV_RATE_URL =
  "https://www.gov.uk/late-commercial-payments-interest-debt-recovery/charging-interest-commercial-debt";
const PAP_URL = "https://www.justice.gov.uk/courts/procedure-rules/civil/pdf/protocols/debt-pap.pdf";

const FAQ: { q: string; a: string }[] = [
  {
    q: "How much interest can I charge on a late invoice in the UK?",
    a: "Under the Late Payment of Commercial Debts (Interest) Act 1998 you can charge statutory interest of 8% above the Bank of England base rate on a commercial debt. It is simple interest, not compound, and it runs automatically — you do not need a clause in your contract.",
  },
  {
    q: "Which base rate do I use — today's?",
    a: "No, and this is the mistake that costs freelancers money. The rate is 8% above the Bank of England base rate in force on the 30 June or 31 December immediately before your debt started running late, and it stays fixed for that debt. An invoice that went overdue in late 2025 carries 12.25%, while one going overdue now carries 11.75%. This calculator sets the rate from the due date you enter, and you can still edit it.",
  },
  {
    q: "What is the £40, £70 and £100 late payment compensation?",
    a: "On top of interest you can claim a fixed sum per overdue invoice: £40 for a debt under £1,000, £70 for £1,000 to £9,999.99, and £100 for £10,000 or more. It is per invoice, not per client — three overdue invoices of £800 each entitle you to 3 × £40, not a single £70. Under section 5A(2A) you can also claim reasonable recovery costs above the fixed sum. The entitlement only arises once statutory interest starts to run.",
  },
  {
    q: "Can my contract cancel the statutory interest?",
    a: "A contract cannot simply remove the entitlement — any exclusion is void unless the contract provides a substantial remedy for late payment instead. The flip side matters too: if your own terms already set out a substantial late-payment remedy, that remedy replaces the statutory claim, including the fixed £40/£70/£100. Check your own contract before relying on this calculation.",
  },
  {
    q: "When does an invoice legally become late?",
    a: "If you agreed a payment period, the debt is late the day after it ends. If nothing was agreed, the statutory default is 30 days from the later of the customer receiving the invoice or receiving the goods or service. Between businesses a payment period longer than 60 days is only valid if it is not grossly unfair to the supplier. That 60-day rule is for business customers — if your client is a public authority such as a council, an NHS body or a government department, the payment period cannot exceed 30 days, so interest starts running sooner.",
  },
  {
    q: "Can I claim this from a client who is a sole trader?",
    a: "The Act covers commercial debts between businesses, which includes sole traders acting in the course of business. It does not cover a consumer buying for personal use. Note that before starting a court claim against an individual or sole trader, the Pre-Action Protocol for Debt Claims applies: you must enclose the Information Sheet, Reply Form and Financial Statement it requires, and allow 30 days for a reply.",
  },
  {
    q: "Is there a deadline for claiming?",
    a: "Yes. Under section 5 of the Limitation Act 1980, a claim founded on a simple contract must normally be brought within six years of the debt falling due. After that the debt is usually statute-barred and the court will not enforce it, so do not sit on an old invoice.",
  },
  {
    q: "Does claiming interest mean going to court?",
    a: "Usually not. Most freelancers reissue the invoice with the statutory interest added and the Act cited, which is often enough on its own. A letter before action is the next step, and a court claim is the last one. Note that claims up to £10,000 go to the small claims track, where recoverable costs are limited — you can normally recover the court fee and fixed issue costs, but not the hours you spent chasing.",
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
      name: "UK Late Payment Interest Calculator",
      applicationCategory: "FinanceApplication",
      operatingSystem: "Any",
      url: origin + PATH,
      description: DESC,
      offers: { "@type": "Offer", price: "0", priceCurrency: "GBP" },
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
        { "@type": "ListItem", position: 2, name: "UK Late Payment Calculator", item: origin + PATH },
      ],
    },
  ];
}

const BODY = `
<section class="hero-lp">
  <div class="wrap">
    <h1>UK late payment interest calculator</h1>
    <p class="sub">Your client is late. Work out the statutory interest and the fixed compensation you are
    entitled to under the Late Payment of Commercial Debts (Interest) Act 1998 — then copy a letter before
    action. Free, no sign-up.</p>
  </div>
</section>

<section class="wrap calc-wrap">
  <div class="grid2">
    <div class="card">
      <h2 class="card-h">Your overdue invoice</h2>

      <label class="fld">
        <span>Invoice amount (£)</span>
        <input id="amount" type="number" min="0" step="0.01" value="2000" inputmode="decimal" />
      </label>

      <label class="fld">
        <span>Payment was due on</span>
        <input id="due" type="date" />
        <em class="hint">No agreed terms? The statutory default is 30 days from the later of invoice receipt or
        delivery. For a public authority client the period cannot exceed 30 days.</em>
      </label>

      <label class="fld">
        <span>Paid on (leave as today if still unpaid)</span>
        <input id="paid" type="date" />
      </label>

      <label class="fld">
        <span>Statutory interest rate (%)</span>
        <input id="rate" type="number" min="0" step="0.01" inputmode="decimal" />
        <em class="hint" id="rate-hint"></em>
      </label>

      <label class="fld">
        <span>Recovery costs already incurred (£, optional)</span>
        <input id="costs" type="number" min="0" step="0.01" value="0" inputmode="decimal" />
        <em class="hint">Section 5A(2A): if your reasonable costs of recovering the debt exceed the fixed sum,
        you can claim the difference.</em>
      </label>

      <label class="fld">
        <span>Your client is</span>
        <select id="debtor">
          <option value="company">A limited company</option>
          <option value="individual">A sole trader or individual</option>
        </select>
      </label>
    </div>

    <div class="card res">
      <h2 class="card-h">What you can claim</h2>
      <div class="res-row"><span>Days late</span><b id="r-days">—</b></div>
      <div class="res-row"><span>Daily interest</span><b id="r-daily">—</b></div>
      <div class="res-row"><span>Statutory interest</span><b id="r-int">—</b></div>
      <div class="res-row"><span>Fixed compensation</span><b id="r-comp">—</b></div>
      <div class="res-row" id="row-extra" hidden><span>Further recovery costs</span><b id="r-extra">—</b></div>
      <div class="res-row total"><span id="r-total-label">Total now due</span><b id="r-total">—</b></div>
      <p class="res-foot" id="r-note"></p>
      <p class="res-foot warn" id="r-limit" hidden></p>
      <p class="res-foot">
        Compensation is <strong>per overdue invoice</strong>, banded on that invoice's own value:
        £40 under £1,000 · £70 from £1,000 to £9,999.99 · £100 at £10,000 and above.
        Three overdue £800 invoices claim 3 × £40 — not one £70.
      </p>
    </div>
  </div>

  <div class="card letter-card">
    <div class="letter-head">
      <h2 class="card-h">Letter before action</h2>
      <button id="copy" class="btn-copy" type="button">Copy letter</button>
    </div>
    <p class="letter-sub" id="letter-sub"></p>
    <p class="letter-warn" id="letter-encl" hidden>
      <strong>Before you send this:</strong> because your client is an individual or sole trader, the
      Pre-Action Protocol for Debt Claims requires you to enclose its Information Sheet and Reply Form
      (Annex 1) and a Financial Statement form (Annex 2).
      <a href="${PAP_URL}" target="_blank" rel="noopener">Download the Protocol and its annexes</a>.
      Sending the letter without them can get a later claim stayed.
    </p>
    <textarea id="letter" rows="20" spellcheck="false"></textarea>
    <p class="letter-foot">Claims up to £10,000 go to the small claims track, where you can normally recover
    the court fee and fixed issue costs — but not the time you spent chasing.</p>
  </div>

  <p class="disclaimer">
    This is an entitlement calculator, not legal advice, and we are not a law firm. Figures are the statutory
    amounts under the Late Payment of Commercial Debts (Interest) Act 1998 — confirm the current rate on
    <a href="${GOV_RATE_URL}" target="_blank" rel="noopener">GOV.UK</a>, remember the six-year limitation
    period under section 5 of the Limitation Act 1980, and take advice before starting court action.
  </p>
</section>

<section class="wrap examples">
  <h2>Worked examples</h2>
  <table>
    <thead><tr><th>Invoice</th><th>Days late</th><th>Interest</th><th>Compensation</th><th>Interest + compensation</th><th>Total now due</th></tr></thead>
    <tbody>
      <tr><td>£2,000</td><td>30</td><td>£19.32</td><td>£70</td><td><b>£89.32</b></td><td>£2,089.32</td></tr>
      <tr><td>£5,000</td><td>60</td><td>£96.58</td><td>£70</td><td><b>£166.58</b></td><td>£5,166.58</td></tr>
      <tr><td>£12,000</td><td>90</td><td>£347.67</td><td>£100</td><td><b>£447.67</b></td><td>£12,447.67</td></tr>
    </tbody>
  </table>
  <p class="tbl-note">At a statutory rate of 11.75% (debts running late in 2026). Interest is simple,
  calculated daily as amount × rate ÷ 365. "Interest + compensation" is what you add on top of the invoice;
  "Total now due" includes the invoice itself.</p>
</section>

<section id="faq"><div class="wrap faq">
  <h2>Questions freelancers ask</h2>
  ${faqHtml()}
</div></section>
`;

const PAGE_JS = `
  var $ = function (id) { return document.getElementById(id); };
  var DAY = 86400000;

  // SI 2002/1675 art.4: 8% over the Bank of England rate in force on the
  // 30 June / 31 December immediately BEFORE statutory interest starts to run.
  // Keyed by the half-year in which interest starts. Newest first.
  var RATE_TABLE = [
    { from: '2026-07-01', rate: 11.75, ref: 'Bank Rate 3.75% on 30 June 2026' },
    { from: '2026-01-01', rate: 11.75, ref: 'Bank Rate 3.75% on 31 December 2025' },
    { from: '2025-07-01', rate: 12.25, ref: 'Bank Rate 4.25% on 30 June 2025' },
    { from: '2025-01-01', rate: 12.75, ref: 'Bank Rate 4.75% on 31 December 2024' },
    { from: '2024-07-01', rate: 13.25, ref: 'Bank Rate 5.25% on 30 June 2024' },
    { from: '2024-01-01', rate: 13.25, ref: 'Bank Rate 5.25% on 31 December 2023' }
  ];

  function utc(v) {
    if (!v) return null;
    var p = v.split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  }
  function money(n) {
    return '£' + (Math.round(n * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function band(a) { return a >= 10000 ? 100 : (a >= 1000 ? 70 : 40); }
  function isoUTC(d) { return d.toISOString().slice(0, 10); }
  function longDate(d) {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  // Interest starts the day AFTER the due date — that day decides the rate.
  function rateFor(due) {
    if (!due) return RATE_TABLE[0];
    var start = isoUTC(new Date(due.getTime() + DAY));
    for (var i = 0; i < RATE_TABLE.length; i++) {
      if (start >= RATE_TABLE[i].from) return RATE_TABLE[i];
    }
    return { rate: RATE_TABLE[RATE_TABLE.length - 1].rate, ref: 'older than our rate table — check GOV.UK', stale: true };
  }

  var rateTouched = false;
  $('rate').addEventListener('input', function () { rateTouched = true; });

  (function seed() {
    var now = new Date();
    var today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    $('due').value = isoUTC(new Date(today.getTime() - 30 * DAY));
    $('paid').value = isoUTC(today);
  })();

  function syncRate(due) {
    var r = rateFor(due);
    if (!rateTouched) $('rate').value = r.rate;
    $('rate-hint').innerHTML =
      '8% + the Bank of England base rate in force on the 30 June or 31 December <strong>immediately before your invoice became late</strong> — not today\\u2019s rate, and not the current half-year\\u2019s rate if the debt went overdue earlier. For this due date: <strong>' +
      r.rate + '%</strong> (' + r.ref + '). <a href="${GOV_RATE_URL}" target="_blank" rel="noopener">Check on GOV.UK</a>.';
  }

  function calc() {
    var amount = parseFloat($('amount').value) || 0;
    var costs = parseFloat($('costs').value) || 0;
    var due = utc($('due').value);
    var paidVal = $('paid').value;
    var paid = utc(paidVal) || new Date();
    var now = new Date();
    var today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

    syncRate(due);
    var rate = parseFloat($('rate').value) || 0;

    // UTC + round: local midnight across the March BST change loses a day.
    var days = due ? Math.round((paid - due) / DAY) : 0;
    if (days < 0) days = 0;

    var daily = amount * (rate / 100) / 365;
    var interest = daily * days;
    // s.5A(1): the fixed sum exists only once statutory interest runs.
    var comp = (amount > 0 && days > 0) ? band(amount) : 0;
    var extra = (comp > 0 && costs > comp) ? costs - comp : 0;
    var settled = !!paidVal && paid < today;
    var total = (settled ? 0 : amount) + interest + comp + extra;

    $('r-days').textContent = days ? days + (days === 1 ? ' day' : ' days') : 'Not yet late';
    $('r-daily').textContent = money(daily);
    $('r-int').textContent = money(interest);
    $('r-comp').textContent = money(comp);
    $('row-extra').hidden = extra <= 0;
    $('r-extra').textContent = money(extra);
    $('r-total-label').textContent = settled ? 'Still claimable after payment' : 'Total now due';
    $('r-total').textContent = money(total);
    $('r-note').textContent = !days
      ? 'Once the due date passes, interest and the fixed compensation both start the very next day — no clause required.'
      : (settled
          ? 'The invoice was paid late, so the interest and compensation above remain claimable.'
          : 'Interest keeps running at ' + money(daily) + ' a day until the invoice is paid.');

    // Limitation Act 1980 s.5 — six years.
    var barred = days > 2190;
    var nearBar = days > 1825;
    $('r-limit').hidden = !nearBar;
    $('r-limit').textContent = barred
      ? 'This debt appears to be more than six years old and is likely statute-barred under section 5 of the Limitation Act 1980. A court will not normally enforce it. Take advice before doing anything further.'
      : 'Warning: this debt is approaching the six-year limitation period under section 5 of the Limitation Act 1980. Court proceedings must normally be started within six years of the debt falling due. Take advice now.';

    writeLetter({ amount: amount, interest: interest, comp: comp, extra: extra, total: total,
                  days: days, rate: rate, due: due, paid: paid, settled: settled, barred: barred });
  }

  function writeLetter(d) {
    var individual = $('debtor').value === 'individual';
    $('letter-encl').hidden = !individual;
    $('letter-sub').textContent = individual
      ? 'Your client is an individual or sole trader, so the Pre-Action Protocol for Debt Claims applies: enclose its forms and allow 30 days to reply.'
      : 'Your client is a limited company, so the Pre-Action Protocol for Debt Claims does not apply — it covers individuals and sole traders. The Practice Direction on Pre-Action Conduct and Protocols still does: set out your claim and allow a reasonable time to respond. 14 days is commonly given.';

    if (!d.days) {
      $('letter').value = 'This invoice is not overdue yet.\\n\\nStatutory interest and the fixed compensation both start the day after the due date passes. Come back then and this letter will be ready.';
      return;
    }
    if (d.barred) {
      $('letter').value = 'No letter generated.\\n\\nThis debt appears to be more than six years old, so it is likely statute-barred under section 5 of the Limitation Act 1980 and a court would not normally enforce it. Sending a demand that threatens proceedings you cannot bring is a bad idea — take advice first.';
      return;
    }

    var respondDays = individual ? 30 : 14;
    var dueStr = d.due ? longDate(d.due) : '[due date]';
    var todayStr = longDate(new Date());
    var L = [];

    L.push(todayStr);                       // PAP para 3.2: dated at the top.
    L.push('');
    L.push('LETTER BEFORE ACTION');
    L.push('');
    L.push('Dear [client name],');
    L.push('');
    L.push('Re: unpaid invoice [invoice number] — ' + money(d.amount));
    L.push('');
    if (d.settled) {
      L.push('My invoice [invoice number] for ' + money(d.amount) + ' fell due for payment on ' + dueStr + ',');
      L.push('and was not paid until ' + longDate(d.paid) + ' — ' + d.days + ' days late.');
      L.push('Although the invoice itself is now settled, I remain entitled to the following.');
    } else {
      L.push('My invoice [invoice number] for ' + money(d.amount) + ' fell due for payment on ' + dueStr + '.');
      L.push('It remains unpaid and is now ' + d.days + ' days overdue.');
    }
    L.push('');
    L.push('This debt arises from services I supplied to you in the course of business.');
    L.push('Under the Late Payment of Commercial Debts (Interest) Act 1998 I claim:');
    L.push('');
    if (!d.settled) L.push('  Outstanding invoice        ' + money(d.amount));
    L.push('  Statutory interest         ' + money(d.interest) + '  (' + d.rate + '% per annum, ' + d.days + ' days)');
    L.push('  Fixed compensation         ' + money(d.comp) + '  (section 5A)');
    if (d.extra > 0) {
      L.push('  Further recovery costs     ' + money(d.extra) + '  (section 5A(2A))');
    }
    L.push('  ------------------------------------------');
    L.push('  Total now due              ' + money(d.total));
    L.push('');
    if (!d.settled) {
      L.push('Interest continues to accrue at ' + money(d.amount * (d.rate / 100) / 365) + ' a day until the debt is paid in full.');
      L.push('');
    }
    L.push('Payment can be made by bank transfer to [account name], sort code [sort code],');
    L.push('account number [account number], reference [invoice number]. If you would like to');
    L.push('discuss payment options, please contact me on [phone] or [email].');
    L.push('');
    L.push('Please pay the total above within ' + respondDays + ' days of the date at the top of this letter.');
    if (individual) {
      L.push('Please reply using the enclosed Reply Form and send it to me at the address below.');
      L.push('If you do not reply within 30 days, I may begin county court proceedings to recover');
      L.push('the debt. If you do reply and we cannot reach agreement, I will give you at least');
      L.push('14 days\\u2019 further notice before issuing a claim.');
      L.push('');
      L.push('If you are having difficulty paying, please contact me so we can discuss a plan.');
    } else {
      L.push('If I do not hear from you, I may begin county court proceedings to recover the debt,');
      L.push('together with the court fee and any further interest that has accrued.');
    }
    L.push('');
    L.push('Yours sincerely,');
    L.push('[your name]');
    L.push('[your business name]');
    L.push('[your address]');
    L.push('[your email] · [your phone]');
    $('letter').value = L.join('\\n');
  }

  ['amount', 'due', 'paid', 'rate', 'costs', 'debtor'].forEach(function (id) {
    $(id).addEventListener('input', calc);
    $(id).addEventListener('change', calc);
  });

  $('copy').addEventListener('click', function () {
    var t = $('letter');
    t.select();
    try {
      document.execCommand('copy');
      var b = $('copy'), old = b.textContent;
      b.textContent = 'Copied';
      setTimeout(function () { b.textContent = old; }, 1600);
    } catch (e) { /* text stays selected — the user can copy manually */ }
    window.getSelection && window.getSelection().removeAllRanges();
  });

  calc();
`;

const STYLE = `<style>
  .hero-lp{padding:34px 0 10px}
  .hero-lp h1{font-size:clamp(26px,4.4vw,40px);line-height:1.12;margin:0 0 10px;letter-spacing:-.02em}
  .hero-lp .sub{max-width:62ch;color:var(--muted);font-size:15.5px;line-height:1.6;margin:0}
  .calc-wrap{padding-bottom:8px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:18px}
  @media (max-width:820px){.grid2{grid-template-columns:1fr}}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}
  .card-h{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 14px;font-weight:700}
  .fld{display:block;margin-bottom:14px}
  .fld>span{display:block;font-size:13.5px;font-weight:600;margin-bottom:6px}
  .fld input,.fld select{width:100%;font-size:16px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:#fff;color:inherit}
  .fld .hint{display:block;font-size:12px;color:var(--muted);margin-top:6px;font-style:normal;line-height:1.55}
  .res-row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:9px 0;border-bottom:1px dashed var(--line);font-size:14.5px}
  .res-row b{font-variant-numeric:tabular-nums;font-weight:700}
  .res-row.total{border-bottom:none;margin-top:6px;padding-top:14px;border-top:2px solid var(--line);font-size:17px}
  .res-row.total b{color:var(--green-d);font-weight:800}
  .res-foot{margin-top:12px;font-size:12.5px;color:var(--muted);background:var(--bg);border-radius:10px;padding:10px 12px;line-height:1.55}
  .res-foot.warn{background:#fff5f5;color:#9b1c1c;border:1px solid #f7cfcf}
  .letter-card{margin-top:16px}
  .letter-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
  .letter-sub{font-size:12.5px;color:var(--muted);margin:0 0 10px;line-height:1.55}
  .letter-warn{font-size:12.5px;line-height:1.6;background:#fffaf0;border:1px solid #f3dfb0;color:#7a4b00;border-radius:10px;padding:11px 13px;margin:0 0 12px}
  .letter-foot{font-size:12px;color:var(--muted);margin:10px 0 0;line-height:1.55}
  #letter{width:100%;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.65;padding:14px;border:1px solid var(--line);border-radius:10px;background:#fff;color:inherit;resize:vertical}
  .btn-copy{background:var(--green-d);color:#fff;border:0;border-radius:9px;padding:9px 14px;font-size:13.5px;font-weight:700;cursor:pointer}
  .disclaimer{font-size:12.5px;color:var(--muted);line-height:1.6;margin:14px 0 0;max-width:78ch}
  .examples{padding:26px 0 6px}
  .examples h2{font-size:20px;margin:0 0 12px}
  .examples table{width:100%;border-collapse:collapse;font-size:13.5px;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .examples th,.examples td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line)}
  .examples th{font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);background:var(--bg)}
  .examples tbody tr:last-child td{border-bottom:none}
  .tbl-note{font-size:12.5px;color:var(--muted);margin-top:10px;line-height:1.55}
</style>`;

export function ukLatePaymentPage(): string {
  return renderToolPage({
    title: TITLE,
    description: DESC,
    canonicalPath: PATH,
    jsonLd: jsonLd(),
    headExtra: STYLE,
    bodyHtml: BODY,
    bodyEndScripts: "<script>(function(){" + PAGE_JS + "})();</script>",
  });
}

export const ukLatePaymentMeta = {
  slug: "uk-late-payment-calculator",
  path: PATH,
  title: "UK Late Payment Calculator",
  blurb:
    "Your UK client is late — work out the statutory interest and £40/£70/£100 compensation you can claim, and copy a letter before action.",
};
