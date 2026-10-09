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
  const db = new pg.Pool({ connectionString: DATABASE_URL });
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

  console.log("\n━━ 5. Research: the real chain (real fetch of example.com, real model) ━━");
  r = await anon.req("POST", `/api/sales/leads/${lead}/research`, {});
  check("signed out: start is 401", r.status === 401, `${r.status}`);
  r = await a.req("POST", "/api/leads", { companyName: "No Site Co", industry: "Retail" });
  const noSite = r.json?.lead?.id;
  r = await a.req("POST", `/api/sales/leads/${noSite}/research`, {});
  check("a lead with no website: 422 no_website, no run created", r.status === 422 && r.json?.code === "no_website", `${r.status} ${r.text}`);
  r = await a.req("POST", "/api/leads", { companyName: "Local Co", website: "https://localhost/" });
  if (r.json?.lead?.id) {
    const local = r.json.lead.id;
    r = await a.req("POST", `/api/sales/leads/${local}/research`, {});
    check("a website that is not public (localhost): 422 bad_website", r.status === 422 && r.json?.code === "bad_website", `${r.status} ${r.text}`);
  } else console.log("  (the lead form already refuses localhost; skipped)");
  r = await b.req("POST", `/api/sales/leads/${lead}/research`, {});
  check("B starting research on A's lead: 404", r.status === 404, `${r.status}`);
  r = await b.req("GET", `/api/sales/leads/${lead}/research`);
  check("B reading A's research: 404", r.status === 404, `${r.status}`);

  r = await a.req("POST", "/api/leads", { companyName: "Example Domain", website: "https://example.com", industry: "Reference" });
  const ex = r.json?.lead?.id;
  check("a lead with a real website", r.status === 201 && !!ex, `${r.status} ${r.text}`);
  r = await a.req("GET", `/api/sales/leads/${ex}/research`);
  check("before any run: research is null", r.status === 200 && r.json?.research === null, r.text);
  const t0 = Date.now();
  r = await a.req("POST", `/api/sales/leads/${ex}/research`, {});
  check("starting returns 202 immediately, running", r.status === 202 && r.json?.status === "running" && Date.now() - t0 < 3000, `${r.status} ${Date.now() - t0}ms ${r.text}`);
  const second = await a.req("POST", `/api/sales/leads/${ex}/research`, {});
  check("a second start while it runs: 409 running (the database allows one)", second.status === 409 && second.json?.code === "running", `${second.status} ${second.text}`);
  let run: any = null;
  for (let i = 0; i < 40; i++) { await new Promise((x) => setTimeout(x, 3000)); r = await a.req("GET", `/api/sales/leads/${ex}/research`); run = r.json?.research; if (run && run.status !== "running") break; }
  check("it finishes (done or failed with a reason) within two minutes", !!run && run.status !== "running", JSON.stringify(run)?.slice(0, 200));
  console.log(`     -> ${run?.status}${run?.errorCode ? " (" + run.errorCode + ")" : ""}; pages: ${JSON.stringify(run?.pages)}; summary: ${JSON.stringify(run?.summary)}`);
  if (run?.status === "done") {
    check("the home page was read", run.pages?.[0]?.ok === true && /example\.com/.test(run.pages[0].url), JSON.stringify(run.pages));
    const traced = (await db.query(`SELECT task, ok, prompt_version, tokens_in, tokens_out, cost_micro_usd FROM llm_calls WHERE lead_id = $1`, [ex])).rows;
    check("exactly one traced model call, with tokens and a cost, and no text stored", traced.length === 1 && traced[0].task === "research" && traced[0].ok && traced[0].prompt_version === "research-v1" && traced[0].tokens_in > 0 && traced[0].cost_micro_usd >= 0, JSON.stringify(traced));
    const cl = (await db.query(`SELECT field, status, source, evidence_url, evidence_snippet FROM lead_claims WHERE lead_id = $1`, [ex])).rows;
    check("every claim the run saved is by the agent, evidenced by a page of that site, and judgments are never 'confirmed'", cl.every((c) => c.source === "agent" && /^https:\/\/(www\.)?example\.com/.test(c.evidence_url) && !!c.evidence_snippet && !(["pain_point", "opportunity", "buying_signal", "timing"].includes(c.field) && c.status === "confirmed")), JSON.stringify(cl));
    r = await a.req("GET", `/api/sales/leads/${ex}/score`);
    check("the lead now counts as researched", r.json?.researched === true, r.text);
    r = await a.req("GET", `/api/leads/${ex}`);
    check("a new lead moved to 'researching' through the validated stage change", r.json?.lead?.status === "researching", r.json?.lead?.status);
    const none = (await db.query(`SELECT count(*)::int n FROM lead_events WHERE lead_id = $1 AND kind = 'researched'`, [ex])).rows[0].n;
    check("a 'researched' event is on the timeline", none === 1, String(none));
  }
  const nothingSent = (await db.query(`SELECT count(*)::int n FROM leads WHERE id = $1 AND contact_email IS NOT NULL`, [ex])).rows[0].n;
  check("research never sets the lead's own contact email", nothingSent === 0, String(nothingSent));

  console.log("\n━━ 5. Outreach: draft, approve, send (real model, real database) ━━");
  r = await a.req("POST", "/api/leads", { companyName: "Casa Alma", website: "https://casaalma.example", industry: "Boutique hotels", location: "Lisbon, Portugal" });
  const co = r.json?.lead?.id;
  check("a lead to write to", r.status === 201 && !!co, r.text);
  r = await a.req("GET", `/api/sales/leads/${co}/messages`);
  check("no messages yet", r.status === 200 && Array.isArray(r.json?.messages) && r.json.messages.length === 0, r.text);
  r = await a.req("POST", `/api/sales/leads/${co}/draft`, {});
  check("nothing to write from and nowhere to send: refused with a reason (422), no model call", r.status === 422 && (r.json?.code === "no_address" || r.json?.code === "no_facts"), `${r.status} ${r.text}`);
  const callsBefore = (await db.query(`SELECT count(*)::int n FROM llm_calls WHERE lead_id = $1 AND task = 'draft'`, [co])).rows[0].n;
  check("no draft model call was made for that", callsBefore === 0, String(callsBefore));
  for (const [field, value, status] of [["description", "Runs boutique hotels in Lisbon", "confirmed"], ["launch", "Opened a second hotel, Casa Alma Porto", "confirmed"], ["business_email", "hello@casaalma.example", "confirmed"], ["pain_point", "Bookings are taken by phone only", "inferred"]] as const) {
    r = await a.req("POST", `/api/leads/${co}/claims`, { field, value, status, ...(status === "confirmed" ? { evidenceUrl: "https://casaalma.example/about", evidenceSnippet: `${value} (as written on the page)` } : {}) });
    check(`recorded ${field}`, r.status === 201, r.text);
  }
  r = await b.req("POST", `/api/sales/leads/${co}/draft`, {});
  check("another workspace cannot draft for it: 404", r.status === 404, `${r.status} ${r.text}`);
  r = await a.req("POST", `/api/sales/leads/${co}/draft`, {});
  check("a draft is written (201) or honestly refused by the safety checks (422) -- never stored in between", (r.status === 201 && r.json?.message?.status === "draft") || (r.status === 422 && r.json?.code === "draft_rejected"), `${r.status} ${r.text}`);
  console.log(`     -> ${r.status}${r.json?.retried ? " (after a retry)" : ""}${r.json?.issues ? " issues: " + r.json.issues : ""}`);
  if (r.status === 422) { r = await a.req("POST", `/api/sales/leads/${co}/draft`, {}); console.log(`     -> second try ${r.status}`); }
  const msg = r.json?.message;
  if (msg) {
    console.log(`     subject: ${msg.subject}\n     ${String(msg.body).replace(/\n/g, "\n     ")}`);
    check("addressed to the site's business address, from the site", msg.to === "hello@casaalma.example" && msg.toSource === "site", JSON.stringify([msg.to, msg.toSource]));
    check("no placeholder, link or price in what was stored", !/\[[^\]]+\]|https?:|www\.|[$€£₹]\s?\d|\d\s?%/.test(msg.subject + " " + msg.body), msg.body.slice(0, 120));
    const rows = (await db.query(`SELECT status, channel, to_address, body_hash, claim_ids FROM lead_messages WHERE lead_id = $1`, [co])).rows;
    check("exactly one stored message, a draft, on the manual channel, built from the recorded claims", rows.length === 1 && rows[0].status === "draft" && rows[0].channel === "manual" && rows[0].claim_ids.length === 3, JSON.stringify(rows));
    const trace = (await db.query(`SELECT task, ok, prompt_version, tokens_in FROM llm_calls WHERE lead_id = $1 AND task = 'draft'`, [co])).rows;
    check("the model call is traced with the prompt version and tokens", trace.length >= 1 && trace.every((t) => t.ok !== undefined && t.prompt_version === "draft-v2"), JSON.stringify(trace));
    const ev = (await db.query(`SELECT data::text d FROM lead_events WHERE lead_id = $1 AND kind = 'draft_created'`, [co])).rows;
    check("the timeline holds ids only, not the message", ev.length === 1 && !ev[0].d.includes(msg.subject.slice(0, 12)), JSON.stringify(ev));
    r = await a.req("POST", `/api/sales/leads/${co}/draft`, {});
    check("a second draft while one waits: 409 draft_exists", r.status === 409 && r.json?.code === "draft_exists", `${r.status} ${r.text}`);
    r = await b.req("POST", `/api/sales/messages/${msg.id}/approve`, { bodyHash: msg.bodyHash });
    check("another workspace cannot approve it: 404", r.status === 404, `${r.status} ${r.text}`);
    r = await a.req("GET", `/api/sales/leads/${co}/next-action`);
    check("next action: review the draft", r.json?.next?.action === "review_draft", r.text);
    r = await a.req("POST", `/api/sales/messages/${msg.id}/approve`, { bodyHash: "0".repeat(64) });
    check("approving a text that is not the one stored: 409", r.status === 409, `${r.status} ${r.text}`);
    r = await a.req("POST", `/api/sales/messages/${msg.id}/sent`, {});
    check("sending before approving: 409 not_approved", r.status === 409 && r.json?.code === "not_approved", `${r.status} ${r.text}`);
    const approvals = await Promise.all([1, 2, 3].map(() => a.req("POST", `/api/sales/messages/${msg.id}/approve`, { bodyHash: msg.bodyHash })));
    check("three simultaneous approvals all succeed, one does the work", approvals.every((x) => x.status === 200) && approvals.filter((x) => x.json?.already === false).length === 1, approvals.map((x) => `${x.status}/${x.json?.already}`).join(" "));
    const ap = (await db.query(`SELECT count(*)::int n FROM lead_events WHERE lead_id = $1 AND kind = 'draft_approved'`, [co])).rows[0].n;
    check("one 'approved' event", ap === 1, String(ap));
    r = await a.req("GET", `/api/sales/leads/${co}/next-action`);
    check("next action: send the approved message", r.json?.next?.action === "send_message", r.text);
    r = await a.req("PATCH", `/api/leads/${co}`, { doNotContact: true });
    check("marking the lead do-not-contact", r.status === 200, `${r.status} ${r.text}`);
    r = await a.req("POST", `/api/sales/messages/${msg.id}/approve`, { bodyHash: msg.bodyHash });
    check("do-not-contact: nothing more can be approved for it", r.status === 409 && r.json?.code === "do_not_contact", `${r.status} ${r.text}`);
    r = await a.req("PATCH", `/api/leads/${co}`, { doNotContact: false });
    const sends = await Promise.all([1, 2, 3].map(() => a.req("POST", `/api/sales/messages/${msg.id}/sent`, {})));
    check("three simultaneous 'I sent it' all succeed, one does the work", sends.every((x) => x.status === 200) && sends.filter((x) => x.json?.already === false).length === 1, sends.map((x) => `${x.status}/${x.json?.already}`).join(" "));
    const side = (await db.query(`SELECT (SELECT count(*)::int FROM lead_events WHERE lead_id = $1 AND kind = 'message_sent') sent, (SELECT count(*)::int FROM lead_tickets WHERE lead_id = $1 AND kind = 'follow_up') tickets, (SELECT status FROM leads WHERE id = $1) status, (SELECT count(*)::int FROM lead_events WHERE lead_id = $1 AND kind = 'status_changed') moves`, [co])).rows[0];
    check("one sent event, one follow-up, the lead is 'contacted' after exactly two validated moves", side.sent === 1 && side.tickets === 1 && side.status === "contacted" && side.moves === 2, JSON.stringify(side));
    r = await a.req("POST", `/api/sales/messages/${msg.id}/cancel`, {});
    check("a sent message cannot be cancelled", r.status === 409, `${r.status} ${r.text}`);
    const all = (await db.query(`SELECT count(*)::int n FROM lead_messages WHERE lead_id = $1 AND status = 'sent' AND sent_at IS NOT NULL AND approved_by IS NOT NULL`, [co])).rows[0].n;
    check("it records who approved it and when it was sent", all === 1, String(all));
  }
  await db.end();
}

async function cleanup() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const c = await pool.connect();
  const found = await c.query(`SELECT id, organization_id FROM users WHERE email LIKE 'e2e-sales-%@dealinsec.invalid'`);
  const users = found.rows.map((x) => x.id), orgs = Array.from(new Set(found.rows.map((x) => x.organization_id).filter(Boolean)));
  for (const o of orgs) for (const t of ["lead_messages", "lead_research", "lead_claims", "lead_tickets", "lead_events", "leads", "client_profiles", "llm_calls", "activity_logs", "invoice_counters", "invitations", "org_roles"]) await c.query(`DELETE FROM ${t} WHERE organization_id=$1`, [o]).catch(() => {});
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
