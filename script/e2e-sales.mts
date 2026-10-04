/**
 * End-to-end check of the sales agent's REST API, against a local dev server backed by the LOCAL test
 * database (same guards and cleanup as e2e-knowledge.mts).
 *
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest PORT=3000 npm run dev
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/e2e-sales.mts
 *
 * Signup is throttled to 5 per IP per 15 minutes; this uses two (restart the dev server to clear it).
 */
import pg from "pg";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import { LOCAL_TEST_DATABASE_URL, requireLocalDatabaseUrl } from "./local-db-guard.ts";

const DATABASE_URL = requireLocalDatabaseUrl("e2e-sales.mts");
const BASE = "http://localhost:3000";
const STAMP = Date.now();
const PW = `E2e#${STAMP}`;
const A = { email: `e2e-sales-a-${STAMP}@dealinsec.invalid`, password: PW, firstName: "Ann", lastName: "Owner" };
const B = { email: `e2e-sales-b-${STAMP}@dealinsec.invalid`, password: PW, firstName: "Bob", lastName: "Owner" };

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
      let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ }
      return { status: res.status, json, text: text.slice(0, 220) };
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
  console.error(`REFUSING: the server at ${BASE} is not using the local test database (${outcome}).\n    DATABASE_URL=${LOCAL_TEST_DATABASE_URL} PORT=3000 npm run dev`);
  process.exit(1);
}

async function signup(j: ReturnType<typeof jar>, who: typeof A) {
  let r = await j.req("POST", "/api/auth/signup", who);
  check(`signup ${who.firstName}`, r.status === 200 || r.status === 201, `${r.status} ${r.text}`);
  r = await j.req("GET", "/api/auth/user");
  return { id: r.json?.id as string, orgId: r.json?.organizationId as string };
}
const comp = (s: any, k: string) => s?.components?.find((c: any) => c.key === k);

async function main() {
  console.log("\n━━ 0. Access ━━");
  let r: any = await anon.req("GET", "/api/sales/leads/1/score");
  check("signed out: score is 401", r.status === 401, `${r.status}`);
  r = await anon.req("GET", "/api/sales/leads/1/next-action");
  check("signed out: next action is 401", r.status === 401);
  await signup(a, A); await signup(b, B);

  console.log("\n━━ 1. A bare lead ━━");
  r = await a.req("POST", "/api/leads", { companyName: "Casa Alma", industry: "Boutique hotels", location: "Lisbon, Portugal", website: "https://casaalma.example" });
  const lead = r.json?.lead?.id;
  check("lead created", r.status === 201 && !!lead, `${r.status} ${r.text}`);
  r = await a.req("GET", `/api/sales/leads/${lead}/score`);
  check("score: 0 of 100, everything unknown, low confidence, and it says what is missing", r.status === 200 && r.json?.score?.total === 0 && r.json.score.knownMax === 0 && r.json.score.unknownPoints === 100 && r.json.score.confidence === "low" && r.json.score.missing.length >= 5, r.text);
  check("every component is unknown (null), none is a low mark", r.json?.score?.components?.length === 6 && r.json.score.components.every((c: any) => c.points === null), r.text);
  r = await a.req("GET", `/api/sales/leads/${lead}/next-action`);
  check("next action: research it (nothing researched yet), with a reason", r.status === 200 && r.json?.next?.action === "research" && !!r.json.next.reason, r.text);

  console.log("\n━━ 2. Facts change the score ━━");
  await a.req("PUT", "/api/ideal-client", { targetIndustries: ["hotels"], targetLocations: ["Portugal"] });
  r = await a.req("POST", `/api/leads/${lead}/claims`, { field: "pain_point", value: "Outdated booking page", status: "confirmed", evidenceUrl: "https://casaalma.example/book", evidenceSnippet: "Book by phone or email only" });
  check("a confirmed claim with evidence is accepted", r.status === 201, `${r.status} ${r.text}`);
  r = await a.req("POST", `/api/leads/${lead}/claims`, { field: "buying_signal", value: "Opened a second hotel", status: "inferred" });
  await a.req("POST", `/api/leads/${lead}/claims`, { field: "timing", value: "", status: "unknown" });
  await a.req("POST", `/api/leads/${lead}/claims`, { field: "favourite_colour", value: "green", status: "inferred" });
  await a.req("PATCH", `/api/leads/${lead}`, { contactEmail: "hello@casaalma.example" });
  r = await a.req("GET", `/api/sales/leads/${lead}/score`);
  const s = r.json?.score;
  check("fit 20 (strong, from the ideal client), need 25 (confirmed), signal 10 (inferred), contact 6", comp(s, "fit")?.points === 20 && comp(s, "need")?.points === 25 && comp(s, "signal")?.points === 10 && comp(s, "contact")?.points === 6, JSON.stringify(s?.components?.map((c: any) => [c.key, c.points])));
  check("an 'unknown' claim and a field outside the rubric add nothing", comp(s, "timing")?.points === null && s?.total === 61, `total ${s?.total}`);
  check("the need component names the claim it rests on", (comp(s, "need")?.evidenceClaimIds ?? []).length === 1 && /Confirmed/.test(comp(s, "need")?.reason ?? ""));
  check("total is never above what could be measured, and the parts add up", s.total <= s.knownMax && s.knownMax + s.unknownPoints === 100 && s.total === s.components.reduce((n: number, c: any) => n + (c.points ?? 0), 0));
  r = await a.req("GET", `/api/sales/leads/${lead}/next-action`);
  check("next action is still 'research': facts a PERSON typed do not count as the agent having researched it", r.status === 200 && r.json?.next?.action === "research", r.text);

  console.log("\n━━ 3. Do not contact ━━");
  await a.req("PATCH", `/api/leads/${lead}`, { doNotContact: true });
  r = await a.req("GET", `/api/sales/leads/${lead}/score`);
  check("contactability becomes 0 'Marked do not contact'", comp(r.json?.score, "contact")?.points === 0 && /do not contact/i.test(comp(r.json.score, "contact").reason), r.text);
  r = await a.req("GET", `/api/sales/leads/${lead}/next-action`);
  check("next action is none, blocked by do_not_contact", r.json?.next?.action === "none" && r.json.next.blockedBy === "do_not_contact", r.text);
  await a.req("PATCH", `/api/leads/${lead}`, { doNotContact: false });

  console.log("\n━━ 4. One workspace cannot see another's ━━");
  r = await b.req("GET", `/api/sales/leads/${lead}/score`);
  check("B asking for A's lead score: 404", r.status === 404, `${r.status}`);
  r = await b.req("GET", `/api/sales/leads/${lead}/next-action`);
  check("B asking for A's next action: 404", r.status === 404, `${r.status}`);
  for (const bad of ["abc", "0", "-1", "1.5", "99999999"]) {
    r = await a.req("GET", `/api/sales/leads/${bad}/score`);
    check(`a bad id (${bad}): 404, not an error`, r.status === 404, `${r.status}`);
  }
  r = await a.req("POST", `/api/leads/${lead}/archive`, {});
  r = await a.req("GET", `/api/sales/leads/${lead}/next-action`);
  check("an archived lead: none, blocked by archived", r.json?.next?.action === "none" && r.json.next.blockedBy === "archived", r.text);
}

async function cleanup() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const c = await pool.connect();
  const found = await c.query(`SELECT id, organization_id FROM users WHERE email LIKE 'e2e-sales-%@dealinsec.invalid'`);
  const users = found.rows.map((x) => x.id), orgs = Array.from(new Set(found.rows.map((x) => x.organization_id).filter(Boolean)));
  for (const o of orgs) for (const t of ["lead_claims", "lead_tickets", "lead_events", "leads", "client_profiles", "llm_calls", "activity_logs", "invoice_counters", "invitations", "org_roles"]) await c.query(`DELETE FROM ${t} WHERE organization_id=$1`, [o]).catch(() => {});
  for (const u of users) await c.query(`DELETE FROM activity_logs WHERE user_id=$1`, [u]).catch(() => {});
  await c.query(`DELETE FROM users WHERE email LIKE 'e2e-sales-%@dealinsec.invalid'`).catch(() => {});
  for (const o of orgs) await c.query(`DELETE FROM organizations WHERE id=$1`, [o]).catch(() => {});
  const left = await c.query(`SELECT count(*)::int leftover FROM users WHERE email LIKE 'e2e-sales-%'`);
  console.log("\n━━ cleanup ━━\n ", left.rows[0]);
  c.release(); await pool.end();
}

await requireServerOnLocalDatabase();
try { await main(); } catch (e: any) { console.log("\nRUN ABORTED:", e?.message); fail++; failures.push("run aborted: " + e?.message); }
finally {
  await cleanup();
  console.log(`\n═══ ${pass} passed, ${fail} failed ═══`);
  if (failures.length) { console.log("\nFAILURES:"); failures.forEach((f) => console.log("  ·", f)); }
  process.exit(fail ? 1 : 0);
}
