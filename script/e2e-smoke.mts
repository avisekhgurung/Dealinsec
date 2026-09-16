/**
 * End-to-end smoke of the whole money path, against a local dev server backed
 * by the LOCAL test database.
 *
 * Drives the real HTTP API exactly as the browser does — signup, onboarding,
 * deal, quotation, agreement, invoice, payment, undo, team permissions, DPDP
 * export/erasure — then deletes everything it made.
 *
 * LOCAL ONLY. Dev and production share one Neon database, and a dev server
 * started with plain `npm run dev` reads `.env`, which points at it. So this
 * script refuses a non-local DATABASE_URL, then proves the server writes to
 * that same local database (requireServerOnLocalDatabase) before any signup.
 *
 * Run against the DEV server. The production build marks the session cookie
 * Secure, so it cannot be set over plain HTTP on localhost — that is correct
 * behaviour, not a failure; production over HTTPS is verified separately.
 *
 * Money is sent in MINOR units under the new field names (dealAmountMinor,
 * contractValueMinor, rateMinor/amountMinor). The rupee-era names are sent on
 * purpose in two checks, to prove the server refuses them rather than storing
 * a rupee figure in a paise column.
 *
 * Signup is rate-limited to 5 per IP per 15 minutes, so back-to-back runs will
 * fail at step 1 with a 429. That is the brute-force throttle working. Wait it
 * out rather than "fixing" it.
 *
 * Run (the `dealinsec-local-db` launch config starts the server exactly so):
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest PORT=3000 npm run dev
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/e2e-smoke.mts
 */
import pg from "pg";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import { LOCAL_TEST_DATABASE_URL, inr, requireLocalDatabaseUrl } from "./local-db-guard.ts";
import { isoDateInZone } from "../shared/invoice-numbering.ts";
import { financialYearCode } from "../shared/schema.ts";

// First statement that runs: nothing below may touch a database or the API
// until the URL is known to be local.
const DATABASE_URL = requireLocalDatabaseUrl("e2e-smoke.mts");

const BASE = "http://localhost:3000";
const STAMP = Date.now();
const OWNER = { email: `e2e-owner-${STAMP}@dealinsec.invalid`, password: "E2ePass#2026", firstName: "Eee", lastName: "Owner" };
const MEMBER = { email: `e2e-member-${STAMP}@dealinsec.invalid`, password: "E2ePass#2026" };
const UK_OWNER = { email: `e2e-owner-uk-${STAMP}@dealinsec.invalid`, password: "E2ePass#2026", firstName: "Uk", lastName: "Owner" };

let pass = 0, fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(`${name}${detail ? " — " + detail : ""}`); console.log(`  ✗ ${name}${detail ? "  [" + detail + "]" : ""}`); }
}

/** Minimal cookie jar so a session survives across calls. */
function jar() {
  let cookie = "";
  return {
    get cookie() { return cookie; },
    async req(method: string, path: string, body?: any, raw = false) {
      const res = await fetch(BASE + path, {
        method,
        headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
      });
      // Node's fetch needs getSetCookie(); headers.get("set-cookie") joins
      // multiple cookies into one ambiguous string and loses the session.
      const setCookies = (res.headers as any).getSetCookie?.() ?? [];
      for (const sc of setCookies) {
        const pair = String(sc).split(";")[0];
        if (pair.startsWith("connect.sid=") || !cookie) cookie = pair;
      }
      const text = await res.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch { /* html */ }
      return { status: res.status, json, text: raw ? text : text.slice(0, 200), headers: res.headers };
    },
  };
}

const owner = jar();
const member = jar();

/**
 * Exits unless the server at BASE reads the same database as DATABASE_URL.
 *
 * requireLocalDatabaseUrl only vouches for THIS process. The server under test
 * has its own DATABASE_URL, and if it came from `.env` every signup, deal and
 * invoice below would be written among production's real deals. A throwaway
 * login is planted directly in the local database, and the server must accept
 * it. A server on any other database has never seen that row and answers 401,
 * before the smoke has made a single write through the API.
 */
async function requireServerOnLocalDatabase(): Promise<void> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const id = randomUUID();
  const email = `e2e-canary-${STAMP}@dealinsec.invalid`;
  const password = `Canary#${STAMP}`;
  let outcome = "server unreachable";
  try {
    await pool.query(
      `INSERT INTO users (id,email,email_canonical,password) VALUES ($1,$2,$2,$3)`,
      [id, email, await bcrypt.hash(password, 10)],
    );
    try {
      const res = await fetch(BASE + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        redirect: "manual",
      });
      outcome = `login answered ${res.status}`;
      if (res.status === 200) return;
    } catch { /* outcome stays "server unreachable" */ }
  } finally {
    await pool.query(`DELETE FROM users WHERE id=$1`, [id]).catch(() => {});
    await pool.end();
  }
  console.error(
    `REFUSING: the server at ${BASE} is not using this script's local database (${outcome}).\n` +
    `Start it with the same DATABASE_URL this script was given, then re-run. For the standard local DB:\n` +
    `    DATABASE_URL=${LOCAL_TEST_DATABASE_URL} PORT=3000 npm run dev`,
  );
  process.exit(1);
}

async function main() {
  console.log(`\n━━ 1. Account creation & onboarding ━━`);
  let r = await owner.req("POST", "/api/auth/signup", OWNER);
  check("signup returns 200/201", r.status === 200 || r.status === 201, `got ${r.status} ${r.text}`);

  r = await owner.req("GET", "/api/auth/user");
  const ownerId = r.json?.id, orgId = r.json?.organizationId;
  check("session established", r.status === 200 && !!ownerId, `status ${r.status}`);
  check("organization auto-created", !!orgId);

  check("password never returned by the API", !("password" in (r.json || {})));

  r = await owner.req("PATCH", "/api/profile", {
    phone: "9876543210", billingAddress: "12 Test Road, Darjeeling 734101",
    panNumber: "ABCDE1234F", gstNumber: "19ABCDE1234F1Z5",
    accountHolderName: "Eee Owner", accountNumber: "1234567890", ifscCode: "HDFC0001234", bankName: "HDFC Bank",
    onboardingComplete: true,
  });
  check("profile/onboarding saves", r.status === 200, `got ${r.status} ${r.text}`);

  r = await owner.req("GET", "/api/auth/user");
  check("7-day trial granted once onboarding completes",
    !!r.json?.trialEndsAt || r.json?.entitlements?.trial === true,
    `trialEndsAt=${r.json?.trialEndsAt} trial=${r.json?.entitlements?.trial}`);

  // Every amount below is INR paise. India is the default, and a new account
  // that silently landed on another currency would break the "zero visible
  // change for India" promise before any of the money checks could notice.
  r = await owner.req("GET", "/api/org");
  check("new organisation defaults to India / INR",
    r.json?.country === "IN" && r.json?.currency === "INR" && r.json?.locale === "en-IN",
    `country=${r.json?.country} currency=${r.json?.currency} locale=${r.json?.locale}`);

  console.log(`\n━━ 2. Deal → Quotation ━━`);
  const dealBody = {
    brandName: "E2E Client", dealTitle: "Office interior fitout",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
    dealType: "service", status: "Pending",
    deliverables: [{ platform: "Site", contentType: "Design", quantity: 1 }],
    // The currency the amounts were converted in. The server refuses a money
    // write that does not declare it — omitting it here is what let a release
    // ship in which EVERY write 409'd. The next check pins that down.
    currency: "INR",
  };
  // A tab opened before the deploy still posts rupees as `dealAmount`. It must
  // be refused by name, never stored as 1/100th of the deal.
  r = await owner.req("POST", "/api/deals", { ...dealBody, dealAmount: 200000 });
  check("stale rupee field (dealAmount) is refused", r.status === 422 && r.json?.code === "STALE_CLIENT",
    `got ${r.status} ${r.text}`);

  // REGRESSION GUARD: a write with no currency must be refused, and a write
  // WITH it must succeed. One release had the server demanding this field and
  // no client sending it, which silently broke every save in the product.
  const { currency: _omit, ...noCurrency } = dealBody;
  r = await owner.req("POST", "/api/deals", { ...noCurrency, dealAmountMinor: inr(200000) });
  check("money write without a currency is refused", r.status === 409 && r.json?.code === "CURRENCY_CHANGED",
    `got ${r.status} ${r.text}`);

  r = await owner.req("POST", "/api/deals", { currency: "INR", ...dealBody, dealAmountMinor: inr(200000) });
  const dealId = r.json?.id;
  check("deal created", (r.status === 200 || r.status === 201) && !!dealId, `got ${r.status} ${r.text}`);
  check("deal amount stored in minor units", r.json?.dealAmountMinor === inr(200000),
    `got ${r.json?.dealAmountMinor}`);

  r = await owner.req("POST", `/api/deals/${dealId}/quote`, {});
  check("quotation generated", r.status === 200 || r.status === 201, `got ${r.status} ${r.text}`);

  r = await owner.req("GET", `/api/deals/${dealId}/quote`);
  check("quotation readable", r.status === 200 && !!r.json?.id, `got ${r.status}`);

  console.log(`\n━━ 3. Agreement + execution record ━━`);
  r = await owner.req("POST", "/api/contracts", {
    dealId, brandName: "E2E Client", contractName: "E2E Client - Office interior fitout",
    contractValueMinor: inr(200000),
    currency: "INR",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
    status: "Signed",
  });
  const contractId = r.json?.id;
  check("agreement created", (r.status === 200 || r.status === 201) && !!contractId, `got ${r.status} ${r.text}`);
  check("signer snapshotted at creation", !!r.json?.signerUserId && !!r.json?.signerName,
    `signerUserId=${r.json?.signerUserId} signerName=${r.json?.signerName}`);
  check("signer is the creator, not a live lookup", r.json?.signerUserId === ownerId);

  console.log(`\n━━ 4. Invoice composer + money guards ━━`);
  r = await owner.req("POST", "/api/brand-invoices", {
    currency: "INR",
    dealId, contractId, brandName: "E2E Client", dealAmountMinor: inr(120000),
    invoiceDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
    notes: "Phase 1",
    lineItems: [
      { description: "Design & drawings", hsnSac: "9954", quantity: 1, rateMinor: inr(80000), amountMinor: inr(80000) },
      { description: "Site supervision", quantity: 2, rateMinor: inr(20000), amountMinor: inr(40000) },
    ],
  });
  const invoiceId = r.json?.id;
  check("invoice created with line items", (r.status === 200 || r.status === 201) && !!invoiceId, `got ${r.status} ${r.text}`);
  check("FY invoice number format INV-YYYY-NNNN", /^INV-\d{4}-\d{4}$/.test(r.json?.invoiceNumber || ""), `got ${r.json?.invoiceNumber}`);
  {
    // The period is India's financial year read in IST — the same clock as the
    // default invoice date below. Rebuilt as a mid-month local date, exactly as
    // shared/invoice-numbering.ts does, so this agrees whatever zone runs it.
    const [y, m] = isoDateInZone("Asia/Kolkata").split("-").map(Number);
    const fy = financialYearCode(new Date(y, m - 1, 15));
    check("Indian number carries the IST financial-year code", (r.json?.invoiceNumber || "").startsWith(`INV-${fy}-`),
      `expected INV-${fy}-…, got ${r.json?.invoiceNumber}`);
  }
  check("line items persisted", Array.isArray(r.json?.lineItems) && r.json.lineItems.length === 2,
    `got ${JSON.stringify(r.json?.lineItems)?.slice(0, 60)}`);
  check("invoice total and lines stored in minor units",
    r.json?.dealAmountMinor === inr(120000) && r.json?.lineItems?.[0]?.amountMinor === inr(80000)
      && r.json?.lineItems?.[1]?.rateMinor === inr(20000) && r.json?.lineItems?.[1]?.quantity === 2,
    `total=${r.json?.dealAmountMinor} lines=${JSON.stringify(r.json?.lineItems)?.slice(0, 120)}`);
  check("due date persisted", !!r.json?.dueDate);
  const firstNumber = r.json?.invoiceNumber;

  r = await owner.req("POST", "/api/brand-invoices", { currency: "INR", dealId, contractId, brandName: "E2E Client", dealAmountMinor: inr(500000) });
  check("cannot invoice beyond the agreement value", r.status === 400, `got ${r.status} ${r.text}`);

  r = await owner.req("POST", "/api/brand-invoices", {
    currency: "INR",
    dealId, contractId, brandName: "E2E Client", dealAmountMinor: inr(5000),
    lineItems: [{ description: "x", quantity: 1, rateMinor: inr(10), amountMinor: inr(10) }],
  });
  check("line items must sum to the total", r.status === 400, `got ${r.status} ${r.text}`);

  // The lines DO add up here (in rupees), so a 400 can only come from the
  // rupee-era `rate`/`amount` keys being refused.
  r = await owner.req("POST", "/api/brand-invoices", {
    currency: "INR",
    dealId, contractId, brandName: "E2E Client", dealAmountMinor: inr(5000),
    lineItems: [{ description: "x", quantity: 1, rate: 5000, amount: 5000 }],
  });
  check("stale line item keys (rate/amount) are refused", r.status === 400, `got ${r.status} ${r.text}`);

  r = await owner.req("POST", "/api/brand-invoices", { currency: "INR", dealId, contractId, brandName: "E2E Client", dealAmountMinor: 0 });
  check("zero amount rejected", r.status === 400, `got ${r.status}`);

  // Minor units are integers by definition; a fraction here means a caller
  // did major→minor wrong, and Postgres would otherwise truncate it silently.
  r = await owner.req("POST", "/api/brand-invoices", { currency: "INR", dealId, contractId, brandName: "E2E Client", dealAmountMinor: 125050.5 });
  check("fractional minor units rejected", r.status === 400, `got ${r.status} ${r.text}`);

  r = await owner.req("POST", "/api/brand-invoices", {
    currency: "INR",
    dealId, contractId, brandName: "E2E Client", dealAmountMinor: inr(1000), organizationId: "hijacked-org", userId: "hijacked-user",
  });
  check("tenancy fields are not client-writable",
    r.status !== 200 || (r.json?.organizationId === orgId && r.json?.userId === ownerId),
    `org=${r.json?.organizationId}`);
  const secondInvoiceId = r.json?.id;

  r = await owner.req("POST", "/api/brand-invoices", { currency: "INR", dealId, contractId, brandName: "E2E Client", dealAmountMinor: inr(5000) });
  check("invoice numbers increment", r.json?.invoiceNumber !== firstNumber && /^INV-\d{4}-\d{4}$/.test(r.json?.invoiceNumber || ""),
    `first=${firstNumber} next=${r.json?.invoiceNumber}`);
  const thirdInvoiceId = r.json?.id;

  console.log(`\n━━ 5. Payment + undo ━━`);
  r = await owner.req("PATCH", `/api/brand-invoices/${invoiceId}`, { status: "Paid" });
  check("mark as paid", r.status === 200 && r.json?.status === "Paid", `got ${r.status} ${r.text}`);

  r = await owner.req("PATCH", `/api/brand-invoices/${invoiceId}`, { currency: "INR", dealAmountMinor: inr(1) });
  check("paid invoice amount is locked", r.status === 400, `got ${r.status} ${r.text}`);

  r = await owner.req("PATCH", `/api/brand-invoices/${invoiceId}`, { dealAmount: 1 });
  check("stale rupee edit is refused before the paid lock", r.status === 422 && r.json?.code === "STALE_CLIENT",
    `got ${r.status} ${r.text}`);

  r = await owner.req("PATCH", `/api/brand-invoices/${invoiceId}`, { status: "Unpaid" });
  check("payment can be undone", r.status === 200 && r.json?.status === "Unpaid", `got ${r.status}`);

  console.log(`\n━━ 6. Team & permissions ━━`);
  r = await owner.req("GET", "/api/org/roles");
  const roles = Array.isArray(r.json) ? r.json : [];
  check("default roles seeded", roles.length >= 3, `got ${roles.length}`);
  const names = roles.map((x: any) => x.name);
  check("no duplicate role names", new Set(names).size === names.length, names.join(","));

  const invoiceOnly = roles.find((x: any) =>
    Array.isArray(x.permissions) && x.permissions.includes("invoices.create") && !x.permissions.includes("deals.create"));
  check("an invoice-only role exists to test with", !!invoiceOnly, names.join(","));

  r = await owner.req("POST", "/api/org/invitations", { email: MEMBER.email, orgRole: "CUSTOM", customRoleId: invoiceOnly?.id });
  check("invite created", r.status === 200 || r.status === 201, `got ${r.status} ${r.text}`);

  console.log(`\n━━ 6b. Second organisation (multi-tenant collision) ━━`);
  const org2 = jar();
  const OWNER2 = { email: `e2e-owner2-${STAMP}@dealinsec.invalid`, password: "E2ePass#2026", firstName: "Two", lastName: "Owner" };
  r = await org2.req("POST", "/api/auth/signup", OWNER2);
  check("second org signs up", r.status === 200 || r.status === 201, `got ${r.status}`);
  await org2.req("PATCH", "/api/profile", { phone: "9000000000", onboardingComplete: true });

  r = await org2.req("POST", "/api/deals", { currency: "INR",
    brandName: "Second Client", dealTitle: "Second job", dealAmountMinor: inr(50000),
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
    dealType: "service", status: "Pending", deliverables: [],
  });
  const deal2 = r.json?.id;
  r = await org2.req("POST", "/api/contracts", { currency: "INR",
    dealId: deal2, brandName: "Second Client", contractName: "Second Client - Second job",
    contractValueMinor: inr(50000),
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
    status: "Signed",
  });
  const contract2 = r.json?.id;
  r = await org2.req("POST", "/api/brand-invoices", { currency: "INR", dealId: deal2, contractId: contract2, brandName: "Second Client", dealAmountMinor: inr(25000) });
  check("second org's FIRST invoice succeeds", r.status === 200 || r.status === 201, `got ${r.status} ${r.text}`);
  check("both orgs may hold INV-…-0001", /^INV-\d{4}-0001$/.test(r.json?.invoiceNumber || ""), `got ${r.json?.invoiceNumber}`);

  console.log(`\n━━ 6c. A UK organisation (calendar-year numbering, region lock) ━━`);
  const uk = jar();
  r = await uk.req("POST", "/api/auth/signup", UK_OWNER);
  check("UK org signs up", r.status === 200 || r.status === 201, `got ${r.status}`);
  // Onboarding's order: the org first, then the owner's own row.
  const ukRegion = { country: "GB", currency: "GBP", locale: "en-GB", timezone: "Europe/London" };
  r = await uk.req("PATCH", "/api/org", ukRegion);
  check("UK region saves on an org with no records", r.status === 200 && r.json?.country === "GB", `got ${r.status} ${r.text}`);
  await uk.req("PATCH", "/api/profile", { ...ukRegion, phone: "7700900123", onboardingComplete: true });

  r = await uk.req("POST", "/api/deals", { currency: "GBP",
    brandName: "UK Client", dealTitle: "Brand refresh", dealAmountMinor: 125050, // £1,250.50 in pence
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
    dealType: "service", status: "Pending", deliverables: [],
  });
  const ukDeal = r.json?.id;
  check("UK deal created", !!ukDeal, `got ${r.status} ${r.text}`);
  r = await uk.req("POST", "/api/contracts", { currency: "GBP",
    dealId: ukDeal, brandName: "UK Client", contractName: "UK Client - Brand refresh",
    contractValueMinor: 125050,
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
    status: "Signed",
  });
  const ukContract = r.json?.id;
  check("UK agreement stamped GBP", !!ukContract && r.json?.currency === "GBP", `got ${r.status} currency=${r.json?.currency}`);
  // No invoiceDate sent: the server's default must be today in the ORG's zone.
  r = await uk.req("POST", "/api/brand-invoices", { currency: "GBP", dealId: ukDeal, contractId: ukContract, brandName: "UK Client", dealAmountMinor: 50000 });
  const ukYear = isoDateInZone("Europe/London").slice(0, 4);
  check("UK first invoice is calendar-year INV-YYYY-0001", r.json?.invoiceNumber === `INV-${ukYear}-0001`,
    `expected INV-${ukYear}-0001, got ${r.status} ${r.json?.invoiceNumber}`);
  check("UK invoice stamped GBP", r.json?.currency === "GBP", `got ${r.json?.currency}`);
  check("default invoice date is today in the org's zone", r.json?.invoiceDate === isoDateInZone("Europe/London"),
    `expected ${isoDateInZone("Europe/London")}, got ${r.json?.invoiceDate}`);

  // Once records exist the WHOLE region locks — the Settings screen disables
  // all of it to match — and re-sending the stored values is not a change.
  r = await uk.req("PATCH", "/api/org", { ...ukRegion, timezone: "America/New_York" });
  check("region change refused once the org has records", r.status === 409 && r.json?.code === "REGION_LOCKED",
    `got ${r.status} ${r.text}`);
  r = await uk.req("PATCH", "/api/org", ukRegion);
  check("re-sending the stored region is allowed", r.status === 200, `got ${r.status} ${r.text}`);

  r = await org2.req("GET", "/api/brand-invoices");
  const org2Sees = Array.isArray(r.json) ? r.json : [];
  check("second org cannot see the first org's invoices",
    !org2Sees.some((i: any) => i.brandName === "E2E Client"), `saw ${org2Sees.map((i: any) => i.brandName).join(",")}`);

  r = await org2.req("GET", `/api/deals/${dealId}`);
  check("cross-tenant deal read is refused", r.status === 403 || r.status === 404, `got ${r.status}`);

  console.log(`\n━━ 7. DPDP rights ━━`);
  r = await owner.req("GET", "/api/account/export", undefined, true);
  let exported: any = null;
  try { exported = JSON.parse(r.text); } catch { /* */ }
  check("data export returns JSON", r.status === 200 && !!exported, `got ${r.status}`);
  check("export attaches as a file", (r.headers.get("content-disposition") || "").includes("attachment"));
  check("export contains the deal", Array.isArray(exported?.deals) && exported.deals.length >= 1);
  check("export excludes the password hash", exported && !("password" in (exported.profile || {})));

  r = await owner.req("DELETE", "/api/account", { confirm: "nope" });
  check("erasure needs explicit confirmation", r.status === 400, `got ${r.status}`);

  console.log(`\n━━ 8. Unauthenticated surface ━━`);
  const anon = jar();
  for (const p of ["/api/deals", "/api/contracts", "/api/brand-invoices", "/api/org/issuer", "/api/account/export"]) {
    const rr = await anon.req("GET", p);
    check(`${p} requires auth`, rr.status === 401, `got ${rr.status}`);
  }
  const up = await anon.req("GET", "/uploads/anything.png");
  check("/uploads requires auth", up.status === 401, `got ${up.status}`);

  const pub = await anon.req("POST", "/api/copilot/public", { messages: [{ role: "user", content: "what does it cost?" }] });
  check("public copilot answers without an account", pub.status === 200 && !!pub.json?.reply, `got ${pub.status}`);
  check("public copilot leaks no customer data", !JSON.stringify(pub.json || {}).includes("E2E Client"));

  console.log(`\n━━ 9. Public pages ━━`);
  for (const p of ["/", "/terms", "/privacy", "/refund", "/pricing", "/tools/gst-invoice-generator", "/tools/quotation-maker", "/sitemap.xml", "/robots.txt"]) {
    const rr = await anon.req("GET", p, undefined, true);
    check(`${p} serves 200`, rr.status === 200, `got ${rr.status}`);
  }
  const landing = await anon.req("GET", "/", undefined, true);
  const ssr = landing.text.includes("<h1>") && landing.text.includes("FAQPage");
  // serveStatic only runs in the production build; the Vite dev server serves
  // the bare shell, so this is informational when running against dev.
  if (ssr) check("landing ships crawlable content", true);
  else console.log("  – landing SSR not applicable (dev server; verified on the production build)");

  return { ownerId, orgId, dealId, contractId };
}

async function cleanup(ids: any) {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const c = await pool.connect();
  const emails = [OWNER.email, MEMBER.email, `e2e-owner2-${STAMP}@dealinsec.invalid`, UK_OWNER.email];
  const rows = (await c.query(`SELECT id, organization_id FROM users WHERE email = ANY($1)`, [emails])).rows;
  const users = rows.map((x) => x.id);
  const orgIds = [...new Set(rows.map((x) => x.organization_id).filter(Boolean).concat(ids?.orgId ? [ids.orgId] : []))];
  for (const u of users) {
    await c.query(`DELETE FROM invitations WHERE invited_by=$1`, [u]).catch(() => {});
    await c.query(`DELETE FROM activity_logs WHERE user_id=$1`, [u]).catch(() => {});
    for (const q of [
      `DELETE FROM invoice_attachments WHERE brand_invoice_id IN (SELECT id FROM brand_invoices WHERE user_id=$1)`,
      `DELETE FROM brand_invoices WHERE user_id=$1`, `DELETE FROM invoices WHERE user_id=$1`,
      `DELETE FROM contracts WHERE user_id=$1`, `DELETE FROM quotes WHERE user_id=$1`, `DELETE FROM deals WHERE user_id=$1`,
    ]) await c.query(q, [u]).catch(() => {});
  }
  for (const o of orgIds) {
    await c.query(`DELETE FROM activity_logs WHERE organization_id=$1`, [o]).catch(() => {});
    await c.query(`DELETE FROM org_invitations WHERE organization_id=$1`, [o]).catch(() => {});
    await c.query(`DELETE FROM invitations WHERE organization_id=$1`, [o]).catch(() => {});
    await c.query(`DELETE FROM invoice_counters WHERE organization_id=$1`, [o]).catch(() => {});
  }
  await c.query(`DELETE FROM users WHERE email = ANY($1)`, [emails]).catch(() => {});
  for (const o of orgIds) {
    await c.query(`DELETE FROM org_roles WHERE organization_id=$1`, [o]).catch(() => {});
    await c.query(`DELETE FROM organizations WHERE id=$1`, [o]).catch(() => {});
  }
  const left = await c.query(`
    SELECT (SELECT count(*)::int FROM users) users,
           (SELECT count(*)::int FROM organizations) orgs,
           (SELECT count(*)::int FROM users WHERE email LIKE '%dealinsec.invalid') leftover,
           (SELECT count(*)::int FROM deals WHERE brand_name='E2E Client') stray_deals`);
  console.log("\n━━ cleanup ━━");
  console.log(" ", left.rows[0]);
  c.release(); await pool.end();
}

// Outside the try: a refusal must exit before cleanup() runs, since nothing
// was created and cleanup would be one more write to a database not proven local.
await requireServerOnLocalDatabase();

let ids: any = null;
try {
  ids = await main();
} catch (e: any) {
  console.log("\nRUN ABORTED:", e?.message);
  fail++; failures.push("run aborted: " + e?.message);
} finally {
  await cleanup(ids);
  console.log(`\n═══ ${pass} passed, ${fail} failed ═══`);
  if (failures.length) { console.log("\nFAILURES:"); failures.forEach((f) => console.log("  ·", f)); }
  process.exit(fail ? 1 : 0);
}
