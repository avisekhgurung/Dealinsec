/**
 * End-to-end check of the knowledge REST API, against a local dev server backed by the LOCAL
 * test database (same guards and cleanup as e2e-leads.mts).
 *
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/migrate-knowledge.ts
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest PORT=3000 npm run dev
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/e2e-knowledge.mts
 *
 * Signup is throttled to 5 per IP per 15 minutes; this uses two. One check fetches
 * https://example.com/ (a real public page) to prove the pinned-address fetch works end to end.
 */
import pg from "pg";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import { LOCAL_TEST_DATABASE_URL, requireLocalDatabaseUrl } from "./local-db-guard.ts";

const DATABASE_URL = requireLocalDatabaseUrl("e2e-knowledge.mts");
const BASE = "http://localhost:3000";
const STAMP = Date.now();
const PW = `E2e#${STAMP}`;
const A = { email: `e2e-knowledge-a-${STAMP}@dealinsec.invalid`, password: PW, firstName: "Ann", lastName: "Owner" };
const B = { email: `e2e-knowledge-b-${STAMP}@dealinsec.invalid`, password: PW, firstName: "Bob", lastName: "Owner" };
const PDF = Buffer.from("JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUiA1IDAgUl0gL0NvdW50IDIgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNyAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA5MyA+PgpzdHJlYW0KQlQgL0YxIDEyIFRmIDcyIDcyMCBUZCAoV2UgZGVzaWduIGxvZ29zIGFuZCBicmFuZCBzeXN0ZW1zIGZvciBzbWFsbCBzdHVkaW9zIGluIEJlcmxpbi4pIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvUGFnZSAvUGFyZW50IDIgMCBSIC9NZWRpYUJveCBbMCAwIDYxMiA3OTJdIC9Db250ZW50cyA2IDAgUiAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA3IDAgUiA+PiA+PiA+PgplbmRvYmoKNiAwIG9iago8PCAvTGVuZ3RoIDk2ID4+CnN0cmVhbQpCVCAvRjEgMTIgVGYgNzIgNzIwIFRkIChPdXIgaWRlYWwgY2xpZW50IGlzIGEgYm91dGlxdWUgaG90ZWwgZ3JvdXAgZXhwYW5kaW5nIGluIFBvcnR1Z2FsLikgVGogRVQKZW5kc3RyZWFtCmVuZG9iago3IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDgKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDEyMSAwMDAwMCBuIAowMDAwMDAwMjQ3IDAwMDAwIG4gCjAwMDAwMDAzOTAgMDAwMDAgbiAKMDAwMDAwMDUxNiAwMDAwMCBuIAowMDAwMDAwNjYyIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgOCAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNzMyCiUlRU9GCg==", "base64");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const NOTE = { title: "Who we help", text: "We design logos and brand systems for boutique hotels and small restaurants in Portugal. Our best clients are owner-run hospitality groups." };

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; failures.push(`${name}${detail ? " — " + detail : ""}`); console.log(`  ✗ ${name}${detail ? "  [" + detail + "]" : ""}`); }
}

function jar() {
  let cookie = "";
  const remember = (res: Response) => { for (const sc of (res.headers as any).getSetCookie?.() ?? []) { const pair = String(sc).split(";")[0]; if (pair.startsWith("connect.sid=") || !cookie) cookie = pair; } };
  return {
    async req(method: string, path: string, body?: any) {
      const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
      remember(res);
      const text = await res.text();
      let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ }
      return { status: res.status, json, text: text.slice(0, 200), headers: res.headers };
    },
    async upload(path: string, fields: Record<string, string>, file?: { bytes: Buffer; name: string; type?: string }) {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      if (file) fd.append("file", new Blob([new Uint8Array(file.bytes)], { type: file.type ?? "application/octet-stream" }), file.name);
      const res = await fetch(BASE + path, { method: "POST", headers: cookie ? { cookie } : {}, body: fd, redirect: "manual" });
      remember(res);
      const text = await res.text();
      let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ }
      return { status: res.status, json, text: text.slice(0, 200) };
    },
    async raw(path: string) { const res = await fetch(BASE + path, { headers: cookie ? { cookie } : {}, redirect: "manual" }); return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) }; },
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
  r = await j.req("GET", "/api/auth/user");
  return { id: r.json?.id as string, orgId: r.json?.organizationId as string };
}

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  console.log("\n━━ 0. Access ━━");
  let r: any = await anon.req("GET", "/api/knowledge");
  check("signed out: list is 401", r.status === 401, `${r.status}`);
  r = await anon.req("POST", "/api/knowledge/note", NOTE);
  check("signed out: add is 401", r.status === 401);
  const ua = await signup(a, A), ub = await signup(b, B);
  r = await a.req("GET", "/api/knowledge");
  check("a new workspace has nothing, and the limits are shown", r.status === 200 && r.json?.sources?.length === 0 && r.json?.limits?.sources === 100, `${r.status} ${r.text}`);

  console.log("\n━━ 1. Notes ━━");
  r = await a.req("POST", "/api/knowledge/note", NOTE);
  check("add a note: 201, one passage", r.status === 201 && r.json?.source?.kind === "note" && r.json?.source?.chunkCount === 1, `${r.status} ${r.text}`);
  const noteId = r.json?.source?.id;
  r = await a.req("POST", "/api/knowledge/note", NOTE);
  check("the same note again: 409 duplicate", r.status === 409 && r.json?.code === "duplicate", `${r.status} ${r.text}`);
  r = await a.req("POST", "/api/knowledge/note", { title: "x", text: "short" });
  check("a too-short note: 400", r.status === 400);
  r = await a.req("POST", "/api/knowledge/note", { ...NOTE, title: "Other", organizationId: ub.orgId });
  check("an unknown field (organizationId) is refused, not obeyed: 400", r.status === 400, `${r.status}`);
  r = await a.req("POST", "/api/knowledge/note", { title: "Control chars", text: "Line one\u0000\u0007 and a very ordinary second line of text.\r\n\r\n\r\n\r\nEnd." });
  check("control characters are cleaned, not stored", r.status === 201);

  console.log("\n━━ 2. Web pages: refused before any request is made ━━");
  for (const u of ["https://localhost/", "https://127.0.0.1/", "https://169.254.169.254/latest/meta-data/", "https://[::1]/", "http://example.com/", "https://example.com:8080/", "https://user:pw@example.com/", "ftp://example.com/", "file:///etc/passwd", "https://db.internal/", "javascript:alert(1)"]) {
    r = await a.req("POST", "/api/knowledge/url", { url: u });
    check(`refuses ${u}`, r.status === 400 && /bad_url|blocked/.test(r.json?.code ?? ""), `${r.status} ${r.text}`);
  }
  console.log("  (one real fetch: https://example.com/)");
  r = await a.req("POST", "/api/knowledge/url", { url: "https://example.com/" });
  check("a real public page is read and added", r.status === 201 && r.json?.source?.kind === "url" && /example/i.test(r.json?.source?.title ?? ""), `${r.status} ${r.text}`);
  r = await a.req("POST", "/api/knowledge/url", { url: "https://example.com/" });
  check("the same page again: 409 duplicate", r.status === 409, `${r.status} ${r.text}`);

  console.log("\n━━ 3. PDFs ━━");
  r = await a.upload("/api/knowledge/pdf", {}, { bytes: PDF, name: "Brand Deck.pdf", type: "application/pdf" });
  check("a real PDF: 201, titled from the file name", r.status === 201 && r.json?.source?.title === "Brand Deck" && r.json?.source?.kind === "pdf", `${r.status} ${r.text}`);
  const pdfId = r.json?.source?.id;
  r = await a.upload("/api/knowledge/pdf", {}, { bytes: Buffer.from("<script>alert(1)</script>"), name: "invoice.pdf", type: "application/pdf" });
  check("a script named .pdf: 415", r.status === 415, `${r.status} ${r.text}`);
  r = await a.upload("/api/knowledge/pdf", {}, { bytes: Buffer.alloc(0), name: "empty.pdf", type: "application/pdf" });
  check("an empty file: refused", r.status >= 400 && r.status < 500, `${r.status}`);
  r = await a.upload("/api/knowledge/pdf", {});
  check("no file: 400", r.status === 400, `${r.status}`);
  r = await a.upload("/api/knowledge/pdf", {}, { bytes: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(8 * 1024 * 1024 + 10)]), name: "big.pdf", type: "application/pdf" });
  check("over 8 MB: 413 as JSON", r.status === 413 && r.json?.code === "too_big", `${r.status} ${r.text}`);

  console.log("\n━━ 4. Pictures ━━");
  r = await a.upload("/api/knowledge/image", { title: "Hotel logo", description: "A logo we made for a boutique hotel in Lisbon: a green leaf above the name." }, { bytes: PNG, name: "hotel.png", type: "image/png" });
  check("a real PNG with a description: 201", r.status === 201 && r.json?.source?.kind === "image" && r.json?.source?.hasFile === true, `${r.status} ${r.text}`);
  const imgId = r.json?.source?.id;
  r = await a.upload("/api/knowledge/image", { title: "No words" , description: "x" }, { bytes: PNG, name: "n.png", type: "image/png" });
  check("no real description: 400", r.status === 400, `${r.status}`);
  r = await a.upload("/api/knowledge/image", { title: "Svg", description: "An SVG that carries a script, pretending to be a PNG." }, { bytes: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>"), name: "x.png", type: "image/png" });
  check("an SVG wearing a .png name: 415", r.status === 415, `${r.status} ${r.text}`);
  r = await a.upload("/api/knowledge/image", { title: "Big", description: "A picture that is too large to accept here." }, { bytes: Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]), name: "big.png", type: "image/png" });
  check("over 5 MB: 413", r.status === 413, `${r.status} ${r.text}`);

  console.log("\n━━ 5. Serving a picture ━━");
  let img = await a.raw(`/api/knowledge/${imgId}/image`);
  check("the owner gets the bytes back, unchanged", img.status === 200 && img.bytes.equals(PNG), `${img.status} ${img.bytes.length}`);
  const h = img.headers;
  check("served as the sniffed type, never sniffable, sandboxed, private", h.get("content-type") === "image/png" && h.get("x-content-type-options") === "nosniff" && /sandbox/.test(h.get("content-security-policy") ?? "") && /private/.test(h.get("cache-control") ?? ""), JSON.stringify([...h.entries()].filter(([k]) => /content-type|nosniff|security|cache/.test(k))));
  img = await b.raw(`/api/knowledge/${imgId}/image`);
  check("another workspace: 404, no bytes", img.status === 404 && !img.bytes.equals(PNG), `${img.status}`);
  img = await anon.raw(`/api/knowledge/${imgId}/image`);
  check("signed out: 401", img.status === 401, `${img.status}`);
  img = await a.raw(`/api/knowledge/${noteId}/image`);
  check("a note has no picture: 404", img.status === 404, `${img.status}`);

  console.log("\n━━ 6. Search ━━");
  r = await a.req("GET", "/api/knowledge/search?q=" + encodeURIComponent("boutique hotel groups in Portugal"));
  check("finds the note, by words (and 'hotel' finds 'hotels')", r.status === 200 && r.json?.hits?.some((x: any) => x.title === "Who we help"), `${r.status} ${r.text}`);
  r = await a.req("GET", "/api/knowledge/search?q=" + encodeURIComponent("Berlin studios"));
  check("finds the PDF's text", r.status === 200 && r.json?.hits?.some((x: any) => x.title === "Brand Deck"), `${r.status} ${r.text}`);
  r = await a.req("GET", "/api/knowledge/search?q=" + encodeURIComponent("Lisbon green leaf"));
  check("finds the picture by its description", r.status === 200 && r.json?.hits?.some((x: any) => x.title === "Hotel logo"), `${r.status} ${r.text}`);
  r = await a.req("GET", "/api/knowledge/search?q=" + encodeURIComponent("'); DROP TABLE knowledge_sources; -- & | ! :* ("));
  check("hostile query text is harmless: 200", r.status === 200, `${r.status} ${r.text}`);
  r = await a.req("GET", "/api/knowledge/search?q=" + encodeURIComponent("the of to"));
  check("only filler words: a clear 400", r.status === 400, `${r.status}`);
  r = await b.req("GET", "/api/knowledge/search?q=" + encodeURIComponent("boutique hotel groups in Portugal"));
  check("another workspace finds nothing of ours", r.status === 200 && (r.json?.hits ?? []).length === 0, `${r.status} ${r.text}`);

  console.log("\n━━ 7. One workspace cannot touch another's ━━");
  r = await b.req("GET", "/api/knowledge");
  check("B's list does not include A's sources", r.status === 200 && r.json?.sources?.length === 0, `${r.text}`);
  r = await b.req("DELETE", `/api/knowledge/${noteId}`);
  check("B deleting A's note: 404", r.status === 404, `${r.status}`);
  r = await a.req("GET", "/api/knowledge");
  check("A still has all five sources (two notes, a page, a PDF, a picture)", r.json?.sources?.length === 5, `${r.json?.sources?.length}`);

  console.log("\n━━ 8. Removing ━━");
  r = await a.req("DELETE", `/api/knowledge/${pdfId}`);
  check("A removes the PDF: 200", r.status === 200, `${r.status}`);
  r = await a.req("GET", "/api/knowledge/search?q=" + encodeURIComponent("Berlin studios"));
  check("its words are no longer found", (r.json?.hits ?? []).every((x: any) => x.title !== "Brand Deck"));
  r = await a.req("DELETE", `/api/knowledge/${imgId}`);
  check("A removes the picture: 200", r.status === 200);
  img = await a.raw(`/api/knowledge/${imgId}/image`);
  check("…and its bytes are gone: 404", img.status === 404);
  r = await a.req("DELETE", `/api/knowledge/${pdfId}`);
  check("removing twice: 404", r.status === 404);

  console.log("\n━━ 9. Rate limit ━━");
  const codes: number[] = [];
  for (let i = 0; i < 32; i++) codes.push((await b.upload("/api/knowledge/pdf", {})).status);
  check("30 attempts pass through to validation, the next is 429", codes.slice(0, 30).every((c) => c === 400) && codes[30] === 429 && codes[31] === 429, JSON.stringify(codes.slice(28)));
  r = await a.req("POST", "/api/knowledge/note", { ...NOTE, title: "A is unaffected" });
  check("another workspace is unaffected", r.status === 201 || r.status === 409, `${r.status}`);

  console.log("\n━━ 10. Nothing orphaned, nothing crossed ━━");
  const orph = (await pool.query(`SELECT (SELECT count(*)::int FROM knowledge_chunks c WHERE NOT EXISTS (SELECT 1 FROM knowledge_sources s WHERE s.id=c.source_id AND s.organization_id=c.organization_id)) chunks,
    (SELECT count(*)::int FROM knowledge_files f WHERE NOT EXISTS (SELECT 1 FROM knowledge_sources s WHERE s.id=f.source_id AND s.organization_id=f.organization_id)) files`)).rows[0];
  check("every passage and file belongs to a source in the same workspace", orph.chunks === 0 && orph.files === 0, JSON.stringify(orph));
  const bRows = (await pool.query(`SELECT count(*)::int n FROM knowledge_sources WHERE organization_id=$1`, [ub.orgId])).rows[0].n;
  check("B never gained a source", bRows === 0);
  const stored = (await pool.query(`SELECT count(*)::int n FROM knowledge_chunks WHERE organization_id=$1 AND content ~ '[\\x00-\\x08]'`, [ua.orgId])).rows[0].n;
  check("no control characters in stored text", stored === 0);
  await pool.end();
}

async function cleanup() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const c = await pool.connect();
  const found = await c.query(`SELECT id, organization_id FROM users WHERE email LIKE 'e2e-knowledge-%@dealinsec.invalid'`);
  const users = found.rows.map((x) => x.id), orgs = Array.from(new Set(found.rows.map((x) => x.organization_id).filter(Boolean)));
  for (const o of orgs) for (const t of ["knowledge_files", "knowledge_chunks", "knowledge_sources", "activity_logs", "invoice_counters", "invitations", "org_roles"]) await c.query(`DELETE FROM ${t} WHERE organization_id=$1`, [o]).catch(() => {});
  for (const u of users) await c.query(`DELETE FROM activity_logs WHERE user_id=$1`, [u]).catch(() => {});
  await c.query(`DELETE FROM users WHERE email LIKE 'e2e-knowledge-%@dealinsec.invalid'`).catch(() => {});
  for (const o of orgs) await c.query(`DELETE FROM organizations WHERE id=$1`, [o]).catch(() => {});
  const left = await c.query(`SELECT (SELECT count(*)::int FROM knowledge_sources) sources, (SELECT count(*)::int FROM users WHERE email LIKE 'e2e-knowledge-%') leftover`);
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
