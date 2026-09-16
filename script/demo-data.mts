/**
 * Seeds the PRODUCT-HUNT DEMO portfolio for screen recording.
 *
 * LOCAL ONLY — refuses to run against anything but localhost. It resets the
 * smoke user's records and seeds exactly the playbook storyboard
 * (PRODUCT_HUNT_PLAYBOOK.md §2), so the dashboard reads:
 *   Money Radar: ₹1,45,000 potentially collectible
 *   🔴 ₹32,500 overdue — ABC Media, 6 days
 *   🟢 ₹1,12,500 ready to invoice — Uplift's ₹80,000 (nothing billed) plus
 *      ABC's ₹32,500 unbilled balance (the engine counts both, correctly)
 * plus a paid deal and a fresh pipeline deal for texture.
 *
 * Amounts are written in MINOR units (paise), the unit every money column holds
 * since script/migrate-money-minor-units.ts. The fixtures below are typed as
 * the rupee figures above and converted once by inr(). Writing 65000 straight
 * into deal_amount would now show ₹650 on screen.
 *
 * The local database must be migrated BEFORE seeding (the script checks):
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/migrate-money-minor-units.ts --apply
 * Run:  DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/demo-data.mts
 * Login: pdf-smoke@dealinsec.invalid / SmokeTest#2026
 */
import pg from "pg";
import bcrypt from "bcrypt";
import { INDIA_LOCALE, inr, requireLocalDatabaseUrl, requireMinorUnitMoney } from "./local-db-guard.ts";

const SCRIPT = "demo-data.mts";

const ORG = "00000000-0000-4000-8000-000000000d01";
const UID = "00000000-0000-4000-8000-000000000d02";
const EMAIL = "pdf-smoke@dealinsec.invalid";

const SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const SEAL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const deliv = (rows: [string, string, number, string, string?][]) =>
  JSON.stringify(rows.map(([platform, contentType, quantity, frequency, notes], i) => ({
    id: `demo${i + 1}`, platform, contentType, quantity, frequency, notes: notes ?? "",
  })));

/** One invoice line in the stored shape: `rateMinor`/`amountMinor`, never the
 *  rupee-era `rate`/`amount` the server now rejects. quantity is a count, so
 *  it is not scaled. */
const line = (description: string, quantity: number, rateRupees: number, hsnSac?: string) => ({
  description,
  ...(hsnSac ? { hsnSac } : {}),
  quantity,
  rateMinor: inr(rateRupees),
  amountMinor: inr(rateRupees * quantity),
});

async function main() {
  // Before the pool exists: a refused URL must never open a connection.
  const url = requireLocalDatabaseUrl(SCRIPT);
  const pool = new pg.Pool({ connectionString: url });
  const c = await pool.connect();
  try {
    await requireMinorUnitMoney(c, SCRIPT);

    // Reset the smoke user's records (keep the user/org rows).
    for (const q of [
      `DELETE FROM brand_invoices WHERE user_id=$1`,
      `DELETE FROM contracts WHERE user_id=$1`,
      `DELETE FROM quotes WHERE user_id=$1`,
      `DELETE FROM deals WHERE user_id=$1`,
    ]) await c.query(q, [UID]).catch(() => {});

    // Idempotent identity (same as pdf-scenarios) so the script stands alone.
    // The locale columns are re-pinned to India on conflict: every amount below
    // is INR paise, and an org left on another currency would misprint them all.
    const pw = await bcrypt.hash("SmokeTest#2026", 10);
    const loc = [INDIA_LOCALE.country, INDIA_LOCALE.currency, INDIA_LOCALE.locale, INDIA_LOCALE.timezone];
    await c.query(
      `INSERT INTO organizations (id,name,country,currency,locale,timezone) VALUES ($1,'Meraki Design Studio',$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET country=EXCLUDED.country, currency=EXCLUDED.currency, locale=EXCLUDED.locale, timezone=EXCLUDED.timezone`,
      [ORG, ...loc],
    );
    await c.query(
      `INSERT INTO users (id,email,email_canonical,password,first_name,last_name,organization_id,org_role,plan,plan_expires_at,onboarding_complete,
        phone,pan_number,gst_number,billing_address,digital_signature,company_seal,
        account_holder_name,account_number,ifsc_code,bank_name,country,currency,locale,timezone)
       VALUES ($1,$2,$2,$3,'Anaya','Deshpande',$4,'OWNER','pro',now()+interval '30 days',true,
        '9876543210','ABCDE1234F','19ABCDE1234F1Z5','2nd Floor, Laxmi Niwas, Hill Cart Road, Darjeeling, West Bengal 734101',$5,$6,
        'Anaya Deshpande','50100123456789','HDFC0001234','HDFC Bank, Darjeeling Branch',$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET country=EXCLUDED.country, currency=EXCLUDED.currency, locale=EXCLUDED.locale, timezone=EXCLUDED.timezone`,
      [UID, EMAIL, pw, ORG, SIG, SEAL, ...loc],
    );

    // 🔴 ABC Media — signed deal, advance invoice ₹32,500 OVERDUE by 6 days.
    const abc = await c.query(
      `INSERT INTO deals (user_id,organization_id,brand_name,deal_title,deal_amount,start_date,end_date,status,deal_type,deliverables,custom_terms)
       VALUES ($1,$2,'ABC Media','Brand film & social campaign — Q3',$4,(CURRENT_DATE-20)::text,(CURRENT_DATE+40)::text,'Active','Video & Photo',$3::jsonb,
        '50% advance to confirm the campaign\nBalance within 7 days of final delivery') RETURNING id`,
      [UID, ORG, deliv([
        ["Video", "Brand film — 90s hero cut", 1, "One-time", "Includes two revision rounds"],
        ["Social", "Cutdowns for Instagram & YouTube", 6, "One-time"],
      ]), inr(65000)],
    );
    const abcContract = await c.query(
      `INSERT INTO contracts (user_id,organization_id,deal_id,brand_name,contract_name,contract_value,start_date,end_date,status,
         signed_date,signed_by_brand,signer_user_id,signer_name,signature_url,seal_url)
       VALUES ($1,$2,$3,'ABC Media','ABC Media — Q3 campaign',$6,(CURRENT_DATE-20)::text,(CURRENT_DATE+40)::text,'Signed',
         (CURRENT_DATE-18)::text,true,$1,'Anaya Deshpande',$4,$5) RETURNING id`,
      [UID, ORG, abc.rows[0].id, SIG, SEAL, inr(65000)],
    );
    await c.query(
      `INSERT INTO brand_invoices (user_id,organization_id,invoice_number,invoice_date,due_date,deal_id,contract_id,brand_name,influencer_name,influencer_email,deal_amount,invoice_type,notes,line_items,status)
       VALUES ($1,$2,'INV-2627-0101',(CURRENT_DATE-16)::text,(CURRENT_DATE-6)::text,$3,$4,'ABC Media','Anaya Deshpande',$5,$7,'advance',
        'Advance as per agreement — 50% to begin production.',
        $6::jsonb,'Unpaid')`,
      [UID, ORG, abc.rows[0].id, abcContract.rows[0].id, EMAIL,
        JSON.stringify([line("Campaign advance (50%) — as per agreement", 1, 32500, "998361")]), inr(32500)],
    );

    // 🟢 Uplift Learning — signed ₹80,000 agreement, NOTHING invoiced yet.
    const uplift = await c.query(
      `INSERT INTO deals (user_id,organization_id,brand_name,deal_title,deal_amount,start_date,end_date,status,deal_type,deliverables,custom_terms)
       VALUES ($1,$2,'Uplift Learning','Website redesign — 6 pages',$4,(CURRENT_DATE-5)::text,(CURRENT_DATE+55)::text,'Signed','Design',$3::jsonb,
        '50% advance on signing\nBalance on handover') RETURNING id`,
      [UID, ORG, deliv([
        ["Design", "Homepage design — desktop & mobile", 1, "One-time"],
        ["Design", "Inner page designs", 5, "One-time"],
        ["Development", "Build, QA & handover", 1, "One-time"],
      ]), inr(80000)],
    );
    await c.query(
      `INSERT INTO contracts (user_id,organization_id,deal_id,brand_name,contract_name,contract_value,start_date,end_date,status,
         signed_date,signed_by_brand,signer_user_id,signer_name,signature_url,seal_url)
       VALUES ($1,$2,$3,'Uplift Learning','Uplift Learning — website redesign',$6,(CURRENT_DATE-5)::text,(CURRENT_DATE+55)::text,'Signed',
         (CURRENT_DATE-2)::text,true,$1,'Anaya Deshpande',$4,$5)`,
      [UID, ORG, uplift.rows[0].id, SIG, SEAL, inr(80000)],
    );

    // ✅ Texture: a completed, PAID deal so the history looks alive.
    const paid = await c.query(
      `INSERT INTO deals (user_id,organization_id,brand_name,deal_title,deal_amount,start_date,end_date,status,deal_type,deliverables)
       VALUES ($1,$2,'Greenleaf Cafe','Brand identity & menu design',$4,(CURRENT_DATE-90)::text,(CURRENT_DATE-30)::text,'Completed','Design',$3::jsonb) RETURNING id`,
      [UID, ORG, deliv([["Design", "Logo, brand kit & menu design", 1, "One-time"]]), inr(120000)],
    );
    await c.query(
      `INSERT INTO brand_invoices (user_id,organization_id,invoice_number,invoice_date,due_date,deal_id,brand_name,influencer_name,influencer_email,deal_amount,invoice_type,notes,line_items,status,paid_at)
       VALUES ($1,$2,'INV-2627-0097',(CURRENT_DATE-35)::text,(CURRENT_DATE-20)::text,$3,'Greenleaf Cafe','Anaya Deshpande',$4,$6,'final',
        'Final settlement — thank you!',$5::jsonb,'Paid',now()-interval '22 days')`,
      [UID, ORG, paid.rows[0].id, EMAIL,
        JSON.stringify([line("Brand identity & menu design — full scope", 1, 120000)]), inr(120000)],
    );

    // 🛡️ Protection-check showcase: a deal whose terms trip every red flag —
    // the gallery shot for "stay protected".
    await c.query(
      `INSERT INTO deals (user_id,organization_id,brand_name,deal_title,deal_amount,start_date,end_date,status,deal_type,deliverables,custom_terms)
       VALUES ($1,$2,'Risky Client Pvt Ltd','App build — as discussed',$4,CURRENT_DATE::text,(CURRENT_DATE+60)::text,'Pending','Development',$3::jsonb,
        'Work as per project requirement with unlimited revisions until satisfaction. Payment will be released after our client pays us. Balance within 30 days. Advance 50% and remaining within 7 days. Retention of 10% applies.')`,
      [UID, ORG, deliv([["Development", "Mobile app — full scope", 1, "One-time"]]), inr(300000)],
    );

    // 📥 Texture: fresh pipeline — pending deal with a draft quotation.
    const fresh = await c.query(
      `INSERT INTO deals (user_id,organization_id,brand_name,deal_title,deal_amount,start_date,end_date,status,deal_type,deliverables)
       VALUES ($1,$2,'Sunrise Ventures','Brand refresh — logo & social kit',$4,CURRENT_DATE::text,(CURRENT_DATE+30)::text,'Pending','Design',$3::jsonb) RETURNING id`,
      [UID, ORG, deliv([["Design", "Logo refresh, brand kit & social templates", 1, "One-time"]]), inr(45000)],
    );
    await c.query(
      `INSERT INTO quotes (user_id,organization_id,deal_id,version,status) VALUES ($1,$2,$3,1,'draft')`,
      [UID, ORG, fresh.rows[0].id],
    );

    // Expected radar figures in the unit the API returns (minor), so they can
    // be compared to a response directly; the ₹ strings are what the screen shows.
    console.log(JSON.stringify({
      login: { email: EMAIL, password: "SmokeTest#2026" },
      radar_expected_minor: { overdue: inr(32500), readyToInvoice: inr(112500), collectible: inr(145000) },
      radar_expected_display: { overdue: "₹32,500", readyToInvoice: "₹1,12,500", collectible: "₹1,45,000" },
      deals: { abcMedia: abc.rows[0].id, uplift: uplift.rows[0].id, paid: paid.rows[0].id, pipeline: fresh.rows[0].id },
    }, null, 1));
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
