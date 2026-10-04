/**
 * DESTRUCTIVE: removes every user and everything that belongs to them, so the
 * app starts empty. There is no undo unless you took a Neon branch first.
 *
 * Dry run (the default) only COUNTS what would be removed:
 *   npx tsx --env-file=.env script/reset-all-users.ts
 *
 * Apply (irreversible):
 *   npx tsx --env-file=.env script/reset-all-users.ts --apply --confirm=DELETE-ALL-USERS
 *
 * What goes: users, organizations, roles, invitations, activity, feedback, leads and
 * their tickets and facts, ideal-client profiles, agent conversations and approvals,
 * invoice counters, deals, quotations, agreements (including every signed
 * record and its integrity hash), invoices and attachments, credit and payment
 * order history, referrals, tool documents and sessions (everyone is logged out).
 *
 * What stays, on purpose:
 *   - app_migrations   the schema ledger. Clearing it makes the server refuse to boot.
 *   - newsletter_subscribers   they are not users.
 * Not touched at all: files already uploaded to ImageKit (signatures, proofs,
 * logos), and anything held by Razorpay or PayU.
 *
 * Runs in ONE transaction: if anything fails, nothing is removed. Identity
 * sequences restart, so the first new deal is number 1 again.
 */
import pg from "pg";

const TABLES = [
  // Leaves first for readability; TRUNCATE ... CASCADE makes the order irrelevant.
  "invoice_attachments", "brand_invoices", "invoices", "quotes", "contracts", "deals",
  "credit_transactions", "payu_orders", "referrals", "tool_documents", "feedback",
  "activity_logs", "invitations", "org_roles", "invoice_counters", "sessions",
  // Added 4 Oct 2026: the lead pipeline, the ideal client, and the agent (conversations, approvals, settings).
  // None of these has a foreign key to users, so CASCADE would NOT have removed them.
  "lead_claims", "lead_tickets", "lead_events", "leads", "client_profiles",
  "agent_tool_calls", "agent_approvals", "agent_messages", "agent_runs", "agent_sessions", "agent_settings",
  "organizations", "users",
] as const;

// Tables added by later, separately-run migrations. Included only when they exist, so this works
// before or after each migration. None has a foreign key to users, so CASCADE would NOT remove them.
const OPTIONAL = ["document_styles", "knowledge_files", "knowledge_chunks", "knowledge_sources"] as const;

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const apply = process.argv.includes("--apply");
const confirmed = process.argv.includes("--confirm=DELETE-ALL-USERS");
const host = (() => { try { return new URL(url).host; } catch { return "unknown host"; } })();

async function main() {
  const pool = new pg.Pool({ connectionString: url });
  const c = await pool.connect();
  try {
    console.log(`Database host: ${host}`);
    const present = new Set((await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()`)).rows.map((r) => r.table_name as string));
    const missing = OPTIONAL.filter((t) => !present.has(t));
    if (missing.length) console.log(`Not migrated here, skipped: ${missing.join(", ")}`);
    const TABLES_NOW: string[] = [...TABLES, ...OPTIONAL.filter((t) => present.has(t))];
    const counts: Record<string, number> = {};
    for (const t of TABLES_NOW) counts[t] = Number((await c.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n);
    console.table(counts);
    const kept = Number((await c.query(`SELECT count(*)::int AS n FROM app_migrations`)).rows[0].n);
    console.log(`Kept: app_migrations (${kept} rows), newsletter_subscribers`);

    if (!apply) { console.log("\nDRY RUN. Nothing was changed. Add --apply --confirm=DELETE-ALL-USERS to delete."); return; }
    if (!confirmed) { console.error("\nRefusing: --apply also needs --confirm=DELETE-ALL-USERS"); process.exit(1); }

    await c.query("BEGIN");
    await c.query(`TRUNCATE ${TABLES_NOW.join(", ")} RESTART IDENTITY CASCADE`);
    const left = Number((await c.query(`SELECT count(*)::int AS n FROM users`)).rows[0].n);
    const ledger = Number((await c.query(`SELECT count(*)::int AS n FROM app_migrations`)).rows[0].n);
    if (left !== 0 || ledger !== kept) { await c.query("ROLLBACK"); throw new Error(`Unexpected state (users=${left}, ledger=${ledger}); rolled back`); }
    await c.query("COMMIT");
    console.log("\nDone. All users and their data were removed. The schema ledger is intact.");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.error(e);
    process.exitCode = 1;
  } finally { c.release(); await pool.end(); }
}
main();
