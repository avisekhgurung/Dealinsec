/**
 * Turns ONE account into a United States test account and gives it two dummy
 * deals to try the product with. Nothing else in the database is touched.
 *
 * Dry run (the default) only shows what would change:
 *   npx tsx --env-file=.env script/setup-us-test-account.ts you@example.com
 *
 * Apply:
 *   npx tsx --env-file=.env script/setup-us-test-account.ts you@example.com --apply
 *
 * If the workspace already has deals in another currency, add
 *   --delete-existing-deals
 * to delete them (and their quotations, agreements, invoices and attachments)
 * first. IRREVERSIBLE, and limited to THIS workspace.
 *
 * What it does, in ONE transaction (all or nothing):
 *   0. (only with --delete-existing-deals) removes this workspace's deals and
 *      everything linked to them, and restarts its invoice numbering.
 *   1. Sets the user's AND their workspace's country, currency, locale and time
 *      zone to the United States (USD, en-US).
 *   2. Adds two pending deals, each with a draft quotation:
 *        - a client project ("[TEST] Website redesign", $3,500)
 *        - a brand collaboration with usage, exclusivity and approval terms
 *          ("[TEST] Autumn launch", $800)
 *      Both are titled "[TEST] …" so they are easy to spot and delete.
 *
 * Safe by design:
 *   - Refuses if the workspace already has deals in another currency (unless you
 *     pass --delete-existing-deals): changing the region would silently relabel
 *     their amounts, which is why the app locks the region. Already-USD
 *     workspaces are fine.
 *   - Re-running adds no duplicates (it looks for the "[TEST] " titles).
 *   - It does not touch the work type (client or brand); change that in Settings.
 *   - Amounts are stored in cents, like every other amount in the app.
 */
import crypto from "node:crypto";
import pg from "pg";
import { regionForCountry } from "../shared/region.ts";

const email = process.argv[2]?.trim().toLowerCase();
const apply = process.argv.includes("--apply");
const deleteExisting = process.argv.includes("--delete-existing-deals");
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
if (!email || email.startsWith("--")) { console.error("Usage: script/setup-us-test-account.ts <email> [--apply]"); process.exit(1); }

const host = (() => { try { return new URL(url).host; } catch { return "unknown host"; } })();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const inDays = (n: number) => iso(new Date(Date.now() + n * 86_400_000));
const deliverable = (platform: string, contentType: string, quantity: number) => ({
  id: crypto.randomUUID(), platform, contentType, quantity, frequency: "One-time", notes: "",
});

const DEALS = [
  {
    brandName: "Acme Studio",
    dealTitle: "[TEST] Website redesign — 5 pages",
    dealType: "Development",
    amountMinor: 350_000, // $3,500.00
    start: inDays(0),
    end: inDays(28),
    deliverables: [deliverable("Design", "Website pages", 5)],
    standardTermIds: ["advance_50", "balance_7d", "revisions_2"],
    customTerms: "Hosting and copywriting are excluded.",
    brandTerms: null as null | Record<string, string>,
  },
  {
    brandName: "Glow Skincare",
    dealTitle: "[TEST] Autumn launch — 2 Reels and 3 stories",
    dealType: "Brand Collaboration",
    amountMinor: 80_000, // $800.00
    start: inDays(7),
    end: inDays(30),
    deliverables: [deliverable("Instagram", "Reel", 2), deliverable("Instagram", "Story", 3)],
    standardTermIds: ["advance_50", "balance_7d"],
    customTerms: "Up to 2 rounds of revisions are included.",
    brandTerms: {
      campaign: "Autumn serum",
      usageRights: "Organic posts on the brand's own channels",
      usageDuration: "3 months from first posting",
      exclusivity: "No other skincare brands for 30 days",
      approval: "The brand approves each Reel once and replies within 2 working days",
    },
  },
];

async function main() {
  const us = regionForCountry("US");
  const pool = new pg.Pool({ connectionString: url });
  const c = await pool.connect();
  try {
    console.log(`Database host: ${host}`);
    const u = (await c.query(
      `SELECT id, email, organization_id, country, currency FROM users WHERE lower(email) = $1`, [email],
    )).rows[0];
    if (!u) { console.error(`\nNo user with the email ${email}. Sign up with it first, then run this again.`); process.exit(1); }
    if (!u.organization_id) { console.error("\nThis user has no workspace yet; finish onboarding first."); process.exit(1); }

    const org = (await c.query(`SELECT id, name, country, currency, audience FROM organizations WHERE id = $1`, [u.organization_id])).rows[0];
    const existingRows = (await c.query(
      `SELECT id, deal_title FROM deals WHERE organization_id = $1 OR (organization_id IS NULL AND user_id = $2)`,
      [u.organization_id, u.id],
    )).rows as { id: number; deal_title: string }[];
    const existing = existingRows.map((r) => r.deal_title);
    const dealIds = existingRows.map((r) => r.id);
    const foreignDeals = existing.length > 0 && org.currency !== us.currency && !deleteExisting;

    console.log(`\nAccount:   ${u.email}`);
    console.log(`Workspace: ${org.name}  (${org.country}/${org.currency}, work type: ${org.audience ?? "client_work (default)"})`);
    console.log(`Deals now: ${existing.length}`);
    console.log(`\nWill set region to: ${us.country} / ${us.currency} / ${us.locale} / ${us.timezone}`);

    if (foreignDeals) {
      console.error(`\nRefusing: this workspace already has ${existing.length} deal(s) in ${org.currency}. Switching to ${us.currency} would relabel their amounts. Nothing was changed.`);
      console.error("To delete them first, add --delete-existing-deals (irreversible, this workspace only).");
      process.exit(1);
    }

    const count = async (sql: string) => Number((await c.query(sql, [dealIds])).rows[0].n);
    const doomed = deleteExisting && dealIds.length
      ? {
          deals: dealIds.length,
          quotes: await count(`SELECT count(*)::int AS n FROM quotes WHERE deal_id = ANY($1)`),
          agreements: await count(`SELECT count(*)::int AS n FROM contracts WHERE deal_id = ANY($1)`),
          invoices: await count(`SELECT count(*)::int AS n FROM brand_invoices WHERE deal_id = ANY($1)`),
        }
      : null;
    if (doomed) {
      console.log(`\nWill DELETE (irreversible): ${doomed.deals} deal(s), ${doomed.quotes} quotation(s), ${doomed.agreements} agreement(s), ${doomed.invoices} invoice(s):`);
      for (const t of existing) console.log(`  x ${t}`);
    }
    // After a delete the workspace starts empty, so both dummy deals are added.
    const toAdd = DEALS.filter((d) => deleteExisting || !existing.includes(d.dealTitle));
    console.log(toAdd.length ? `Will add ${toAdd.length} dummy deal(s):` : "Both dummy deals already exist; none to add.");
    for (const d of toAdd) console.log(`  - ${d.dealTitle}  ($${(d.amountMinor / 100).toFixed(2)})`);

    if (!apply) { console.log("\nDRY RUN. Nothing was changed. Add --apply to do it."); return; }

    await c.query("BEGIN");
    if (doomed) {
      // Children first; the foreign keys run from the leaves up to deals.
      await c.query(`DELETE FROM invoice_attachments WHERE brand_invoice_id IN (SELECT id FROM brand_invoices WHERE deal_id = ANY($1))`, [dealIds]);
      await c.query(`DELETE FROM brand_invoices WHERE deal_id = ANY($1)`, [dealIds]);
      await c.query(`DELETE FROM invoices WHERE deal_id = ANY($1)`, [dealIds]);
      await c.query(`DELETE FROM contracts WHERE deal_id = ANY($1)`, [dealIds]);
      await c.query(`DELETE FROM quotes WHERE deal_id = ANY($1)`, [dealIds]);
      await c.query(`DELETE FROM deals WHERE id = ANY($1)`, [dealIds]);
      // The invoice numbers it issued are gone, so numbering starts again.
      await c.query(`DELETE FROM invoice_counters WHERE organization_id = $1`, [org.id]);
    }
    const set = [us.country, us.currency, us.locale, us.timezone];
    await c.query(`UPDATE users SET country=$1, currency=$2, locale=$3, timezone=$4 WHERE id=$5`, [...set, u.id]);
    await c.query(`UPDATE organizations SET country=$1, currency=$2, locale=$3, timezone=$4 WHERE id=$5`, [...set, org.id]);
    for (const d of toAdd) {
      const deal = (await c.query(
        `INSERT INTO deals (user_id, organization_id, brand_name, deal_title, deal_type, deal_amount, start_date, end_date,
                            deliverables, deliverable_mode, standard_term_ids, custom_terms, brand_terms, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::json,'all',$10::json,$11,$12::jsonb,'Pending') RETURNING id`,
        [u.id, org.id, d.brandName, d.dealTitle, d.dealType, d.amountMinor, d.start, d.end,
         JSON.stringify(d.deliverables), JSON.stringify(d.standardTermIds), d.customTerms,
         d.brandTerms ? JSON.stringify(d.brandTerms) : null],
      )).rows[0];
      await c.query(`INSERT INTO quotes (user_id, organization_id, deal_id, status, version) VALUES ($1,$2,$3,'draft',1)`, [u.id, org.id, deal.id]);
    }
    await c.query("COMMIT");
    console.log(`\nDone. ${u.email} is now a United States account (USD) with ${toAdd.length} new test deal(s).`);
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.error(e);
    process.exitCode = 1;
  } finally { c.release(); await pool.end(); }
}
main();
