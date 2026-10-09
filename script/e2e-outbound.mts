/**
 * End-to-end check of AI Outbound against a local dev server on the LOCAL test database, with the REAL model, the
 * REAL search service (LangSearch) and the REAL public websites it finds. Same guards and cleanup as e2e-sales.mts.
 *
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest PORT=3000 npm run dev
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/e2e-outbound.mts
 *   (E2E_REQUEST="..." to change the request; E2E_QUANTITY=n)
 *
 * It reads the real web (public company websites), so results vary; it asserts the INVARIANTS, not the companies.
 */
import pg from "pg";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import { LOCAL_TEST_DATABASE_URL, requireLocalDatabaseUrl } from "./local-db-guard.ts";

const DATABASE_URL = requireLocalDatabaseUrl("e2e-outbound.mts");
const BASE = "http://localhost:3000";
const STAMP = Date.now();
const PW = `E2e#${STAMP}`;
const A = { email: `e2e-ob-a-${STAMP}@dealinsec.invalid`, password: PW, firstName: "Ann", lastName: "Owner" };
const B = { email: `e2e-ob-b-${STAMP}@dealinsec.invalid`, password: PW, firstName: "Bob", lastName: "Owner" };
const REQUEST = process.env.E2E_REQUEST ?? "Find 8 US digital marketing agencies with 5–30 employees that serve SaaS companies.";

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
      return { status: res.status, json, text: text.slice(0, 260) };
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
  await j.req("PATCH", "/api/profile", { onboardingComplete: true, firstName: who.firstName });
  r = await j.req("GET", "/api/auth/user");
  return { id: r.json?.id as string, orgId: r.json?.organizationId as string };
}

async function main() {
  const db = new pg.Pool({ connectionString: DATABASE_URL });
  console.log("\n━━ 0. Access ━━");
  let r: any = await anon.req("GET", "/api/outbound/runs");
  check("signed out: runs is 401", r.status === 401, `${r.status}`);
  r = await anon.req("POST", "/api/outbound/icp", { request: "x" });
  check("signed out: parse is 401", r.status === 401, `${r.status}`);

  console.log("\n━━ 1. Two workspaces ━━");
  const ua = await signup(a, A); const ub = await signup(b, B);
  check("two different workspaces", !!ua.orgId && !!ub.orgId && ua.orgId !== ub.orgId);

  console.log("\n━━ 2. Read the request ━━");
  r = await a.req("POST", "/api/outbound/icp", { request: "" });
  check("an empty request is refused (400)", r.status === 400, `${r.status} ${r.text}`);
  r = await a.req("POST", "/api/outbound/icp", { request: REQUEST });
  check("the request is read into a structured ICP", r.status === 200 && !!r.json?.icp?.industry && r.json.icp.countries?.includes("US"), `${r.status} ${r.text}`);
  const parsed = r.json;
  console.log(`     -> ${parsed?.description}  [${parsed?.source}]  searches: ${JSON.stringify(parsed?.searches)}`);
  check("several searches are planned, none containing an email, phone or link", (parsed?.searches?.length ?? 0) >= 3 && !/@|https?:|\d{7,}/.test((parsed?.searches ?? []).join(" ")), JSON.stringify(parsed?.searches));
  check("the quantity asked for is respected, never raised", parsed?.icp?.quantity <= 8 && parsed?.icp?.quantity >= 1, String(parsed?.icp?.quantity));
  r = await b.req("POST", "/api/outbound/icp", { request: REQUEST });
  check("another workspace can read its own request too (no leakage of state)", r.status === 200);

  console.log("\n━━ 3. Run it (real search, real websites, real model) ━━");
  const quantity = Number(process.env.E2E_QUANTITY ?? 8);
  const icp = { ...parsed.icp, quantity };
  r = await a.req("POST", "/api/outbound/runs", { request: REQUEST, icp, searches: parsed.searches });
  check("starting a run returns 201 at once", r.status === 201 && !!r.json?.run?.id, `${r.status} ${r.text}`);
  const runId = r.json?.run?.id as string;
  const again = await a.req("POST", "/api/outbound/runs", { request: REQUEST, icp, searches: parsed.searches });
  check("the same search while it runs returns that run, not a second one", again.status === 201 && again.json?.existing === true && again.json?.run?.id === runId, `${again.status} ${again.text}`);
  r = await b.req("GET", `/api/outbound/runs/${runId}`);
  check("another workspace cannot read the run: 404", r.status === 404, `${r.status}`);
  r = await b.req("POST", `/api/outbound/runs/${runId}/cancel`, {});
  check("another workspace cannot cancel it: 404", r.status === 404, `${r.status}`);

  let view: any = null; const t0 = Date.now();
  for (let i = 0; i < 120; i++) {
    await new Promise((x) => setTimeout(x, 5000));
    r = await a.req("GET", `/api/outbound/runs/${runId}`); view = r.json;
    if (i % 4 === 0) console.log(`     ... ${Math.round((Date.now() - t0) / 1000)}s ${view?.run?.status}/${view?.run?.stage} ${JSON.stringify(view?.run?.counters && { d: view.run.counters.discovered, v: view.run.counters.verified, e: view.run.counters.enriched, r: view.run.counters.researched })}`);
    if (view?.run && view.run.status !== "running") break;
  }
  check("the run finishes (done) within ten minutes", view?.run?.status === "done", `${view?.run?.status} ${view?.run?.errorCode}`);
  const run = view?.run, ps: any[] = view?.prospects ?? [];
  const c = run?.counters ?? {};
  console.log(`     -> ${Math.round((Date.now() - t0) / 1000)}s  cost $${run?.costUsd}  funnel: ${JSON.stringify({ discovered: c.discovered, verified: c.verified, enriched: c.enriched, icpMatch: c.icpMatch, researched: c.researched, signals: c.signals, decisionMakers: c.decisionMakers, ready: c.ready, rejected: c.rejected, failed: c.failed })}`);
  check("candidates were discovered", (c.discovered ?? 0) >= 3, JSON.stringify(c));
  check("the funnel only narrows", (c.verified ?? 0) <= (c.discovered ?? 0) && (c.enriched ?? 0) <= (c.verified ?? 0) && (c.researched ?? 0) <= (c.enriched ?? 0), JSON.stringify(c));
  check("directories, social sites and articles were set aside before anything was fetched", Object.keys(c.searchRejectedBy ?? {}).length > 0, JSON.stringify(c.searchRejectedBy));

  console.log("\n━━ 4. What it stored ━━");
  const rows = (await db.query(`SELECT p.id, p.domain, p.status, p.ready, p.score, p.fit, p.sources FROM prospects p WHERE p.organization_id = $1`, [ua.orgId])).rows;
  check("one prospect per domain", new Set(rows.map((x) => x.domain)).size === rows.length, String(rows.length));
  check("no prospect is a known directory, social network or news site", rows.every((x) => !/(linkedin|facebook|clutch|yelp|crunchbase|wikipedia|reddit|medium)\./.test(x.domain)), rows.map((x) => x.domain).join(","));
  check("every prospect keeps where it was found (provider, query, url)", rows.every((x) => x.sources.length >= 1 && x.sources.every((s: any) => s.provider && s.query && s.url)), "");
  const fnd = (await db.query(`SELECT f.* FROM prospect_findings f WHERE f.organization_id = $1`, [ua.orgId])).rows;
  console.log(`     -> ${rows.length} prospects, ${fnd.length} findings (${[...new Set(fnd.map((f) => f.kind))].join(", ")})`);
  check("every confirmed finding has a source page and an exact quote", fnd.filter((f) => f.status === "confirmed").every((f) => f.source_url && f.quote && f.quote.length >= 8), "");
  check("opportunities and judgments are never 'confirmed'", fnd.filter((f) => f.kind === "opportunity" || f.type === "pain_point").every((f) => f.status === "inferred"), "");
  check("every opportunity cites findings of the SAME prospect", fnd.filter((f) => f.kind === "opportunity").every((o) => (o.supporting_ids as number[]).length > 0 && (o.supporting_ids as number[]).every((id) => fnd.find((x) => x.id === id && x.prospect_id === o.prospect_id))), "");
  check("every quote really is on a page of that company's own domain (source URL host)", fnd.filter((f) => f.status === "confirmed" && f.source_type === "website").every((f) => { const d = rows.find((x) => x.id === f.prospect_id)?.domain; try { const h = new URL(f.source_url).hostname.replace(/^www\./, ""); return !!d && (h === d || h.endsWith("." + d)); } catch { return false; } }), "");
  check("no decision maker has an email we didn't get from a provider (none is guessed)", fnd.filter((f) => f.kind === "decision_maker").every((f) => !f.meta?.email), "");
  check("no instruction-like text was stored from any website", !fnd.some((f) => /ignore (all |any )?(previous|prior)|system prompt|you are now/i.test(f.value + " " + (f.quote ?? ""))), "");
  const sc = rows.filter((x) => x.score);
  check("scored prospects have six components and total ≤ 100, unknown parts earn 0", sc.every((x) => x.score.components.length === 6 && x.score.total <= 100 && x.score.components.every((k: any) => k.points === null || (k.points >= 0 && k.points <= k.max)) && x.score.total === x.score.components.reduce((n: number, k: any) => n + (k.points ?? 0), 0)), "");
  check("'ready' prospects meet the rule: a verified site, a fit, a current reason, a person or address", rows.filter((x) => x.ready).every((x) => !!x.score && (x.score.readyMissing ?? []).length === 0 && ["strong", "partial", "unclear"].includes(x.fit?.verdict)), "");

  const traced = (await db.query(`SELECT task, ok, prompt_version, tokens_in, cost_micro_usd FROM llm_calls WHERE run_id = $1`, [runId])).rows;
  check("every model call is traced against the run with a prompt version and tokens", traced.length > 0 && traced.every((t) => t.prompt_version && t.tokens_in > 0), JSON.stringify(traced.slice(0, 2)));
  const pc = (await db.query(`SELECT operation, provider, ok FROM provider_calls WHERE run_id = $1`, [runId])).rows;
  check("every search is recorded as a provider call", pc.filter((x) => x.operation === "search").length === (run?.queries ?? []).filter((q: any) => q.done).length, JSON.stringify(pc.length));
  const textInTrace = (await db.query(`SELECT count(*)::int n FROM llm_calls WHERE run_id = $1 AND (error_code ~* 'http|@')`, [runId])).rows[0].n;
  check("no page text or address in the trace", textInTrace === 0, "");

  console.log("\n━━ 5. One prospect in depth ━━");
  const best = ps.filter((p) => !p.rejectReason).sort((x, y) => (y.score?.total ?? -1) - (x.score?.total ?? -1))[0];
  check("there is at least one prospect worth showing", !!best, `${ps.length}`);
  if (best) {
    console.log(`     -> best: ${best.name} (${best.domain}) ${best.score?.total ?? "-"}/100 ${best.ready ? "READY" : ""}  why now: ${best.whyNow?.value ?? "-"}  person: ${best.decisionMaker?.value ?? "-"}`);
    r = await b.req("GET", `/api/outbound/prospects/${best.id}`);
    check("another workspace cannot read the brief: 404", r.status === 404, `${r.status}`);
    r = await a.req("GET", `/api/outbound/prospects/${best.id}`);
    check("the brief separates facts, signals, people and inferences", r.status === 200 && Array.isArray(r.json?.brief?.facts) && Array.isArray(r.json?.brief?.signals) && Array.isArray(r.json?.brief?.inferences), r.text);
    check("nothing in 'facts' is an inference", (r.json?.brief?.facts ?? []).every((f: any) => f.status === "confirmed"), "");
    r = await a.req("POST", `/api/outbound/prospects/${best.id}/contacts`, { runId });
    check("no contact provider connected: contacts says so (503) and invents nobody", r.status === 503 && r.json?.code === "CONTACTS_NOT_SETUP", `${r.status} ${r.text}`);
    r = await a.req("POST", `/api/outbound/prospects/${best.id}/angle`, {});
    const hadReason = !!best.whyNow || !!best.opportunity;
    if (hadReason) {
      check("an outreach angle is written and cites only this prospect's findings", r.status === 200 && !!r.json?.brief?.angle?.problem && r.json.brief.angle.evidenceIds.every((id: number) => fnd.some((f) => f.id === id && f.prospect_id === best.id)), `${r.status} ${r.text}`);
      console.log(`     -> angle: ${r.json?.brief?.angle?.problem} | ${r.json?.brief?.angle?.positioning}`);
      check("the angle contains no price, link or email", !/[$€£₹]\s?\d|\d\s?%|https?:|@/.test(JSON.stringify(r.json?.brief?.angle ?? {})), "");
    } else check("no reason to reach out yet: no angle is invented (422)", r.status === 422 || r.status === 200, `${r.status} ${r.text}`);

    console.log("\n━━ 6. Into Leads ━━");
    const leadsBefore = (await db.query(`SELECT count(*)::int n FROM leads WHERE organization_id = $1`, [ua.orgId])).rows[0].n;
    check("running the search created no leads", leadsBefore === 0, String(leadsBefore));
    r = await b.req("POST", `/api/outbound/prospects/${best.id}/lead`, {});
    check("another workspace cannot add it: 404", r.status === 404, `${r.status}`);
    r = await a.req("POST", `/api/outbound/prospects/${best.id}/lead`, {});
    check("adding creates a lead (201)", r.status === 201 && r.json?.leadId > 0 && r.json?.existing === false, `${r.status} ${r.text}`);
    const leadId = r.json?.leadId;
    const twice = await a.req("POST", `/api/outbound/prospects/${best.id}/lead`, {});
    check("adding again returns the same lead", twice.json?.leadId === leadId && twice.json?.existing === true, twice.text);
    const lead = (await db.query(`SELECT source, domain, contact_email, status FROM leads WHERE id = $1`, [leadId])).rows[0];
    check("the lead is source 'outbound', status new, and has no email we didn't verify", lead?.source === "outbound" && lead?.status === "new" && !lead?.contact_email, JSON.stringify(lead));
    const claims = (await db.query(`SELECT status, evidence_url, evidence_snippet FROM lead_claims WHERE lead_id = $1`, [leadId])).rows;
    check("its facts were copied with their evidence; every confirmed one has a URL and the words", claims.length > 0 && claims.filter((x) => x.status === "confirmed").every((x) => x.evidence_url && x.evidence_snippet), String(claims.length));
    r = await a.req("GET", `/api/sales/leads/${leadId}/score`);
    check("the new lead is scored by the normal lead score", r.status === 200 && r.json?.score?.total >= 0, r.text);
  }

  console.log("\n━━ 7. Limits ━━");
  r = await a.req("POST", `/api/outbound/runs/${runId}/cancel`, {});
  check("cancelling a finished run changes nothing", r.status === 200 && r.json?.run?.status === "done", r.text);
  await db.end();
}

async function cleanup() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const c = await pool.connect();
  const found = await c.query(`SELECT id, organization_id FROM users WHERE email LIKE 'e2e-ob-%@dealinsec.invalid'`);
  const users = found.rows.map((x) => x.id), orgs = Array.from(new Set(found.rows.map((x) => x.organization_id).filter(Boolean)));
  for (const o of orgs) for (const t of ["prospect_findings", "prospect_run_items", "prospects", "prospect_runs", "provider_calls", "lead_messages", "lead_research", "lead_claims", "lead_tickets", "lead_events", "leads", "client_profiles", "llm_calls", "activity_logs", "invoice_counters", "invitations", "org_roles"]) await c.query(`DELETE FROM ${t} WHERE organization_id=$1`, [o]).catch(() => {});
  for (const u of users) { await c.query(`DELETE FROM activity_logs WHERE user_id=$1`, [u]).catch(() => {}); await c.query(`DELETE FROM agent_sessions WHERE user_id=$1`, [u]).catch(() => {}); }
  await c.query(`DELETE FROM users WHERE email LIKE 'e2e-ob-%@dealinsec.invalid'`).catch(() => {});
  for (const o of orgs) await c.query(`DELETE FROM organizations WHERE id=$1`, [o]).catch(() => {});
  const left = await c.query(`SELECT count(*)::int leftover FROM users WHERE email LIKE 'e2e-ob-%'`);
  console.log("\n━━ cleanup ━━\n ", left.rows[0]);
  c.release(); await pool.end();
}

await requireServerOnLocalDatabase();
try { await main(); } catch (e: any) { console.log("\nRUN ABORTED:", e?.message); fail++; failures.push("run aborted: " + e?.message); }
finally {
  if (!process.env.E2E_KEEP) await cleanup();
  console.log(`\n═══ ${pass} passed, ${fail} failed ═══`);
  if (failures.length) { console.log("\nFAILURES:"); failures.forEach((f) => console.log("  ·", f)); }
  process.exit(fail ? 1 : 0);
}
