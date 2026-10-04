/**
 * End-to-end check of the neural voice route, against a local dev server on the LOCAL test
 * database, with a fake OpenAI speech server started by this script. The dev server must be
 * started with the fake provider's settings (launch config "dealinsec-local-db-fake-tts":
 * OPENAI_API_KEY=sk-fake-local-test OPENAI_TTS_BASE_URL=http://127.0.0.1:4010/v1 VOICE_DAILY_CHARS=3000).
 *
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/e2e-voice.mts
 */
import pg from "pg";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import { startFakeTts } from "./fake-openai-tts.mts";
import { requireLocalDatabaseUrl } from "./local-db-guard.ts";

const DATABASE_URL = requireLocalDatabaseUrl("e2e-voice.mts");
const BASE = "http://localhost:3000";
const STAMP = Date.now();
const PW = `E2e#${STAMP}`;
const A = { email: `e2e-voice-a-${STAMP}@dealinsec.invalid`, password: PW, firstName: "Ann", lastName: "Owner" };
const B = { email: `e2e-voice-b-${STAMP}@dealinsec.invalid`, password: PW, firstName: "Bob", lastName: "Owner" };

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
      const buf = Buffer.from(await res.arrayBuffer());
      let json: any = null; try { json = JSON.parse(buf.toString("utf8")); } catch { /* audio */ }
      return { status: res.status, json, buf, headers: res.headers, text: buf.toString("utf8", 0, 200) };
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
  console.error(`REFUSING: the server at ${BASE} is not using the local test database (${outcome}).`);
  process.exit(1);
}

async function main(fake: Awaited<ReturnType<typeof startFakeTts>>) {
  console.log("\n━━ 0. Access ━━");
  let r: any = await anon.req("GET", "/api/voice/status");
  check("signed out: status is 401", r.status === 401);
  r = await anon.req("POST", "/api/voice/speak", { text: "hello there" });
  check("signed out: speak is 401", r.status === 401);
  for (const [who, j] of [[A, a], [B, b]] as const) { r = await j.req("POST", "/api/auth/signup", who); check(`signup ${who.firstName}`, r.status === 200 || r.status === 201, `${r.status}`); }

  console.log("\n━━ 1. Status ━━");
  r = await a.req("GET", "/api/voice/status");
  check("neural voice is on, with an allowance", r.status === 200 && r.json?.neural === true && r.json?.remainingChars === 3000, r.text);

  console.log("\n━━ 2. Speaking ━━");
  r = await a.req("POST", "/api/voice/speak", { text: "**Good evening.** Your [deal](https://x.test/d/1) is ready." });
  check("a sentence comes back as audio/mpeg bytes", r.status === 200 && r.headers.get("content-type") === "audio/mpeg" && r.buf.length === 38 * 417 && r.buf[0] === 0xff, `${r.status} ${r.headers.get("content-type")} ${r.buf.length}`);
  check("not cached, not sniffable", /no-store/.test(r.headers.get("cache-control") ?? "") && r.headers.get("x-content-type-options") === "nosniff");
  const sent = fake.log[fake.log.length - 1];
  check("the provider got speakable text (no markdown or link) in the chosen voice with the butler instructions", sent?.input === "Good evening. Your deal is ready." && sent.voice === "onyx" && sent.model === "gpt-4o-mini-tts" && sent.hasInstructions, JSON.stringify(sent));
  r = await a.req("POST", "/api/voice/speak", { text: "x ".repeat(2000) });
  check("a very long text is cut to 600 characters before it is sent", r.status === 200 && fake.log[fake.log.length - 1].input.length <= 600, `${fake.log[fake.log.length - 1].input.length}`);
  for (const bad of [{}, { text: "" }, { text: "   " }, { text: 5 }, { text: "***" }, { text: ["a"] }]) {
    const before = fake.log.length;
    r = await a.req("POST", "/api/voice/speak", bad);
    check(`nothing to say (${JSON.stringify(bad)}): 400 and the provider is not called`, r.status === 400 && fake.log.length === before, `${r.status}`);
  }

  console.log("\n━━ 3. Failures never leak and never cost ━━");
  r = await a.req("GET", "/api/voice/status"); const before = r.json.remainingChars;
  r = await a.req("POST", "/api/voice/speak", { text: "FAIL500 please" });
  check("provider error: 502 with a plain message, no key, no details", r.status === 502 && !/sk-|fake-local|Bearer/.test(r.text), `${r.status} ${r.text}`);
  r = await a.req("POST", "/api/voice/speak", { text: "FAIL429 please" });
  check("provider busy: 429", r.status === 429, `${r.status}`);
  r = await a.req("GET", "/api/voice/status");
  check("a failed attempt is refunded: the allowance is unchanged", r.json.remainingChars === before, `${before} -> ${r.json.remainingChars}`);

  console.log("\n━━ 4. The daily allowance, per workspace ━━");
  let last: any = null, ok = 0;
  for (let i = 0; i < 30; i++) { last = await b.req("POST", "/api/voice/speak", { text: `Sentence number ${i} ${"word ".repeat(40)}` }); if (last.status === 200) ok++; else break; }
  check("B is stopped by its own cap (3,000 characters), with a clear message", last.status === 429 && last.json?.code === "daily_cap" && ok >= 10 && ok <= 15, `${ok} ok, last ${last.status} ${last.text}`);
  r = await b.req("GET", "/api/voice/status");
  check("B's remaining allowance is nearly zero", r.json?.remainingChars < 300, `${r.json?.remainingChars}`);
  r = await a.req("POST", "/api/voice/speak", { text: "Still fine for A." });
  check("A is not affected by B", r.status === 200, `${r.status}`);

  console.log("\n━━ 5. The per-minute rate ━━");
  const codes: number[] = [];
  for (let i = 0; i < 45; i++) codes.push((await a.req("POST", "/api/voice/speak", { text: "Hi there." })).status);
  check("after 40 requests a minute the next ones are 429", codes.includes(429) && codes.indexOf(429) <= 41, JSON.stringify(codes.slice(30, 45)));
}

async function cleanup() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const c = await pool.connect();
  const found = await c.query(`SELECT id, organization_id FROM users WHERE email LIKE 'e2e-voice-%@dealinsec.invalid'`);
  const orgs = Array.from(new Set(found.rows.map((x) => x.organization_id).filter(Boolean)));
  for (const o of orgs) for (const t of ["activity_logs", "invoice_counters", "invitations", "org_roles"]) await c.query(`DELETE FROM ${t} WHERE organization_id=$1`, [o]).catch(() => {});
  for (const u of found.rows) await c.query(`DELETE FROM activity_logs WHERE user_id=$1`, [u.id]).catch(() => {});
  await c.query(`DELETE FROM users WHERE email LIKE 'e2e-voice-%@dealinsec.invalid'`).catch(() => {});
  for (const o of orgs) await c.query(`DELETE FROM organizations WHERE id=$1`, [o]).catch(() => {});
  const left = await c.query(`SELECT count(*)::int leftover FROM users WHERE email LIKE 'e2e-voice-%'`);
  console.log("\n━━ cleanup ━━\n ", left.rows[0]);
  c.release(); await pool.end();
}

await requireServerOnLocalDatabase();
const fake = await startFakeTts();
try { await main(fake); } catch (e: any) { console.log("\nRUN ABORTED:", e?.message); fail++; failures.push("run aborted: " + e?.message); }
finally {
  fake.close();
  await cleanup();
  console.log(`\n═══ ${pass} passed, ${fail} failed ═══`);
  if (failures.length) { console.log("\nFAILURES:"); failures.forEach((f) => console.log("  ·", f)); }
  process.exit(fail ? 1 : 0);
}
