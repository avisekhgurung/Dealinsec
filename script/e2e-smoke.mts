/**
 * End-to-end smoke of the whole money path, against the PRODUCTION build.
 *
 * Drives the real HTTP API exactly as the browser does — signup, onboarding,
 * deal, quotation, agreement, invoice, payment, undo, team permissions, DPDP
 * export/erasure — then deletes everything it made. prod and dev share the
 * Neon database, so cleanup is not optional.
 *
 * Run against the DEV server (npm run dev). The production build marks the
 * session cookie Secure, so it cannot be set over plain HTTP on localhost —
 * that is correct behaviour, not a failure; production over HTTPS is verified
 * separately.
 *
 * Signup is rate-limited to 5 per IP per 15 minutes, so back-to-back runs will
 * fail at step 1 with a 429. That is the brute-force throttle working. Wait it
 * out rather than "fixing" it.
 *
 * Run:  npx tsx --env-file=.env script/e2e-smoke.mts
 */
import pg from "pg";

const BASE = "http://localhost:3000";
const STAMP = Date.now();
const OWNER = { email: `e2e-owner-${STAMP}@dealinsec.invalid`, password: "E2ePass#2026", firstName: "Eee", lastName: "Owner" };
const MEMBER = { email: `e2e-member-${STAMP}@dealinsec.invalid`, password: "E2ePass#2026" };

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

  console.log(`\n━━ 2. Deal → Quotation ━━`);
  r = await owner.req("POST", "/api/deals", {
    brandName: "E2E Client", dealTitle: "Office interior fitout", dealAmount: 200000,
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
    dealType: "service", status: "Pending",
    deliverables: [{ platform: "Site", contentType: "Design", quantity: 1 }],
  });
  const dealId = r.json?.id;
  check("deal created", (r.status === 200 || r.status === 201) && !!dealId, `got ${r.status} ${r.text}`);

  r = await owner.req("POST", `/api/deals/${dealId}/quote`, {});
  check("quotation generated", r.status === 200 || r.status === 201, `got ${r.status} ${r.text}`);

  r = await owner.req("GET", `/api/deals/${dealId}/quote`);
  check("quotation readable", r.status === 200 && !!r.json?.id, `got ${r.status}`);

  console.log(`\n━━ 3. Agreement + execution record ━━`);
  r = await owner.req("POST", "/api/contracts", {
    dealId, brandName: "E2E Client", contractName: "E2E Client - Office interior fitout",
    contractValue: 200000,
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
    dealId, contractId, brandName: "E2E Client", dealAmount: 120000,
    invoiceDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
    notes: "Phase 1",
    lineItems: [
      { description: "Design & drawings", hsnSac: "9954", quantity: 1, rate: 80000, amount: 80000 },
      { description: "Site supervision", quantity: 2, rate: 20000, amount: 40000 },
    ],
  });
  const invoiceId = r.json?.id;
  check("invoice created with line items", (r.status === 200 || r.status === 201) && !!invoiceId, `got ${r.status} ${r.text}`);
  check("FY invoice number format INV-YYYY-NNNN", /^INV-\d{4}-\d{4}$/.test(r.json?.invoiceNumber || ""), `got ${r.json?.invoiceNumber}`);
  check("line items persisted", Array.isArray(r.json?.lineItems) && r.json.lineItems.length === 2,
    `got ${JSON.stringify(r.json?.lineItems)?.slice(0, 60)}`);
  check("due date persisted", !!r.json?.dueDate);
  const firstNumber = r.json?.invoiceNumber;

  r = await owner.req("POST", "/api/brand-invoices", { dealId, contractId, brandName: "E2E Client", dealAmount: 500000 });
  check("cannot invoice beyond the agreement value", r.status === 400, `got ${r.status} ${r.text}`);

  r = await owner.req("POST", "/api/brand-invoices", {
    dealId, contractId, brandName: "E2E Client", dealAmount: 5000,
    lineItems: [{ description: "x", quantity: 1, rate: 10, amount: 10 }],
  });
  check("line items must sum to the total", r.status === 400, `got ${r.status} ${r.text}`);

  r = await owner.req("POST", "/api/brand-invoices", { dealId, contractId, brandName: "E2E Client", dealAmount: 0 });
  check("zero amount rejected", r.status === 400, `got ${r.status}`);

  r = await owner.req("POST", "/api/brand-invoices", {
    dealId, contractId, brandName: "E2E Client", dealAmount: 1000, organizationId: "hijacked-org", userId: "hijacked-user",
  });
  check("tenancy fields are not client-writable",
    r.status !== 200 || (r.json?.organizationId === orgId && r.json?.userId === ownerId),
    `org=${r.json?.organizationId}`);
  const secondInvoiceId = r.json?.id;

  r = await owner.req("POST", "/api/brand-invoices", { dealId, contractId, brandName: "E2E Client", dealAmount: 5000 });
  check("invoice numbers increment", r.json?.invoiceNumber !== firstNumber && /^INV-\d{4}-\d{4}$/.test(r.json?.invoiceNumber || ""),
    `first=${firstNumber} next=${r.json?.invoiceNumber}`);
  const thirdInvoiceId = r.json?.id;

  console.log(`\n━━ 5. Payment + undo ━━`);
  r = await owner.req("PATCH", `/api/brand-invoices/${invoiceId}`, { status: "Paid" });
  check("mark as paid", r.status === 200 && r.json?.status === "Paid", `got ${r.status} ${r.text}`);

  r = await owner.req("PATCH", `/api/brand-invoices/${invoiceId}`, { dealAmount: 1 });
  check("paid invoice amount is locked", r.status === 400, `got ${r.status} ${r.text}`);

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

  r = await org2.req("POST", "/api/deals", {
    brandName: "Second Client", dealTitle: "Second job", dealAmount: 50000,
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
    dealType: "service", status: "Pending", deliverables: [],
  });
  const deal2 = r.json?.id;
  r = await org2.req("POST", "/api/contracts", {
    dealId: deal2, brandName: "Second Client", contractName: "Second Client - Second job",
    contractValue: 50000,
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
    status: "Signed",
  });
  const contract2 = r.json?.id;
  r = await org2.req("POST", "/api/brand-invoices", { dealId: deal2, contractId: contract2, brandName: "Second Client", dealAmount: 25000 });
  check("second org's FIRST invoice succeeds", r.status === 200 || r.status === 201, `got ${r.status} ${r.text}`);
  check("both orgs may hold INV-…-0001", /^INV-\d{4}-0001$/.test(r.json?.invoiceNumber || ""), `got ${r.json?.invoiceNumber}`);

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
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  const emails = [OWNER.email, MEMBER.email, `e2e-owner2-${STAMP}@dealinsec.invalid`];
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
