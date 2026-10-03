/**
 * End-to-end check of the lead pipeline's REST API, against a local dev server
 * backed by the LOCAL test database (same guards and cleanup as e2e-smoke.mts).
 *
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/migrate-leads.ts
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest PORT=3000 npm run dev
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/e2e-leads.mts
 *
 * Signup is throttled to 5 per IP per 15 minutes; this uses two.
 */
import pg from "pg";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import { LOCAL_TEST_DATABASE_URL, requireLocalDatabaseUrl } from "./local-db-guard.ts";

const DATABASE_URL = requireLocalDatabaseUrl("e2e-leads.mts");
const BASE = "http://localhost:3000";
const STAMP = Date.now();
const A = { email: `e2e-leads-a-${STAMP}@dealinsec.invalid`, password: "E2ePass#2026", firstName: "Ann", lastName: "Owner" };
const B = { email: `e2e-leads-b-${STAMP}@dealinsec.invalid`, password: "E2ePass#2026", firstName: "Bob", lastName: "Owner" };

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; failures.push(`${name}${detail ? " — " + detail : ""}`); console.log(`  ✗ ${name}${detail ? "  [" + detail + "]" : ""}`); }
}

function jar() {
  let cookie = "";
  return {
    async req(method: string, path: string, body?: any) {
      const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
      for (const sc of (res.headers as any).getSetCookie?.() ?? []) { const pair = String(sc).split(";")[0]; if (pair.startsWith("connect.sid=") || !cookie) cookie = pair; }
      const text = await res.text();
      let json: any = null; try { json = JSON.parse(text); } catch { /* html */ }
      return { status: res.status, json, text: text.slice(0, 200) };
    },
  };
}
const a = jar(), b = jar(), anon = jar();

async function requireServerOnLocalDatabase() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const id = randomUUID(), email = `e2e-canary-${STAMP}@dealinsec.invalid`, password = `Canary#${STAMP}`;
  let outcome = "server unreachable";
  try {
    await pool.query(`INSERT INTO users (id,email,email_canonical,password) VALUES ($1,$2,$2,$3)`, [id, email, await bcrypt.hash(password, 10)]);
    try {
      const res = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }), redirect: "manual" });
      outcome = `login answered ${res.status}`;
      if (res.status === 200) return;
    } catch { /* unreachable */ }
  } finally { await pool.query(`DELETE FROM users WHERE id=$1`, [id]).catch(() => {}); await pool.end(); }
  console.error(`REFUSING: the server at ${BASE} is not using this script's local database (${outcome}).\n    DATABASE_URL=${LOCAL_TEST_DATABASE_URL} PORT=3000 npm run dev`);
  process.exit(1);
}

async function signup(j: ReturnType<typeof jar>, who: typeof A) {
  let r = await j.req("POST", "/api/auth/signup", who);
  check(`signup ${who.firstName}`, r.status === 200 || r.status === 201, `${r.status} ${r.text}`);
  r = await j.req("PATCH", "/api/profile", { phone: "9876543210", billingAddress: "12 Test Road, Darjeeling 734101", panNumber: "ABCDE1234F", gstNumber: "19ABCDE1234F1Z5", accountHolderName: "E2E", accountNumber: "1234567890", ifscCode: "HDFC0001234", bankName: "HDFC Bank", onboardingComplete: true });
  r = await j.req("GET", "/api/auth/user");
  return { id: r.json?.id as string, orgId: r.json?.organizationId as string };
}

async function main() {
  console.log("\n━━ 0. Access ━━");
  let r = await anon.req("GET", "/api/leads");
  check("signed out: 401", r.status === 401, `${r.status}`);

  const ua = await signup(a, A), ub = await signup(b, B);
  const ids = { users: [ua.id, ub.id], orgs: [ua.orgId, ub.orgId] };

  console.log("\n━━ 1. Create, dedupe, validate ━━");
  r = await a.req("POST", "/api/leads", { companyName: "Northwind Logistics", website: "https://www.northwind.com/about", industry: "Logistics", estValueMajor: 50000 });
  check("create a lead: 201, New, domain normalised", r.status === 201 && r.json?.lead?.status === "new" && r.json?.lead?.domain === "northwind.com", `${r.status} ${r.text}`);
  const lead = r.json?.lead;
  check("estimated value stored in minor units (₹50,000 = 5,000,000)", lead?.estValueMinor === 5_000_000 && lead?.currency === "INR", JSON.stringify(lead));
  check("source is manual", lead?.source === "manual");
  r = await a.req("POST", "/api/leads", { companyName: "Northwind Again", website: "northwind.com" });
  check("same website again: 409 duplicate with the existing id", r.status === 409 && r.json?.code === "duplicate" && r.json?.existingId === lead.id, `${r.status} ${r.text}`);
  r = await a.req("POST", "/api/leads", { companyName: "Another Co", contactEmail: "not an email" });
  check("bad contact email: 400", r.status === 400, `${r.status}`);
  r = await a.req("POST", "/api/leads", { companyName: "" });
  check("no company name: 400", r.status === 400);
  r = await a.req("POST", "/api/leads", { companyName: "Weird", website: "not a site" });
  check("bad website: 400", r.status === 400);
  r = await b.req("POST", "/api/leads", { companyName: "Northwind Logistics", website: "northwind.com" });
  check("the SAME company in ANOTHER organization is fine", r.status === 201, `${r.status} ${r.text}`);
  const bLead = r.json?.lead;
  r = await a.req("POST", "/api/leads/batch", { leads: [{ companyName: "Alpha", website: "alpha.example" }, { companyName: "Northwind Logistics", website: "northwind.com" }, { companyName: "Bravo" }] });
  check("batch: 2 created, 1 skipped as a duplicate", r.status === 201 && r.json?.created?.length === 2 && r.json?.skipped?.length === 1, `${r.status} ${r.text}`);

  console.log("\n━━ 2. Read & isolation ━━");
  r = await a.req("GET", "/api/leads");
  check("list: my 3 leads and stage counts", r.status === 200 && r.json?.total === 3 && r.json?.counts?.new === 3, `${r.status} total=${r.json?.total}`);
  r = await a.req("GET", "/api/leads?q=alpha");
  check("search by name", r.json?.total === 1);
  r = await a.req("GET", "/api/leads?status=bogus");
  check("bad status filter: 400", r.status === 400);
  r = await a.req("GET", `/api/leads/${bLead.id}`);
  check("another organization's lead: 404, same as unknown", r.status === 404, `${r.status}`);
  for (const [m, p, body] of [["PATCH", `/api/leads/${bLead.id}`, { industry: "x" }], ["POST", `/api/leads/${bLead.id}/move`, { status: "researching" }], ["POST", `/api/leads/${bLead.id}/notes`, { text: "hi" }], ["POST", `/api/leads/${bLead.id}/tickets`, { title: "x" }], ["POST", `/api/leads/${bLead.id}/claims`, { field: "headcount", value: "9", status: "inferred" }], ["POST", `/api/leads/${bLead.id}/convert`, { dealAmount: 100 }], ["POST", `/api/leads/${bLead.id}/archive`, {}]] as const) {
    const x = await a.req(m, p, body);
    check(`${m} ${p.split("/").slice(3).join("/") || "lead"} on a foreign lead: 404`, x.status === 404, `${x.status} ${x.text}`);
  }
  r = await b.req("GET", `/api/leads/${bLead.id}`);
  check("…and the foreign lead was left untouched", r.json?.lead?.status === "new" && r.json?.events?.length === 1);
  r = await a.req("GET", "/api/leads/abc");
  check("garbage id: 404", r.status === 404);

  console.log("\n━━ 3. Stages ━━");
  r = await a.req("POST", `/api/leads/${lead.id}/move`, { status: "won" });
  check("a plain move to won is refused (use convert)", r.status === 409 && r.json?.code === "use_convert", `${r.status} ${r.text}`);
  r = await a.req("POST", `/api/leads/${lead.id}/move`, { status: "meeting" });
  check("new → meeting is not allowed (and lists the allowed ones)", r.status === 409 && r.json?.code === "invalid_move" && Array.isArray(r.json?.allowed), `${r.status} ${r.text}`);
  r = await a.req("POST", `/api/leads/${lead.id}/move`, { status: "new" });
  check("moving to the same stage: 409", r.status === 409);
  r = await a.req("POST", `/api/leads/${lead.id}/convert`, { dealAmount: 1000 });
  check("a New lead can't be converted", r.status === 409 && r.json?.code === "not_convertible", `${r.status} ${r.text}`);
  for (const s of ["researching", "qualified"]) {
    r = await a.req("POST", `/api/leads/${lead.id}/move`, { status: s });
    check(`move to ${s}`, r.status === 200 && r.json?.lead?.status === s, `${r.status} ${r.text}`);
  }

  console.log("\n━━ 4. Notes, tickets, claims ━━");
  r = await a.req("POST", `/api/leads/${lead.id}/notes`, { text: "Spoke to ops; budget approved in Q4." });
  check("add a note", r.status === 201);
  r = await a.req("POST", `/api/leads/${lead.id}/notes`, { text: "   " });
  check("empty note: 400", r.status === 400);
  r = await a.req("POST", `/api/leads/${lead.id}/tickets`, { title: "Send intro email", kind: "intro", dueAt: "2026-10-09" });
  check("create a ticket with a due date", r.status === 201 && r.json?.ticket?.status === "open", `${r.status} ${r.text}`);
  const ticket = r.json?.ticket;
  r = await a.req("POST", `/api/leads/${lead.id}/tickets`, { title: "Bad date", dueAt: "not-a-date" });
  check("bad due date: 400", r.status === 400);
  r = await a.req("GET", "/api/leads");
  const row = r.json?.rows?.find((x: any) => x.id === lead.id);
  check("the list shows the next ticket", row?.nextTicket?.title === "Send intro email", JSON.stringify(row?.nextTicket));
  r = await a.req("PATCH", `/api/leads/${lead.id}/tickets/${ticket.id}`, { status: "done" });
  check("complete the ticket", r.status === 200 && r.json?.ticket?.status === "done");
  r = await a.req("PATCH", `/api/leads/${lead.id}/tickets/${ticket.id}`, { status: "done" });
  check("completing it again: 409", r.status === 409, `${r.status}`);
  console.log("\n━━ 4b. Follow-ups ━━");
  r = await a.req("POST", `/api/leads/${lead.id}/tickets`, { title: "Chase the old quote", dueAt: "2020-01-01" });
  const oldTicket = r.json?.ticket;
  r = await a.req("POST", `/api/leads/${lead.id}/tickets`, { title: "Far future step", dueAt: "2099-01-01" });
  r = await a.req("GET", "/api/leads/follow-ups");
  check("follow-ups: the route is not shadowed by /:id", r.status === 200 && Array.isArray(r.json?.overdue), `${r.status} ${r.text}`);
  check("an old open step is OVERDUE, with its lead", r.json?.overdue?.some((f: any) => f.id === oldTicket.id && f.companyName === "Northwind Logistics"), JSON.stringify(r.json?.overdue));
  check("a step years away is not listed", ![...(r.json?.overdue ?? []), ...(r.json?.dueToday ?? []), ...(r.json?.upcoming ?? [])].some((f: any) => f.title === "Far future step"));
  check("'today' is a plain date", /^\d{4}-\d{2}-\d{2}$/.test(r.json?.today ?? ""));
  r = await a.req("GET", "/api/leads/follow-ups?days=abc");
  check("a junk window falls back to the default instead of failing", r.status === 200);
  r = await b.req("GET", "/api/leads/follow-ups");
  check("another organization sees none of it", r.status === 200 && r.json?.overdue?.length === 0 && r.json?.upcoming?.length === 0, r.text);
  r = await anon.req("GET", "/api/leads/follow-ups");
  check("signed out: 401", r.status === 401);
  await a.req("PATCH", `/api/leads/${lead.id}/tickets/${oldTicket.id}`, { status: "done" });
  r = await a.req("GET", "/api/leads/follow-ups");
  check("a completed step leaves the list", !r.json?.overdue?.some((f: any) => f.id === oldTicket.id));

  r = await a.req("POST", `/api/leads/${lead.id}/claims`, { field: "headcount", value: "about 200", status: "confirmed" });
  check("a CONFIRMED fact with no source: 400", r.status === 400, `${r.status} ${r.text}`);
  r = await a.req("POST", `/api/leads/${lead.id}/claims`, { field: "headcount", value: "about 200", status: "inferred" });
  check("an inferred fact needs no source", r.status === 201);
  r = await a.req("POST", `/api/leads/${lead.id}/claims`, { field: "hiring", value: "hiring a designer", status: "confirmed", evidenceUrl: "https://northwind.com/careers", evidenceSnippet: "We are hiring a product designer" });
  check("a confirmed fact with URL and words is stored", r.status === 201);
  r = await a.req("POST", `/api/leads/${lead.id}/claims`, { field: "hiring", value: "x", status: "confirmed", evidenceUrl: "javascript:alert(1)", evidenceSnippet: "twelve chars+" });
  check("a javascript: evidence URL is refused", r.status === 400, `${r.status}`);
  r = await a.req("GET", `/api/leads/${lead.id}`);
  const d = r.json;
  check("detail: timeline, tickets, claims, allowed moves", r.status === 200 && d?.events?.length >= 6 && d?.tickets?.length === 3 && d?.claims?.length === 2 && r.json?.canConvert === true && Array.isArray(r.json?.moves), `${r.status} events=${d?.events?.length}`);

  console.log("\n━━ 5. Convert: one lead, one deal ━━");
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const dealsBefore = (await pool.query(`SELECT count(*)::int n FROM deals WHERE organization_id=$1`, [ua.orgId])).rows[0].n;
  const racers = await Promise.all([1, 2, 3, 4, 5].map(() => a.req("POST", `/api/leads/${lead.id}/convert`, {})));
  const okCount = racers.filter((x) => x.status === 200).length;
  check("5 simultaneous conversions: exactly one succeeds", okCount === 1, racers.map((x) => x.status).join(","));
  check("the others are refused cleanly (409), none 500", racers.filter((x) => x.status !== 200).every((x) => x.status === 409), racers.map((x) => x.status).join(","));
  const dealsAfter = (await pool.query(`SELECT id, brand_name, deal_amount, status FROM deals WHERE organization_id=$1`, [ua.orgId])).rows;
  check("exactly ONE deal was created", dealsAfter.length === dealsBefore + 1, `${dealsBefore} → ${dealsAfter.length}`);
  check("the deal is pending, for the lead's company, at ₹50,000 (minor units)", dealsAfter[0]?.brand_name === "Northwind Logistics" && Number(dealsAfter[0]?.deal_amount) === 5_000_000 && dealsAfter[0]?.status === "Pending", JSON.stringify(dealsAfter[0]));
  r = await a.req("GET", `/api/leads/${lead.id}`);
  check("the lead is Won and linked to that deal", r.json?.lead?.status === "won" && r.json?.lead?.convertedDealId === dealsAfter[0]?.id && r.json?.canConvert === false, JSON.stringify(r.json?.lead?.status));
  r = await a.req("POST", `/api/leads/${lead.id}/convert`, {});
  check("converting again: 409 already_converted", r.status === 409 && r.json?.code === "already_converted", `${r.status} ${r.text}`);
  r = await a.req("POST", `/api/leads/${lead.id}/move`, { status: "lost" });
  check("a won lead can't be moved", r.status === 409, `${r.status}`);
  r = await a.req("POST", `/api/leads/${lead.id}/archive`, {});
  check("a won lead can be archived (kept, hidden)", r.status === 200);

  console.log("\n━━ 6. Convert needs an amount; lost and reopen; archive ━━");
  const alpha = (await a.req("GET", "/api/leads?q=alpha")).json.rows[0];
  check("leads added by the batch route are marked as imports", alpha.source === "import", alpha.source);
  for (const s of ["researching", "qualified"]) await a.req("POST", `/api/leads/${alpha.id}/move`, { status: s });
  r = await a.req("POST", `/api/leads/${alpha.id}/convert`, {});
  check("no amount anywhere: 400 need_amount, nothing created, lead stays Qualified", r.status === 400 && r.json?.code === "need_amount", `${r.status} ${r.text}`);
  check("…and the lead is not stuck 'converting'", (await pool.query(`SELECT converting, status FROM leads WHERE id=$1`, [alpha.id])).rows[0]?.converting === false);
  r = await a.req("POST", `/api/leads/${alpha.id}/convert`, { dealAmount: 12000, dealTitle: "Alpha site" });
  check("with an amount it converts", r.status === 200, `${r.status} ${r.text}`);
  const bravo = (await a.req("GET", "/api/leads?q=bravo")).json.rows[0];
  r = await a.req("POST", `/api/leads/${bravo.id}/move`, { status: "lost", lostReason: "No budget this year" });
  check("mark lost with a reason", r.status === 200 && r.json?.lead?.lostReason === "No budget this year");
  r = await a.req("POST", `/api/leads/${bravo.id}/tickets`, { title: "Chase" });
  check("a lost lead takes no new tickets: 409", r.status === 409);
  r = await a.req("POST", `/api/leads/${bravo.id}/move`, { status: "new" });
  check("a lost lead can be reopened to New", r.status === 200 && r.json?.lead?.status === "new" && r.json?.lead?.lostReason == null);
  r = await a.req("POST", `/api/leads/${bravo.id}/archive`, {});
  check("archive", r.status === 200);
  r = await a.req("GET", "/api/leads");
  check("an archived lead leaves the list", !r.json?.rows?.some((x: any) => x.id === bravo.id));
  r = await a.req("POST", "/api/leads", { companyName: "Bravo again" });
  check("…and its name is free to use again", r.status === 201);

  console.log("\n━━ 7. Nothing leaked, nothing orphaned ━━");
  const stuck = (await pool.query(`SELECT count(*)::int n FROM leads WHERE converting = true AND organization_id = ANY($1)`, [ids.orgs])).rows[0].n;
  check("no lead left stuck in 'converting'", stuck === 0);
  const orph = (await pool.query(`SELECT (SELECT count(*)::int FROM lead_events e WHERE NOT EXISTS (SELECT 1 FROM leads l WHERE l.id=e.lead_id AND l.organization_id=e.organization_id)) ev, (SELECT count(*)::int FROM lead_tickets t WHERE NOT EXISTS (SELECT 1 FROM leads l WHERE l.id=t.lead_id AND l.organization_id=t.organization_id)) tk`)).rows[0];
  check("every event and ticket belongs to a lead in the same organization", orph.ev === 0 && orph.tk === 0, JSON.stringify(orph));
  const textInEvents = (await pool.query(`SELECT count(*)::int n FROM lead_events WHERE kind <> 'note' AND data::text ILIKE '%budget%'`)).rows[0].n;
  check("non-note events hold ids and stages only, not free text", textInEvents === 0);
  await pool.end();
  return ids;
}

async function cleanup(_ids: any) {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const c = await pool.connect();
  // Found by email, not by ids main() may never have returned (an aborted run still cleans up).
  const found = await c.query(`SELECT id, organization_id FROM users WHERE email LIKE 'e2e-leads-%@dealinsec.invalid'`);
  const ids = { users: found.rows.map((x) => x.id), orgs: [...new Set(found.rows.map((x) => x.organization_id).filter(Boolean))] };
  for (const o of ids.orgs) for (const t of ["lead_claims", "lead_tickets", "lead_events", "leads"]) await c.query(`DELETE FROM ${t} WHERE organization_id=$1`, [o]).catch(() => {});
  for (const u of ids.users) for (const q of [`DELETE FROM activity_logs WHERE user_id=$1`, `DELETE FROM deals WHERE user_id=$1`]) await c.query(q, [u]).catch(() => {});
  for (const o of ids.orgs) for (const t of ["activity_logs", "invoice_counters", "org_invitations", "invitations"]) await c.query(`DELETE FROM ${t} WHERE organization_id=$1`, [o]).catch(() => {});
  await c.query(`DELETE FROM users WHERE email LIKE 'e2e-leads-%@dealinsec.invalid'`).catch(() => {});
  for (const o of ids.orgs) { await c.query(`DELETE FROM org_roles WHERE organization_id=$1`, [o]).catch(() => {}); await c.query(`DELETE FROM organizations WHERE id=$1`, [o]).catch(() => {}); }
  const left = await c.query(`SELECT (SELECT count(*)::int FROM leads) leads, (SELECT count(*)::int FROM users WHERE email LIKE '%dealinsec.invalid') leftover`);
  console.log("\n━━ cleanup ━━\n ", left.rows[0]);
  c.release(); await pool.end();
}

await requireServerOnLocalDatabase();
let ids: any = null;
try { ids = await main(); } catch (e: any) { console.log("\nRUN ABORTED:", e?.message); fail++; failures.push("run aborted: " + e?.message); }
finally {
  await cleanup(ids);
  console.log(`\n═══ ${pass} passed, ${fail} failed ═══`);
  if (failures.length) { console.log("\nFAILURES:"); failures.forEach((f) => console.log("  ·", f)); }
  process.exit(fail ? 1 : 0);
}
