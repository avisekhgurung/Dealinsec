/**
 * Seeds the PRODUCT-HUNT DEMO portfolio for screen recording.
 *
 * LOCAL ONLY — refuses to run against anything but localhost. It resets the
 * smoke user's records and seeds exactly the playbook storyboard
 * (PRODUCT_HUNT_PLAYBOOK.md §2), so the dashboard reads:
 *   Money Radar: ₹1,45,000 potentially collectible
 *   🔴 ₹32,500 overdue — ABC Media, 6 days
 *   🟢 ₹1,12,500 ready to invoice — Kalka's ₹80,000 (nothing billed) plus
 *      ABC's ₹32,500 unbilled balance (the engine counts both, correctly)
 * plus a paid deal and a fresh pipeline deal for texture.
 *
 * Run:  DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/demo-data.mts
 * Login: pdf-smoke@dealinsec.invalid / SmokeTest#2026
 */
import pg from "pg";
import bcrypt from "bcrypt";

const ORG = "00000000-0000-4000-8000-000000000d01";
const UID = "00000000-0000-4000-8000-000000000d02";
const EMAIL = "pdf-smoke@dealinsec.invalid";

const SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const SEAL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const deliv = (rows: [string, string, number, string, string?][]) =>
  JSON.stringify(rows.map(([platform, contentType, quantity, frequency, notes], i) => ({
    id: `demo${i + 1}`, platform, contentType, quantity, frequency, notes: notes ?? "",
  })));

async function main() {
  const url = process.env.DATABASE_URL || "";
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    console.error("REFUSING: demo data is for the LOCAL database only. DATABASE_URL must point at localhost.");
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: url });
  const c = await pool.connect();
  try {
    // Reset the smoke user's records (keep the user/org rows).
    for (const q of [
      `DELETE FROM brand_invoices WHERE user_id=$1`,
      `DELETE FROM contracts WHERE user_id=$1`,
      `DELETE FROM quotes WHERE user_id=$1`,
      `DELETE FROM deals WHERE user_id=$1`,
    ]) await c.query(q, [UID]).catch(() => {});

    // Idempotent identity (same as pdf-scenarios) so the script stands alone.
    const pw = await bcrypt.hash("SmokeTest#2026", 10);
    await c.query(`INSERT INTO organizations (id,name) VALUES ($1,'Meraki Design Studio') ON CONFLICT (id) DO NOTHING`, [ORG]);
    await c.query(
      `INSERT INTO users (id,email,email_canonical,password,first_name,last_name,organization_id,org_role,plan,plan_expires_at,onboarding_complete,
        phone,pan_number,gst_number,billing_address,digital_signature,company_seal,
        account_holder_name,account_number,ifsc_code,bank_name)
       VALUES ($1,$2,$2,$3,'Anaya','Deshpande',$4,'OWNER','pro',now()+interval '30 days',true,
        '9876543210','ABCDE1234F','19ABCDE1234F1Z5','2nd Floor, Laxmi Niwas, Hill Cart Road, Darjeeling, West Bengal 734101',$5,$6,
        'Anaya Deshpande','50100123456789','HDFC0001234','HDFC Bank, Darjeeling Branch')
       ON CONFLICT (id) DO NOTHING`,
      [UID, EMAIL, pw, ORG, SIG, SEAL],
    );

    // 🔴 ABC Media — signed deal, advance invoice ₹32,500 OVERDUE by 6 days.
    const abc = await c.query(
      `INSERT INTO deals (user_id,organization_id,brand_name,deal_title,deal_amount,start_date,end_date,status,deal_type,deliverables,custom_terms)
       VALUES ($1,$2,'ABC Media','Brand film & social campaign — Q3',65000,(CURRENT_DATE-20)::text,(CURRENT_DATE+40)::text,'Active','service',$3::jsonb,
        '50% advance to confirm the campaign\nBalance within 7 days of final delivery') RETURNING id`,
      [UID, ORG, deliv([
        ["Video", "Brand film — 90s hero cut", 1, "One-time", "Includes two revision rounds"],
        ["Social", "Cutdowns for Instagram & YouTube", 6, "One-time"],
      ])],
    );
    const abcContract = await c.query(
      `INSERT INTO contracts (user_id,organization_id,deal_id,brand_name,contract_name,contract_value,start_date,end_date,status,
         signed_date,signed_by_brand,signer_user_id,signer_name,signature_url,seal_url)
       VALUES ($1,$2,$3,'ABC Media','ABC Media — Q3 campaign',65000,(CURRENT_DATE-20)::text,(CURRENT_DATE+40)::text,'Signed',
         (CURRENT_DATE-18)::text,true,$1,'Anaya Deshpande',$4,$5) RETURNING id`,
      [UID, ORG, abc.rows[0].id, SIG, SEAL],
    );
    await c.query(
      `INSERT INTO brand_invoices (user_id,organization_id,invoice_number,invoice_date,due_date,deal_id,contract_id,brand_name,influencer_name,influencer_email,deal_amount,invoice_type,notes,line_items,status)
       VALUES ($1,$2,'INV-2627-0101',(CURRENT_DATE-16)::text,(CURRENT_DATE-6)::text,$3,$4,'ABC Media','Anaya Deshpande',$5,32500,'advance',
        'Advance as per agreement — 50% to begin production.',
        $6::jsonb,'Unpaid')`,
      [UID, ORG, abc.rows[0].id, abcContract.rows[0].id, EMAIL,
        JSON.stringify([{ description: "Campaign advance (50%) — as per agreement", hsnSac: "998361", quantity: 1, rate: 32500, amount: 32500 }])],
    );

    // 🟢 Kalka Constructions — signed ₹80,000 agreement, NOTHING invoiced yet.
    const kalka = await c.query(
      `INSERT INTO deals (user_id,organization_id,brand_name,deal_title,deal_amount,start_date,end_date,status,deal_type,deliverables,custom_terms)
       VALUES ($1,$2,'Kalka Constructions','Site office interiors — Matigara',80000,(CURRENT_DATE-5)::text,(CURRENT_DATE+55)::text,'Signed','service',$3::jsonb,
        '50% advance on signing\nBalance on handover') RETURNING id`,
      [UID, ORG, deliv([
        ["Interior Design", "Reception & waiting area", 1, "One-time"],
        ["Interior Design", "Workstations & cabin fit-out", 8, "One-time"],
        ["Supervision", "Site supervision", 2, "Monthly"],
      ])],
    );
    await c.query(
      `INSERT INTO contracts (user_id,organization_id,deal_id,brand_name,contract_name,contract_value,start_date,end_date,status,
         signed_date,signed_by_brand,signer_user_id,signer_name,signature_url,seal_url)
       VALUES ($1,$2,$3,'Kalka Constructions','Kalka Constructions — site office interiors',80000,(CURRENT_DATE-5)::text,(CURRENT_DATE+55)::text,'Signed',
         (CURRENT_DATE-2)::text,true,$1,'Anaya Deshpande',$4,$5)`,
      [UID, ORG, kalka.rows[0].id, SIG, SEAL],
    );

    // ✅ Texture: a completed, PAID deal so the history looks alive.
    const paid = await c.query(
      `INSERT INTO deals (user_id,organization_id,brand_name,deal_title,deal_amount,start_date,end_date,status,deal_type,deliverables)
       VALUES ($1,$2,'Meraki Homes','2BHK show-flat styling',120000,(CURRENT_DATE-90)::text,(CURRENT_DATE-30)::text,'Completed','service',$3::jsonb) RETURNING id`,
      [UID, ORG, deliv([["Interior Design", "Show-flat styling & décor", 1, "One-time"]])],
    );
    await c.query(
      `INSERT INTO brand_invoices (user_id,organization_id,invoice_number,invoice_date,due_date,deal_id,brand_name,influencer_name,influencer_email,deal_amount,invoice_type,notes,line_items,status,paid_at)
       VALUES ($1,$2,'INV-2627-0097',(CURRENT_DATE-35)::text,(CURRENT_DATE-20)::text,$3,'Meraki Homes','Anaya Deshpande',$4,120000,'final',
        'Final settlement — thank you!',$5::jsonb,'Paid',now()-interval '22 days')`,
      [UID, ORG, paid.rows[0].id, EMAIL,
        JSON.stringify([{ description: "Show-flat styling — full scope", quantity: 1, rate: 120000, amount: 120000 }])],
    );

    // 📥 Texture: fresh pipeline — pending deal with a draft quotation.
    const fresh = await c.query(
      `INSERT INTO deals (user_id,organization_id,brand_name,deal_title,deal_amount,start_date,end_date,status,deal_type,deliverables)
       VALUES ($1,$2,'Sunrise Ventures','Office branding & signage',45000,CURRENT_DATE::text,(CURRENT_DATE+30)::text,'Pending','service',$3::jsonb) RETURNING id`,
      [UID, ORG, deliv([["Branding", "Logo wall, signage & wayfinding", 1, "One-time"]])],
    );
    await c.query(
      `INSERT INTO quotes (user_id,organization_id,deal_id,version,status) VALUES ($1,$2,$3,1,'draft')`,
      [UID, ORG, fresh.rows[0].id],
    );

    console.log(JSON.stringify({
      login: { email: EMAIL, password: "SmokeTest#2026" },
      radar_expected: { overdue: 32500, readyToInvoice: 112500, collectible: 145000 },
      deals: { abcMedia: abc.rows[0].id, kalka: kalka.rows[0].id, paid: paid.rows[0].id, pipeline: fresh.rows[0].id },
    }, null, 1));
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
